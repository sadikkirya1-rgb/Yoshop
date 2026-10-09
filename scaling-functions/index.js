const crypto = require("node:crypto");
const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

admin.initializeApp();
const db = getFirestore(admin.app(), "yoshop");
const MASTER_ADMIN_UID = "Y0N3Ny1AX9VZEQb6AdRwhK8xpkg2";
const MASTER_ADMIN_EMAIL = "sadikkirya@gmail.com";
const SHARD_COUNT = 16;
const BACKFILL_PAGE_SIZE = 250;
const callableOptions = {region: "us-central1", cors: true};

function getVersion(timestamp) {
  if (timestamp && typeof timestamp.seconds !== "undefined") {
    return {seconds: Number(timestamp.seconds || 0), nanoseconds: Number(timestamp.nanoseconds || 0)};
  }
  const milliseconds = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp || 0).getTime();
  return Number.isFinite(milliseconds)
    ? {seconds: Math.floor(milliseconds / 1000), nanoseconds: (milliseconds % 1000) * 1e6}
    : {seconds: 0, nanoseconds: 0};
}

function compareVersions(left = {}, right = {}) {
  const secondsDifference = Number(left.seconds || 0) - Number(right.seconds || 0);
  return secondsDifference || Number(left.nanoseconds || 0) - Number(right.nanoseconds || 0);
}

function getShard(uid, recordId) {
  const digest = crypto.createHash("sha256").update(`${uid}/${recordId}`).digest();
  return String(digest.readUInt32BE(0) % SHARD_COUNT).padStart(2, "0");
}

function getContribution(sale) {
  if (!sale || typeof sale !== "object") return {revenue: 0, transactionCount: 0, date: null};
  const date = sale.date ? new Date(sale.date) : null;
  const total = Number(sale.total);
  return {
    revenue: Number.isFinite(total) ? total : 0,
    transactionCount: 1,
    date: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null
  };
}

function getProductSignature(product) {
  const ignored = new Set(["createdAt", "deviceId", "lastSyncAt", "lastSyncedAt", "syncStatus", "synced", "updatedAt"]);
  const normalize = (value, root = false) => {
    if (Array.isArray(value)) return value.map(item => normalize(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value)
      .filter(key => !(root && ignored.has(key)))
      .sort()
      .map(key => [key, normalize(value[key])]));
  };
  return JSON.stringify(normalize(product, true));
}

