const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const {sanitizeKioskOrder, sanitizeKioskDisplayOrder, isKioskDisplayOrderVisible, sanitizeKioskImageMap, getFirebaseStorageObjectPath, isFirebaseStorageDownloadUrl, buildFirebaseStorageDownloadUrl, isAuthorizedKioskTarget} = require("./kiosk-utils");

admin.initializeApp({storageBucket: "yoshop-b502f.firebasestorage.app"});
const db = getFirestore(admin.app(), "yoshop");
const storageBucket = admin.storage().bucket();
const legacyStorageBucket = admin.storage().bucket("yoshop-b502f.appspot.com");
const kioskImageBuckets = [storageBucket, legacyStorageBucket];
const callableOptions = {region: "europe-west1", cors: true};
const KIOSK_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const KIOSK_RATE_LIMIT_MAX_REQUESTS = 12;
const KIOSK_IMAGE_URL_CACHE_MS = 6 * 24 * 60 * 60 * 1000;
const MASTER_APP_ADMIN_UID = "Y0N3Ny1AX9VZEQb6AdRwhK8xpkg2";
const MASTER_APP_ADMIN_EMAIL = "sadikkirya@gmail.com";
const kioskImageUrlCache = new Map();

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
	const targetUid = request.data?.targetUid === undefined
		? request.auth.uid
		: String(request.data.targetUid).trim();
	if (!isAuthorizedKioskTarget(request.auth, targetUid, MASTER_APP_ADMIN_UID, MASTER_APP_ADMIN_EMAIL)) {
		throw new HttpsError("permission-denied", "You are not allowed to manage kiosk ordering for this business.");
	}
	const userRef = db.collection("users").doc(targetUid);
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
	return {uid: targetUid, userData, profile};
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
	const snapshots = productIds.length
		? await db.getAll(...productIds.map((productId) => db.collection("users").doc(kiosk.uid).collection("products").doc(productId)))
		: [];
	const catalog = {};
	snapshots.forEach((snapshot, index) => {
		if (!snapshot.exists) return;
		const product = snapshot.data() || {};
		if (product.deleted || !String(product.name || "").trim()) return;
		const price = Number(product.price);
		if (!Number.isFinite(price) || price < 0) return;
		const productImage = String(product.image || "");
		const image = /^https:\/\//i.test(productImage) || productImage.startsWith("gs://")
			? productImage
			: String(kiosk.config.productImages?.[productIds[index]] || "");
		catalog[productIds[index]] = {
			id: productIds[index],
			name: String(product.name).trim().slice(0, 100),
			description: String(product.description || "").trim().slice(0, 240),
			category: String(product.category || "Menu").trim().slice(0, 60),
			price: Math.round(price * 100) / 100,
			isAvailable: product.isAvailable !== false,
			imageSource: /^https:\/\//i.test(image) || image.startsWith("gs://") ? image : "",
			fallbackImageSource: /^https:\/\//i.test(String(kiosk.config.productImages?.[productIds[index]] || ""))
				&& String(kiosk.config.productImages[productIds[index]]) !== image
				? String(kiosk.config.productImages[productIds[index]])
				: ""
		};
	});

	await Promise.all(Object.values(catalog).map(async (item) => {
		item.image = await getKioskImageUrl(item.imageSource);
		item.fallbackImage = item.fallbackImageSource
			? await getKioskImageUrl(item.fallbackImageSource)
			: "";
		delete item.imageSource;
		delete item.fallbackImageSource;
	}));
	return catalog;
}

