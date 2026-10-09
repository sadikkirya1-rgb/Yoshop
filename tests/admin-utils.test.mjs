import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getConfiguredAdminEntries, mapWithConcurrency } from '../admin-utils.mjs';

test('getConfiguredAdminEntries does not auto-promote ordinary users to app admin', () => {
  const entries = getConfiguredAdminEntries({
    configuredEntries: [],
    currentEmail: 'shop@example.com'
  });

  assert.deepEqual(entries, []);
});

test('getConfiguredAdminEntries preserves explicit admin emails and optionally includes the current email', () => {
  const explicitEntries = getConfiguredAdminEntries({
    configuredEntries: [{ email: 'admin@example.com', status: 'active', type: 'password' }],
    currentEmail: 'shop@example.com'
  });

  const currentEmailEntries = getConfiguredAdminEntries({
    configuredEntries: [],
    currentEmail: 'shop@example.com',
    includeCurrentEmail: true
  });

  assert.deepEqual(explicitEntries, [{ email: 'admin@example.com', status: 'active', type: 'password' }]);
  assert.deepEqual(currentEmailEntries, [{ email: 'shop@example.com', status: 'active', type: 'google' }]);
});

test('mapWithConcurrency bounds active work and preserves input order', async () => {
  let activeCount = 0;
  let maximumActiveCount = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
    activeCount++;
    maximumActiveCount = Math.max(maximumActiveCount, activeCount);
    await Promise.resolve();
    activeCount--;
    return value * 10;
  });

  assert.equal(maximumActiveCount, 2);
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
});

test('app-admin analytics reads materialized summaries and caps recent chart detail', () => {
  const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const rulesSource = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

  assert.match(appSource, /collectionGroup\(dbFirestore, 'transactions'\)/);
  assert.match(appSource, /'system', 'admin_analytics', 'global_shards'/);
  assert.match(appSource, /'system', 'admin_analytics', 'daily_shards'/);
  assert.match(appSource, /scalingBackfillAdminSalesAnalytics/);
  assert.match(appSource, /limit\(2000\)/);
  assert.doesNotMatch(appSource, /getAggregateFromServer\(allSalesQuery/);
  assert.match(rulesSource, /match \/system\/admin_analytics\/\{document=\*\*\} \{\s*allow read: if isAdmin\(\);/);
  assert.match(rulesSource, /match \/\{path=\*\*\}\/transactions\/\{transactionId\} \{\s*allow read: if isAdmin\(\);/);
});
