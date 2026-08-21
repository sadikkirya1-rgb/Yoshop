/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const functionsV1 = require("firebase-functions/v1");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

admin.initializeApp({storageBucket: "yoshop-b502f.firebasestorage.app"});
const db = admin.firestore();
const bucket = admin.storage().bucket();

const MASTER_ADMIN_UID = "Y0N3Ny1AX9VZEQb6AdRwhK8xpkg2";
const MASTER_ADMIN_EMAIL = "sadikkirya@gmail.com";
const callableOptions = {
	region: "us-central1",
	// Callable handlers still enforce Firebase Auth and operation-level permissions.
	cors: true
};

function isAppAdmin(request) {
	const auth = request.auth;
	return Boolean(auth && (
		auth.uid === MASTER_ADMIN_UID ||
		String(auth.token?.email || "").toLowerCase() === MASTER_ADMIN_EMAIL
	));
}

function assertCanDeleteAccount(request, uid) {
	if (!request.auth || (request.auth.uid !== uid && !isAppAdmin(request))) {
		throw new HttpsError("permission-denied", "You are not allowed to delete this account.");
	}
}

function getBusinessNumber(value) {
	const match = String(value || "").trim().match(/^yoshop-(\d+)$/i);
	return match ? Number.parseInt(match[1], 10) : null;
}

exports.getNextBusinessId = onCall(callableOptions, async (request) => {
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be signed in to allocate an account ID.");
	}

	const allocatorRef = db.collection("system").doc("businessIdAllocator");
	return db.runTransaction(async (transaction) => {
		const usersSnap = await transaction.get(db.collection("users").select("businessId", "shopId"));
		const usedNumbers = new Set();
		usersSnap.forEach((userDoc) => {
			const data = userDoc.data() || {};
			const number = getBusinessNumber(data.businessId || data.shopId);
			if (number !== null) usedNumbers.add(number);
		});

		let nextNumber = 1;
		while (usedNumbers.has(nextNumber)) nextNumber += 1;
		const businessId = `yoshop-${String(nextNumber).padStart(3, "0")}`;
		transaction.set(allocatorRef, {lastAllocated: businessId, updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
		return {businessId};
	});
});

async function deleteTenantData(uid) {
	const normalizedUid = String(uid || "").trim();
	if (!normalizedUid) return null;

	const userRef = db.collection("users").doc(normalizedUid);
	const userSnap = await userRef.get();
	const userData = userSnap.exists ? userSnap.data() || {} : {};
	const profileRef = userRef.collection("data").doc("shop_profile");
	const profileSnap = await profileRef.get();
	const profileData = profileSnap.exists ? profileSnap.data() || {} : {};
	const businessId = userData.businessId || userData.shopId || profileData.businessId || profileData.shopId || profileData.settings?.businessId;

	await db.recursiveDelete(userRef);

	const storagePrefixes = [`users/${normalizedUid}/`];
	if (businessId) storagePrefixes.push(`shops/${businessId}/`);
	await Promise.all(storagePrefixes.map((prefix) => bucket.deleteFiles({prefix})));
	return businessId || null;
}

exports.deleteAccountCompletely = onCall(callableOptions, async (request) => {
	const uid = String(request.data?.uid || "").trim();
	if (!uid) throw new HttpsError("invalid-argument", "A user UID is required.");
	if (uid === MASTER_ADMIN_UID) {
		throw new HttpsError("failed-precondition", "The master administrator account cannot be deleted here.");
	}
	assertCanDeleteAccount(request, uid);

	const businessId = await deleteTenantData(uid);

	try {
		await admin.auth().deleteUser(uid);
	} catch (error) {
		if (error.code !== "auth/user-not-found") throw error;
	}

	logger.info("Deleted account and tenant data", {uid, businessId: businessId || null});
	return {deleted: true, uid, businessId: businessId || null};
});

// Also clean tenant data when an administrator deletes a user directly in Firebase Auth.
exports.cleanupDeletedUserData = functionsV1.runWith({
	runtime: "nodejs20",
	region: "us-central1",
}).auth.user().onDelete(async (user) => {
	const businessId = await deleteTenantData(user.uid);
	logger.info("Cleaned data for Auth-deleted account", {uid: user.uid, businessId});
});

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
