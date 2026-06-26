import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityId, createSyncEnvelope, mergeSnapshotData } from '../offline-architecture.mjs';

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