async function getKioskImageUrl(imageSource) {
	if (!imageSource) return "";
	const imageBucket = kioskImageBuckets.find((bucket) => getFirebaseStorageObjectPath(imageSource, bucket.name));
	const objectPath = imageBucket && getFirebaseStorageObjectPath(imageSource, imageBucket.name);
	if (!objectPath) return /^https:\/\//i.test(imageSource) ? imageSource : "";
	if (isFirebaseStorageDownloadUrl(imageSource, imageBucket.name)) return imageSource;

	const cacheKey = `${imageBucket.name}/${objectPath}`;
	const cached = kioskImageUrlCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.url;
	if (cached?.promise) return cached.promise;

	const file = imageBucket.file(objectPath);
	const promise = file.getMetadata()
		.then(async ([metadata]) => {
			const metadataTokens = String(metadata.metadata?.firebaseStorageDownloadTokens || "")
				.split(",").map((token) => token.trim()).filter(Boolean);
			let token = metadataTokens[0];
			if (!token) {
				token = crypto.randomUUID();
				await file.setMetadata({
					metadata: {
						...metadata.metadata,
						firebaseStorageDownloadTokens: token
					}
				});
			}
			return buildFirebaseStorageDownloadUrl(imageBucket.name, objectPath, token);
		})
		.then((url) => {
			kioskImageUrlCache.set(cacheKey, {url, expiresAt: Date.now() + KIOSK_IMAGE_URL_CACHE_MS});
			return url;
		})
		.catch((error) => {
			kioskImageUrlCache.delete(cacheKey);
			console.warn("[KIOSK] Could not create a Firebase image URL; using the stored URL.", error);
			return /^https:\/\//i.test(imageSource) ? imageSource : "";
		});
	kioskImageUrlCache.set(cacheKey, {promise, expiresAt: Date.now() + KIOSK_IMAGE_URL_CACHE_MS});
	return promise;
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
	const productImages = {
		...sanitizeKioskImageMap(current.productImages, selectedProductIds),
		...sanitizeKioskImageMap(data.productImages, selectedProductIds)
	};

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
		productImages,
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
		productImages,
		publicToken: token,
		businessName: String(profile.settings?.name || userData.name || "YoShop").trim().slice(0, 100)
	};
});

exports.uploadKioskProductImage = onCall(callableOptions, async (request) => {
	const {uid, userData, profile} = await assertKioskOwner(request);
	const imageData = String(request.data?.imageData || "");
	const imageMatch = imageData.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
	if (!imageMatch || imageData.length > 1_400_000) {
		throw new HttpsError("invalid-argument", "Choose a valid product image up to 1 MB.");
	}
	const imageBuffer = Buffer.from(imageMatch[2], "base64");
	if (!imageBuffer.length || imageBuffer.length > 1_048_576) {
		throw new HttpsError("invalid-argument", "Choose a valid product image up to 1 MB.");
	}

	const settings = profile.settings || {};
	const businessId = String(
		userData.businessId || userData.shopId || profile.businessId || profile.shopId || settings.businessId || ""
	).trim();
	const storageRoot = businessId ? `shops/${businessId}` : `users/${uid}`;
	const extension = imageMatch[1].toLowerCase() === "jpg" ? "jpeg" : imageMatch[1].toLowerCase();
	const contentType = `image/${extension}`;
	const objectPath = `${storageRoot}/dishes/kiosk/${crypto.randomUUID()}.${extension}`;
	const token = crypto.randomUUID();
	await storageBucket.file(objectPath).save(imageBuffer, {
		metadata: {
			contentType,
			metadata: {firebaseStorageDownloadTokens: token}
		},
		resumable: false
	});

	return {image: buildFirebaseStorageDownloadUrl(storageBucket.name, objectPath, token)};
});

