/*
Migration script: remove or clear `appAdminSettings.noticeReads` field from all users' shop_profile documents.
Usage:
  1. Install dependencies: `npm install firebase-admin`
  2. Ensure GOOGLE_APPLICATION_CREDENTIALS env var points to your service account JSON.
  3. Run: `node scripts/cleanup_notice_reads.js --dry-run` to preview, or without `--dry-run` to apply.

This script is destructive (it deletes the field). Review and run with caution.
*/

const admin = require('firebase-admin');
const argv = require('minimist')(process.argv.slice(2));
const dryRun = !!argv['dry-run'] || !!argv['d'];

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS env var. Set it to your service account JSON file.');
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();

async function run() {
  console.log('Starting cleanup of appAdminSettings.noticeReads (dryRun=', dryRun, ')');
  const usersSnap = await db.collection('users').get();
  console.log('Found', usersSnap.size, 'users');
  let modified = 0;
  for (const docSnap of usersSnap.docs) {
    const uid = docSnap.id;
    try {
      const shopProfileRef = db.collection('users').doc(uid).collection('data').doc('shop_profile');
      const shopSnap = await shopProfileRef.get();
      if (!shopSnap.exists) continue;
      const data = shopSnap.data() || {};
      const hasNoticeReads = data.appAdminSettings && Object.prototype.hasOwnProperty.call(data.appAdminSettings, 'noticeReads');
      if (!hasNoticeReads) continue;
      console.log('User', uid, 'has noticeReads.');
      if (!dryRun) {
        await shopProfileRef.update({ 'appAdminSettings.noticeReads': admin.firestore.FieldValue.delete() });
        modified++;
        console.log('Removed noticeReads for', uid);
      }
    } catch (e) {
      console.warn('Error processing user', uid, e);
    }
  }
  console.log('Done. Modified:', modified);
}

run().catch(err => { console.error(err); process.exit(2); });
