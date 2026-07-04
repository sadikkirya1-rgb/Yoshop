import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessRepository, createEntityId, createSyncEnvelope, mergeSnapshotData, calculatePendingSyncCount } from '../offline-architecture.mjs';

test('createEntityId is stable for the same payload', () => {
  const first = createEntityId('transaction', { date: '2026-06-26T00:00:00.000Z', total: 25.5, items: [{ name: 'Coffee', qty: 2 }] });
  const second = createEntityId('transaction', { date: '2026-06-26T00:00:00.000Z', total: 25.5, items: [{ name: 'Coffee', qty: 2 }] });
  assert.equal(first, second);
});

test('createEntityId preserves an explicit id', () => {
  const id = createEntityId('transaction', { id: 'tx-123', total: 10 });
  assert.equal(id, 'tx-123');
});

test('mergeSnapshotData prefers newer array items and preserves local data when remote is empty', () => {
  const local = [{ id: 'a', name: 'Coffee', updatedAt: '2026-06-25T00:00:00.000Z' }];
  const remote = [{ id: 'a', name: 'Coffee', updatedAt: '2026-06-26T00:00:00.000Z' }, { id: 'b', name: 'Tea', updatedAt: '2026-06-26T00:00:00.000Z' }];
  const merged = mergeSnapshotData(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.id === 'a').name, 'Coffee');
  assert.equal(merged.find(item => item.id === 'b').name, 'Tea');
});

test('createSyncEnvelope tags pending actions with metadata', () => {
  const envelope = createSyncEnvelope('shop_profile', { foo: 'bar' }, { businessId: 'biz-1', userId: 'user-1' });
  assert.equal(envelope.entityType, 'shop_profile');
  assert.equal(envelope.syncStatus, 'pending');
  assert.equal(envelope.businessId, 'biz-1');
  assert.equal(envelope.payload.foo, 'bar');
});

test('createBusinessRepository persists entities and sync queue across repository instances', async () => {
  const repoA = createBusinessRepository({ userId: 'user-1', deviceId: 'device-1', dbName: 'enterprise-test' });
  await repoA.initialize();
  await repoA.saveEntity('products', { id: 'p-1', name: 'Coffee', stock: 10 });
  await repoA.enqueueSyncAction({ entityType: 'products', payload: { id: 'p-1', stock: 9 } });

  const repoB = createBusinessRepository({ userId: 'user-1', deviceId: 'device-1', dbName: 'enterprise-test' });
  await repoB.initialize();
  const product = await repoB.getEntity('products', 'p-1');
  const queue = await repoB.getSyncQueue();

  assert.ok(product);
  assert.equal(product.name, 'Coffee');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].entityType, 'products');
});

test('calculatePendingSyncCount ignores wrapped state snapshots and uses real pending items', () => {
  const queue = [
    { id: 'settings-state', entityType: 'snapshot', payload: { id: 'settings', value: { theme: 'dark' } }, syncStatus: 'pending' },
    { id: 'sale-1', entityType: 'sales', payload: { id: 'sale-1' }, syncStatus: 'pending' },
    { id: 'sale-2', entityType: 'productRecord', payload: { id: 'product-2' }, syncStatus: 'retry' }
  ];

  assert.equal(calculatePendingSyncCount(queue, 0), 2);
  assert.equal(calculatePendingSyncCount([], 1), 1);
});
