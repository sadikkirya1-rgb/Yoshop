import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SALES_ANALYTICS_SHARD_COUNT,
  compareSalesVersions,
  createSalesContribution,
  createSalesContributionDelta,
  getProductChangeSignature,
  getSalesAnalyticsShard,
  getSalesDateKey,
  getSalesVersion
} = require('../functions/sales-analytics-utils.js');

test('sales contribution normalizes revenue, count, and UTC day', () => {
  assert.deepEqual(createSalesContribution({ total: '12.5', date: '2026-10-09T23:30:00-02:00' }), {
    revenue: 12.5,
    transactionCount: 1,
    date: '2026-10-10'
  });
  assert.deepEqual(createSalesContribution({ total: 'invalid', date: 'not-a-date' }), {
    revenue: 0,
    transactionCount: 1,
    date: null
  });
  assert.deepEqual(createSalesContribution(null), { revenue: 0, transactionCount: 0, date: null });
});

test('sales analytics shards are stable and stay within the configured shard count', () => {
  const first = getSalesAnalyticsShard('tenant-a', 'sale-1');
  assert.equal(getSalesAnalyticsShard('tenant-a', 'sale-1'), first);
  assert.notEqual(getSalesAnalyticsShard('tenant-a', 'sale-2'), first);
  assert.ok(Number(first) >= 0 && Number(first) < SALES_ANALYTICS_SHARD_COUNT);
});

test('sales versions compare Firestore seconds and nanoseconds without millisecond loss', () => {
  const older = getSalesVersion({ seconds: 10, nanoseconds: 100 });
  const newer = getSalesVersion({ seconds: 10, nanoseconds: 101 });
  assert.equal(compareSalesVersions(newer, older), 1);
  assert.equal(compareSalesVersions(older, newer), -1);
  assert.equal(compareSalesVersions(older, { seconds: 10, nanoseconds: 100 }), 0);
  assert.deepEqual(getSalesVersion('2026-10-09T12:00:00.123Z'), {
    seconds: Math.floor(new Date('2026-10-09T12:00:00.123Z').getTime() / 1000),
    nanoseconds: 123000000
  });
});

test('sales contribution deltas handle new sales, corrections, and deletions', () => {
  const empty = { revenue: 0, transactionCount: 0, date: null };
  const existing = { revenue: 75, transactionCount: 1, date: '2026-10-09' };
  const corrected = { revenue: 50, transactionCount: 1, date: '2026-10-10' };

  assert.deepEqual(createSalesContributionDelta(empty, existing), { revenue: 75, transactionCount: 1 });
  assert.deepEqual(createSalesContributionDelta(existing, corrected), { revenue: -25, transactionCount: 0 });
  assert.deepEqual(createSalesContributionDelta(existing, empty), { revenue: -75, transactionCount: -1 });
});

test('sales date keys accept Firestore timestamps and normalize UTC dates', () => {
  assert.equal(getSalesDateKey({ toDate: () => new Date('2026-10-09T22:00:00Z') }), '2026-10-09');
  assert.equal(getSalesDateKey('invalid'), null);
});

test('product change signatures ignore sync metadata but include business fields', () => {
  const original = { id: 'p-1', name: 'Tea', price: 5, updatedAt: 'old', syncStatus: 'pending' };
  const synced = { ...original, updatedAt: 'new', syncStatus: 'synced', lastSyncAt: 'now' };
  const repriced = { ...synced, price: 6 };

  assert.equal(getProductChangeSignature(original), getProductChangeSignature(synced));
  assert.notEqual(getProductChangeSignature(original), getProductChangeSignature(repriced));
});

test('scaling Firestore triggers subscribe to the app named database', () => {
  const functionsSource = fs.readFileSync(new URL('../scaling-functions/index.js', import.meta.url), 'utf8');

  assert.equal((functionsSource.match(/database: "yoshop"/g) || []).length, 2);
});