exports.getKioskMenu = onCall(callableOptions, async (request) => {
	const previewUid = request.data?.preview === true ? String(request.auth?.uid || "") : "";
	const kiosk = await loadKioskByToken(request.data?.token, previewUid);
	const catalog = await getPublishedKioskCatalog(kiosk);
	const profileSettings = kiosk.profile.settings || {};
	return {
		businessName: String(profileSettings.name || kiosk.userData.name || kiosk.config.businessName || "YoShop").trim().slice(0, 100),
		currency: String(profileSettings.currency || "$").slice(0, 8),
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
		order = sanitizeKioskOrder(requestData, catalog, 0);
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
	if (order.requestType === "attendant") {
		return db.runTransaction(async (transaction) => {
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
	}
	const trackingToken = String(requestData.trackingToken || "").trim();
	if (!/^[a-f0-9]{64}$/i.test(trackingToken)) {
		throw new HttpsError("invalid-argument", "A valid order tracking key is required.");
	}
	const trackingHash = hashKioskValue(trackingToken);
	const trackingRef = db.collection("kioskOrderTracking").doc(trackingHash);
	const orderDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	const counterRef = db.collection("users").doc(kiosk.uid).collection("kioskOrderCounters").doc(orderDate);
	const result = await db.runTransaction(async (transaction) => {
		const [existingOrder, rateSnapshot, trackingSnapshot, counterSnapshot] = await Promise.all([
			transaction.get(orderRef),
			transaction.get(rateRef),
			transaction.get(trackingRef),
			transaction.get(counterRef)
		]);
		if (trackingSnapshot.exists && trackingSnapshot.data()?.orderId !== orderId) {
			throw new HttpsError("already-exists", "Could not create an order tracking link. Please try again.");
		}
		const previousOrder = existingOrder.data() || {};
		const previousTrackingRef = previousOrder.trackingHash
			? db.collection("kioskOrderTracking").doc(String(previousOrder.trackingHash))
			: null;
		if (existingOrder.exists && previousTrackingRef && previousOrder.trackingHash !== trackingHash) {
			throw new HttpsError("failed-precondition", "This order already has a different tracking link.");
		}
		if (existingOrder.exists && previousOrder.orderNumber && trackingSnapshot.exists) {
			return {orderId, orderNumber: String(previousOrder.orderNumber), duplicate: true};
		}

		const rateData = rateSnapshot.data() || {};
		const windowStart = Number(rateData.windowStart) || nowMillis;
		const requestCount = nowMillis - windowStart >= KIOSK_RATE_LIMIT_WINDOW_MS ? 0 : Number(rateData.requestCount) || 0;
		if (!existingOrder.exists && requestCount >= KIOSK_RATE_LIMIT_MAX_REQUESTS) {
			throw new HttpsError("resource-exhausted", "Too many requests. Please try again in a minute.");
		}
		const nextSequence = Number(counterSnapshot.data()?.sequence || 0) + 1;
		const orderNumber = previousOrder.orderNumber || `${orderDate}-${String(nextSequence).padStart(3, "0")}`;
		if (!trackingSnapshot.exists) {
			transaction.create(trackingRef, {
				uid: kiosk.uid,
				orderId,
				expiresAt: admin.firestore.Timestamp.fromMillis(nowMillis + 7 * 24 * 60 * 60 * 1000)
			});
		}
		if (!previousOrder.orderNumber) {
			transaction.set(counterRef, {sequence: nextSequence}, {merge: true});
		}
		if (existingOrder.exists) {
			transaction.update(orderRef, {orderNumber});
			return {orderId, orderNumber, duplicate: true};
		}
		transaction.set(rateRef, {
			windowStart: requestCount === 0 ? nowMillis : windowStart,
			requestCount: requestCount + 1,
			expiresAt: new Date(nowMillis + KIOSK_RATE_LIMIT_WINDOW_MS * 2)
		});
		transaction.create(orderRef, {
			...order,
			orderNumber,
			trackingHash,
			status: "new",
			source: "kiosk",
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
			statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
		});
		return {orderId, orderNumber, duplicate: false};
	});
	return result;
});

exports.getKioskOrderStatus = onCall(callableOptions, async (request) => {
	const trackingToken = String(request.data?.trackingToken || "").trim();
	if (!/^[a-f0-9]{64}$/i.test(trackingToken)) {
		throw new HttpsError("invalid-argument", "A valid order tracking link is required.");
	}
	const trackingHash = hashKioskValue(trackingToken);
	const trackingSnapshot = await db.collection("kioskOrderTracking").doc(trackingHash).get();
	if (!trackingSnapshot.exists) throw new HttpsError("not-found", "This order tracking link is unavailable.");
	const tracking = trackingSnapshot.data() || {};
	const expiresAt = tracking.expiresAt?.toMillis?.();
	if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
		throw new HttpsError("not-found", "This order tracking link has expired.");
	}
	const uid = String(tracking.uid || "");
	const orderId = String(tracking.orderId || "");
	if (!uid || !/^[A-Za-z0-9_-]{20,100}$/.test(orderId)) {
		throw new HttpsError("not-found", "This order tracking link is unavailable.");
	}
	const orderSnapshot = await db.collection("users").doc(uid).collection("kioskOrders").doc(orderId).get();
	if (!orderSnapshot.exists) throw new HttpsError("not-found", "This order is no longer available.");
	const order = orderSnapshot.data() || {};
	if (order.requestType !== "order" || order.source !== "kiosk") {
		throw new HttpsError("not-found", "This order is no longer available.");
	}
	const updatedAtValue = order.statusUpdatedAt?.toDate?.() || new Date(order.statusUpdatedAt || order.createdAt?.toDate?.() || Date.now());
	return {
		orderNumber: String(order.orderNumber || ""),
		status: String(order.status || "new"),
		table: String(order.table || "").slice(0, 40),
		updatedAt: Number.isNaN(updatedAtValue.valueOf()) ? "" : updatedAtValue.toISOString()
	};
});

exports.getKioskOrderDisplayLink = onCall(callableOptions, async (request) => {
	const {uid} = await assertKioskOwner(request);
	const settingsRef = db.collection("users").doc(uid).collection("data").doc("kiosk_settings");
	const displayToken = await db.runTransaction(async (transaction) => {
		const settingsSnapshot = await transaction.get(settingsRef);
		if (!settingsSnapshot.exists) {
			throw new HttpsError("failed-precondition", "Save kiosk settings before opening the order display.");
		}
		const settings = settingsSnapshot.data() || {};
		const existingToken = String(settings.orderDisplayToken || "");
		const token = /^[A-Za-z0-9_-]{32,100}$/.test(existingToken) ? existingToken : createKioskToken();
		const displayRef = db.collection("kioskOrderDisplays").doc(hashKioskValue(token));
		transaction.set(displayRef, {uid, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
		if (token !== existingToken) transaction.update(settingsRef, {orderDisplayToken: token});
		return token;
	});
	return {displayToken};
});

exports.getKioskOrderDisplay = onCall(callableOptions, async (request) => {
	const displayToken = String(request.data?.displayToken || "").trim();
	if (!/^[A-Za-z0-9_-]{32,100}$/.test(displayToken)) {
		throw new HttpsError("invalid-argument", "A valid order display link is required.");
	}
	const displaySnapshot = await db.collection("kioskOrderDisplays").doc(hashKioskValue(displayToken)).get();
	if (!displaySnapshot.exists) throw new HttpsError("not-found", "This order display is unavailable.");
	const uid = String(displaySnapshot.data()?.uid || "");
	if (!uid) throw new HttpsError("not-found", "This order display is unavailable.");
	const [profileSnapshot, ordersSnapshot] = await Promise.all([
		db.collection("users").doc(uid).collection("data").doc("shop_profile").get(),
		db.collection("users").doc(uid).collection("kioskOrders").orderBy("createdAt", "desc").limit(60).get()
	]);
	const profile = profileSnapshot.data() || {};
	const orders = ordersSnapshot.docs
		.map(document => sanitizeKioskDisplayOrder({...document.data(), orderId: document.id}))
		.filter(Boolean);
	const visibleOrders = orders.filter((order) => isKioskDisplayOrderVisible(order));
	return {
		businessName: String(profile.settings?.name || "Order display").trim().slice(0, 100),
		currency: String(profile.settings?.currency || "$").slice(0, 8),
		orders: visibleOrders
	};
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
	region: "europe-west1",
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