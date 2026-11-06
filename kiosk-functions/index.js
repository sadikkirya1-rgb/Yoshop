const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const {sanitizeKioskOrder} = require("./kiosk-utils");

admin.initializeApp();
const db = getFirestore(admin.app(), "yoshop");
const callableOptions = {region: "us-central1", cors: true};
const KIOSK_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const KIOSK_RATE_LIMIT_MAX_REQUESTS = 12;

function hashKioskValue(value) {
	return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createKioskToken() {
	return crypto.randomBytes(32).toString("base64url");
}

function getKioskTokenHash(token) {
	const normalizedToken = String(token || "").trim();
	if (!/^[A-Za-z0-9_-]{32,100}$/.test(normalizedToken)) {
		throw new HttpsError("invalid-argument", "A valid kiosk link is required.");
	}
	return hashKioskValue(normalizedToken);
}

async function assertKioskOwner(request) {
	if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to manage kiosk ordering.");
	const userRef = db.collection("users").doc(request.auth.uid);
	const profileRef = userRef.collection("data").doc("shop_profile");
	const [userSnapshot, profileSnapshot] = await Promise.all([userRef.get(), profileRef.get()]);
	if (!userSnapshot.exists) throw new HttpsError("permission-denied", "This account does not own a registered business.");
	const userData = userSnapshot.data() || {};
	const profile = profileSnapshot.data() || {};
	const accountStatus = String(userData.status || "active").toLowerCase();
	const shopStatus = String(profile.appAdminSettings?.shopStatus || "active").toLowerCase();
	if (["pending", "suspended", "deactivated", "deleted"].includes(accountStatus) || ["suspended", "deactivated"].includes(shopStatus)) {
		throw new HttpsError("permission-denied", "This business is not currently allowed to use kiosk ordering.");
	}
	return {uid: request.auth.uid, userData, profile};
}

async function loadKioskByToken(token, previewUid = "") {
	const tokenHash = getKioskTokenHash(token);
	const publicRef = db.collection("kioskPublic").doc(tokenHash);
	const publicSnapshot = await publicRef.get();
	const publicData = publicSnapshot.data() || {};
	const isOwnerPreview = Boolean(previewUid && publicData.uid === previewUid);
	if (!publicSnapshot.exists || (publicData.enabled !== true && !isOwnerPreview)) {
		throw new HttpsError("not-found", "This digital menu is unavailable.");
	}
	const uid = String(publicData.uid || "");
	if (!uid) throw new HttpsError("not-found", "This digital menu is unavailable.");
	const userRef = db.collection("users").doc(uid);
	const [userSnapshot, profileSnapshot, configSnapshot] = await Promise.all([
		userRef.get(),
		userRef.collection("data").doc("shop_profile").get(),
		userRef.collection("data").doc("kiosk_settings").get()
	]);
	if (!userSnapshot.exists || !configSnapshot.exists || (configSnapshot.data()?.enabled !== true && !isOwnerPreview) || configSnapshot.data()?.tokenHash !== tokenHash) {
		throw new HttpsError("not-found", "This digital menu is unavailable.");
	}
	const userData = userSnapshot.data() || {};
	const profile = profileSnapshot.data() || {};
	const accountStatus = String(userData.status || "active").toLowerCase();
	const shopStatus = String(profile.appAdminSettings?.shopStatus || "active").toLowerCase();
	if (["pending", "suspended", "deactivated", "deleted"].includes(accountStatus) || ["suspended", "deactivated"].includes(shopStatus)) {
		throw new HttpsError("not-found", "This digital menu is unavailable.");
	}
	return {uid, tokenHash, userData, profile, config: configSnapshot.data()};
}

async function getPublishedKioskCatalog(kiosk) {
	const productIds = [...new Set((Array.isArray(kiosk.config.selectedProductIds) ? kiosk.config.selectedProductIds : [])
		.map((productId) => String(productId || "").trim()).filter(Boolean))].slice(0, 100);
	const snapshots = await Promise.all(productIds.map((productId) => db.collection("users").doc(kiosk.uid).collection("products").doc(productId).get()));
	const catalog = {};
	snapshots.forEach((snapshot, index) => {
		if (!snapshot.exists) return;
		const product = snapshot.data() || {};
		if (product.deleted || product.isAvailable === false || !String(product.name || "").trim()) return;
		const price = Number(product.price);
		if (!Number.isFinite(price) || price < 0) return;
		const image = String(product.image || "");
		catalog[productIds[index]] = {
			id: productIds[index],
			name: String(product.name).trim().slice(0, 100),
			description: String(product.description || "").trim().slice(0, 240),
			category: String(product.category || "Menu").trim().slice(0, 60),
			price: Math.round(price * 100) / 100,
			image: /^https:\/\//i.test(image) ? image : ""
		};
	});
	return catalog;
}

exports.configureKioskMenu = onCall(callableOptions, async (request) => {
	const {uid, userData, profile} = await assertKioskOwner(request);
	const data = request.data || {};
	const configRef = db.collection("users").doc(uid).collection("data").doc("kiosk_settings");
	const currentSnapshot = await configRef.get();
	const current = currentSnapshot.data() || {};
	const shouldRotate = data.rotateToken === true || !current.publicToken;
	const token = shouldRotate ? createKioskToken() : String(current.publicToken);
	const tokenHash = hashKioskValue(token);
	const selectedProductIds = Array.isArray(data.selectedProductIds)
		? [...new Set(data.selectedProductIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 100)
		: (Array.isArray(current.selectedProductIds) ? current.selectedProductIds : []);
	const enabled = typeof data.enabled === "boolean" ? data.enabled : current.enabled === true;
	const allowAttendant = typeof data.allowAttendant === "boolean" ? data.allowAttendant : current.allowAttendant !== false;

	if (enabled && selectedProductIds.length === 0) {
		throw new HttpsError("failed-precondition", "Publish at least one menu item before enabling the kiosk.");
	}
	if (selectedProductIds.length) {
		const productSnapshots = await Promise.all(selectedProductIds.map((id) => db.collection("users").doc(uid).collection("products").doc(id).get()));
		if (productSnapshots.some((snapshot) => !snapshot.exists || snapshot.data()?.deleted)) {
			throw new HttpsError("invalid-argument", "One or more selected menu items are missing or deleted.");
		}
	}

	const now = admin.firestore.FieldValue.serverTimestamp();
	await configRef.set({
		enabled,
		allowAttendant,
		selectedProductIds,
		publicToken: token,
		tokenHash,
		updatedAt: now,
		businessName: String(profile.settings?.name || userData.name || "YoShop").trim().slice(0, 100)
	}, {merge: true});

	const publicRef = db.collection("kioskPublic").doc(tokenHash);
	const writes = [publicRef.set({uid, enabled, updatedAt: now})];
	if (current.tokenHash && current.tokenHash !== tokenHash) {
		writes.push(db.collection("kioskPublic").doc(String(current.tokenHash)).set({uid, enabled: false, updatedAt: now}, {merge: true}));
	}
	await Promise.all(writes);
	return {
		enabled,
		allowAttendant,
		selectedProductIds,
		publicToken: token,
		businessName: String(profile.settings?.name || userData.name || "YoShop").trim().slice(0, 100)
	};
});

exports.getKioskMenu = onCall(callableOptions, async (request) => {
	const previewUid = request.data?.preview === true ? String(request.auth?.uid || "") : "";
	const kiosk = await loadKioskByToken(request.data?.token, previewUid);
	const catalog = await getPublishedKioskCatalog(kiosk);
	const profileSettings = kiosk.profile.settings || {};
	return {
		businessName: String(profileSettings.name || kiosk.userData.name || kiosk.config.businessName || "YoShop").trim().slice(0, 100),
		currency: String(profileSettings.currency || "$").slice(0, 8),
		taxRate: Number(profileSettings.taxRate) || 0,
		allowAttendant: kiosk.config.allowAttendant !== false,
		items: Object.values(catalog)
	};
});

exports.submitKioskRequest = onCall(callableOptions, async (request) => {
	const kiosk = await loadKioskByToken(request.data?.token);
	const requestData = request.data || {};
	if (requestData.requestType === "attendant" && kiosk.config.allowAttendant === false) {
		throw new HttpsError("failed-precondition", "Attendant requests are disabled for this business.");
	}
	const catalog = await getPublishedKioskCatalog(kiosk);
	let order;
	try {
		order = sanitizeKioskOrder(requestData, catalog, Number(kiosk.profile.settings?.taxRate) || 0);
	} catch (error) {
		throw new HttpsError("invalid-argument", error.message);
	}
	const idempotencyKey = String(requestData.idempotencyKey || "").trim();
	if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
		throw new HttpsError("invalid-argument", "A valid submission ID is required.");
	}
	const orderId = hashKioskValue(`${kiosk.tokenHash}:${idempotencyKey}`).slice(0, 40);
	const orderRef = db.collection("users").doc(kiosk.uid).collection("kioskOrders").doc(orderId);
	const ipHash = hashKioskValue(String(request.rawRequest?.ip || "unknown")).slice(0, 32);
	const rateRef = db.collection("kioskRateLimits").doc(`${kiosk.tokenHash}_${ipHash}`);
	const nowMillis = Date.now();
	const result = await db.runTransaction(async (transaction) => {
		const [existingOrder, rateSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(rateRef)]);
		if (existingOrder.exists) return {orderId, duplicate: true};
		const rateData = rateSnapshot.data() || {};
		const windowStart = Number(rateData.windowStart) || nowMillis;
		const requestCount = nowMillis - windowStart >= KIOSK_RATE_LIMIT_WINDOW_MS ? 0 : Number(rateData.requestCount) || 0;
		if (requestCount >= KIOSK_RATE_LIMIT_MAX_REQUESTS) {
			throw new HttpsError("resource-exhausted", "Too many requests. Please try again in a minute.");
		}
		transaction.set(rateRef, {
			windowStart: requestCount === 0 ? nowMillis : windowStart,
			requestCount: requestCount + 1,
			expiresAt: new Date(nowMillis + KIOSK_RATE_LIMIT_WINDOW_MS * 2)
		});
		transaction.create(orderRef, {
			...order,
			status: "new",
			source: "kiosk",
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
			statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
		});
		return {orderId, duplicate: false};
	});
	return result;
});