async function applySaleContribution({uid, transactionId, sale, version}) {
  const rootRef = db.collection("system").doc("admin_analytics");
  const markerId = crypto.createHash("sha256").update(`${uid}/${transactionId}`).digest("hex");
  const markerRef = rootRef.collection("sales_markers").doc(markerId);
  const shardId = getShard(uid, transactionId);
  const next = getContribution(sale);

  await db.runTransaction(async (transaction) => {
    const markerSnapshot = await transaction.get(markerRef);
    const marker = markerSnapshot.exists ? markerSnapshot.data() : {};
    if (marker.version && compareVersions(version, marker.version) <= 0) return;

    const previous = marker.contribution || {revenue: 0, transactionCount: 0, date: null};
    const deltas = new Map();
    const addDelta = (ref, revenue, count, metadata) => {
      const current = deltas.get(ref.path) || {ref, revenue: 0, count: 0, metadata};
      current.revenue += revenue;
      current.count += count;
      current.metadata = {...current.metadata, ...metadata};
      deltas.set(ref.path, current);
    };

    addDelta(
      rootRef.collection("global_shards").doc(shardId),
      next.revenue - Number(previous.revenue || 0),
      next.transactionCount - Number(previous.transactionCount || 0),
      {shardId}
    );

    [previous, next].forEach((contribution, index) => {
      if (!contribution.date) return;
      const direction = index === 0 ? -1 : 1;
      const revenue = direction * Number(contribution.revenue || 0);
      const count = direction * Number(contribution.transactionCount || 0);
      const dailyMetadata = {date: contribution.date, shardId};
      addDelta(rootRef.collection("daily_shards").doc(`${contribution.date}_${shardId}`), revenue, count, dailyMetadata);
      addDelta(rootRef.collection("shop_daily").doc(`${uid}_${contribution.date}_${shardId}`), revenue, count, {...dailyMetadata, uid});
    });

    const updates = [...deltas.values()];
    const snapshots = await Promise.all(updates.map(update => transaction.get(update.ref)));
    updates.forEach((update, index) => {
      if (update.revenue === 0 && update.count === 0) return;
      const current = snapshots[index].exists ? snapshots[index].data() : {};
      transaction.set(update.ref, {
        ...update.metadata,
        revenue: Number(current.revenue || 0) + update.revenue,
        transactionCount: Number(current.transactionCount || 0) + update.count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, {merge: true});
    });
    transaction.set(markerRef, {
      version,
      contribution: next,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

function isAppAdmin(request) {
  return Boolean(request.auth && (
    request.auth.uid === MASTER_ADMIN_UID ||
    String(request.auth.token?.email || "").toLowerCase() === MASTER_ADMIN_EMAIL
  ));
}

exports.scalingAggregateTenantSale = onDocumentWritten({
  database: "yoshop",
  region: "us-central1",
  retry: true,
  document: "users/{uid}/transactions/{transactionId}"
}, async (event) => {
  const after = event.data?.after;
  await applySaleContribution({
    uid: event.params.uid,
    transactionId: event.params.transactionId,
    sale: after?.exists ? after.data() : null,
    version: getVersion(after?.exists ? after.updateTime : event.time)
  });
});

exports.scalingPublishProductChange = onDocumentWritten({
  database: "yoshop",
  region: "us-central1",
  retry: true,
  document: "users/{uid}/products/{productId}"
}, async (event) => {
  const after = event.data?.after;
  const productId = event.params.productId;
  const product = after?.exists ? after.data() : event.data?.before?.data() || {};
  const version = getVersion(after?.exists ? after.updateTime : event.time);
  const signature = getProductSignature(product);
  const changeRef = db.collection("users").doc(event.params.uid).collection("product_changes").doc(productId);

  await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(changeRef);
    const existing = existingSnapshot.exists ? existingSnapshot.data() : {};
    if (existing.changeSignature === signature) return;
    if (existing.changeVersion && compareVersions(version, existing.changeVersion) <= 0) return;
    transaction.set(changeRef, {
      ...product,
      id: product.id || productId,
      recordId: product.recordId || product.id || productId,
      deleted: !after?.exists || product.deleted === true || product.isDeleted === true,
      changeSignature: signature,
      changeVersion: version,
      changedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
});

exports.scalingBackfillAdminSalesAnalytics = onCall({
  ...callableOptions,
  timeoutSeconds: 540,
  memory: "1GiB"
}, async (request) => {
  if (!isAppAdmin(request)) {
    throw new HttpsError("permission-denied", "Only the app administrator can backfill sales analytics.");
  }

  const stateRef = db.collection("system").doc("admin_analytics").collection("metadata").doc("sales_backfill");
  const stateSnapshot = await stateRef.get();
  const state = stateSnapshot.data() || {};
  if (state.complete) return {complete: true, processed: 0};

  let salesQuery = db.collectionGroup("transactions")
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(BACKFILL_PAGE_SIZE);
  if (state.cursorPath) {
    const cursorSnapshot = await db.doc(state.cursorPath).get();
    if (cursorSnapshot.exists) salesQuery = salesQuery.startAfter(cursorSnapshot);
  }

  const salesSnapshot = await salesQuery.get();
  let nextIndex = 0;
  const workerCount = Math.min(10, salesSnapshot.size);
  await Promise.all(Array.from({length: workerCount}, async () => {
    while (nextIndex < salesSnapshot.docs.length) {
      const saleSnapshot = salesSnapshot.docs[nextIndex++];
      const userSnapshot = saleSnapshot.ref.parent.parent;
      if (!userSnapshot || userSnapshot.parent.id !== "users") continue;
      await applySaleContribution({
        uid: userSnapshot.id,
        transactionId: saleSnapshot.id,
        sale: saleSnapshot.data(),
        version: getVersion(saleSnapshot.updateTime)
      });
    }
  }));

  const complete = salesSnapshot.size < BACKFILL_PAGE_SIZE;
  const cursorPath = complete ? null : salesSnapshot.docs[salesSnapshot.size - 1].ref.path;
  await db.runTransaction(async (transaction) => {
    const latestSnapshot = await transaction.get(stateRef);
    if ((latestSnapshot.data()?.cursorPath || null) !== (state.cursorPath || null)) return;
    transaction.set(stateRef, {
      cursorPath,
      complete,
      processedCount: admin.firestore.FieldValue.increment(salesSnapshot.size),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, {merge: true});
  });

  logger.info("Processed admin sales analytics backfill page", {processed: salesSnapshot.size, complete});
  return {complete, processed: salesSnapshot.size, cursorPath};
});

setGlobalOptions({maxInstances: 10});
