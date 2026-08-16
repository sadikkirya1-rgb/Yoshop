#!/usr/bin/env node

const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!admin.apps.length) {
  if (SERVICE_ACCOUNT_PATH) {
    const serviceAccount = require(require('path').resolve(SERVICE_ACCOUNT_PATH));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: PROJECT_ID
    });
  } else {
    admin.initializeApp({
      projectId: PROJECT_ID
    });
  }
}

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildStorageDownloadUrl(filePath) {
  const normalizedPath = String(filePath).replace(/^\//, '');
  const encodedPath = encodeURIComponent(normalizedPath).replace(/%2F/g, '%2F');
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
}

function normalizeStoragePath(raw) {
  if (!raw) return null;

  if (raw.startsWith('gs://')) {
    const withoutBucket = raw.replace(/^gs:\/\/[^/]+\//, '');
    return withoutBucket.replace(/^\//, '');
  }

  if (raw.includes('firebasestorage.googleapis.com')) {
    try {
      const match = raw.match(/\/o\/(.+?)(?:\?|$)/);
      if (match) return decodeURIComponent(match[1]).replace(/^\//, '');
    } catch (error) {
      // ignore URL parse failures and fall through
    }
  }

  return raw.replace(/^\//, '');
}

async function resolveBusinessId(uid, userDataOverride, profileDataOverride) {
  const userData = userDataOverride || (await db.collection('users').doc(uid).get()).data() || {};
  const profileData = profileDataOverride || (await db.collection('users').doc(uid).collection('data').doc('shop_profile').get()).data() || {};
  const shopSettings = profileData.settings || {};

  return (
    userData.businessId ||
    userData.shopId ||
    profileData.businessId ||
    profileData.shopId ||
    shopSettings.businessId ||
    null
  );
}

function replaceLegacyPathsInValue(value, legacyRoot, newRoot) {
  if (Array.isArray(value)) {
    return value.map(item => replaceLegacyPathsInValue(item, legacyRoot, newRoot));
  }

  if (value && typeof value === 'object') {
    const nextValue = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      nextValue[key] = replaceLegacyPathsInValue(nestedValue, legacyRoot, newRoot);
    }
    return nextValue;
  }

  if (typeof value !== 'string') return value;

  const rawPath = normalizeStoragePath(value);
  if (!rawPath) return value;

  const legacyRootNormalized = String(legacyRoot).replace(/^\//, '').replace(/\/$/, '');
  const newRootNormalized = String(newRoot).replace(/^\//, '').replace(/\/$/, '');

  if (rawPath.startsWith(`${legacyRootNormalized}/`)) {
    const relative = rawPath.slice(legacyRootNormalized.length + 1);
    const newPath = `${newRootNormalized}/${relative}`;
    return buildStorageDownloadUrl(newPath);
  }

  if (value.includes(legacyRootNormalized)) {
    return value.replace(new RegExp(escapeRegExp(legacyRootNormalized), 'g'), newRootNormalized);
  }

  const encodedLegacyRoot = encodeURIComponent(legacyRootNormalized);
  const encodedNewRoot = encodeURIComponent(newRootNormalized);
  if (value.includes(encodedLegacyRoot)) {
    return value.replace(new RegExp(escapeRegExp(encodedLegacyRoot), 'g'), encodedNewRoot);
  }

  return value;
}

async function updateFirestoreImageUrls(uid, businessId) {
  const shopProfileRef = db.collection('users').doc(uid).collection('data').doc('shop_profile');
  const shopProfileSnap = await shopProfileRef.get();
  if (!shopProfileSnap.exists) return;

  const original = shopProfileSnap.data() || {};
  const legacyRoot = `users/${uid}`;
  const newRoot = `shops/${businessId}`;
  const updated = replaceLegacyPathsInValue(original, legacyRoot, newRoot);

  if (JSON.stringify(original) !== JSON.stringify(updated)) {
    await shopProfileRef.set(updated, { merge: true });
    console.log(`Updated Firestore image URLs for ${uid} -> ${newRoot}`);
  }
}

async function migrateLegacyImagesForUser(uid) {
  const userRef = db.collection('users').doc(uid);
  const profileRef = userRef.collection('data').doc('shop_profile');

  const [userSnap, profileSnap] = await Promise.all([userRef.get(), profileRef.get()]);
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const profileData = profileSnap.exists ? profileSnap.data() || {} : {};

  const businessId = await resolveBusinessId(uid, userData, profileData);
  if (!businessId) {
    console.log(`Skipping ${uid}: no businessId/shopId found yet.`);
    return;
  }

  const legacyRoot = `users/${uid}`;
  const newRoot = `shops/${businessId}`;
  const [files] = await bucket.getFiles({ prefix: `${legacyRoot}/` });

  if (!files.length) {
    console.log(`No legacy files under ${legacyRoot} for ${uid}.`);
    await updateFirestoreImageUrls(uid, businessId);
    return;
  }

  let migratedCount = 0;
  for (const file of files) {
    const relativePath = file.name.replace(new RegExp(`^${escapeRegExp(legacyRoot)}/?`), '');
    if (!relativePath) continue;

    const destination = `${newRoot}/${relativePath}`;
    const [targetExists] = await bucket.file(destination).exists();

    if (targetExists) {
      console.log(`Target already exists for ${uid}: ${destination}. Keeping destination and deleting old copy.`);
      await file.delete();
      migratedCount += 1;
      continue;
    }

    try {
      await file.copy(destination);
      await file.delete();
      migratedCount += 1;
      console.log(`Moved ${uid}: ${file.name} -> ${destination}`);
    } catch (error) {
      console.warn(`Could not move ${uid}: ${file.name} -> ${destination}`, error);
    }
  }

  await updateFirestoreImageUrls(uid, businessId);
  console.log(`Finished user ${uid}: ${migratedCount} file(s) migrated.`);
}

async function main() {
  console.log('Starting Firebase Storage migration from users/{uid} to shops/{businessId}...');

  const usersSnap = await db.collection('users').get();
  const uids = usersSnap.docs.map(doc => doc.id);

  for (const uid of uids) {
    try {
      await migrateLegacyImagesForUser(uid);
    } catch (error) {
      console.error(`Migration failed for user ${uid}:`, error);
    }
  }

  console.log('Migration complete.');
}

main().catch(error => {
  console.error('Migration script failed:', error);
  process.exit(1);
});