exports.registerKioskDevice = onCall(callableOptions, async (request) => {
	const {uid} = await assertKioskOwner(request);
	const token = String(request.data?.token || "").trim();
	if (token.length < 50 || token.length > 5000) throw new HttpsError("invalid-argument", "A valid push token is required.");
	const tokenId = hashKioskValue(token).slice(0, 40);
	await db.collection("users").doc(uid).collection("kioskDevices").doc(tokenId).set({
		token,
		updatedAt: admin.firestore.FieldValue.serverTimestamp(),
		deviceLabel: String(request.data?.deviceLabel || "Staff device").trim().slice(0, 80)
	}, {merge: true});
	return {registered: true};
});

exports.unregisterKioskDevice = onCall(callableOptions, async (request) => {
	const {uid} = await assertKioskOwner(request);
	const token = String(request.data?.token || "").trim();
	if (token.length < 50 || token.length > 5000) throw new HttpsError("invalid-argument", "A valid push token is required.");
	const tokenId = hashKioskValue(token).slice(0, 40);
	await db.collection("users").doc(uid).collection("kioskDevices").doc(tokenId).delete();
	return {registered: false};
});

exports.sendKioskOrderPush = onDocumentCreated({
	database: "yoshop",
	region: "us-central1",
	document: "users/{uid}/kioskOrders/{orderId}"
}, async (event) => {
	const order = event.data?.data();
	if (!order || order.source !== "kiosk") return;
	const devicesSnapshot = await db.collection("users").doc(event.params.uid).collection("kioskDevices").get();
	const devices = devicesSnapshot.docs;
	if (!devices.length) return;
	const tableLabel = order.table ? ` at ${String(order.table).slice(0, 40)}` : "";
	const body = order.requestType === "attendant"
		? `A customer requested assistance${tableLabel}.`
		: `A new order${tableLabel} is waiting for staff.`;
	for (let offset = 0; offset < devices.length; offset += 500) {
		const batch = devices.slice(offset, offset + 500);
		const response = await admin.messaging().sendEachForMulticast({
			tokens: batch.map((snapshot) => String(snapshot.data().token || "")).filter(Boolean),
			notification: {title: order.requestType === "attendant" ? "Attendant requested" : "New kiosk order", body},
			data: {type: "kiosk-order", orderId: event.params.orderId}
		});
		const invalidTokens = [];
		response.responses.forEach((sendResponse, index) => {
			if (!sendResponse.success && ["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(sendResponse.error?.code)) {
				invalidTokens.push(batch[index].ref.delete());
			}
		});
		await Promise.all(invalidTokens);
	}
});

setGlobalOptions({maxInstances: 10});