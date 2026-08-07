import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsSyncPayload, buildTransactionSyncPayload, buildInvoiceNumber, normalizeInvoiceNumber, parseInvoiceSequence, getSyncQueueCollectionPath, getSyncQueueDocumentPath } from '../sync-utils.mjs';

test('sync queue path stays under the tenant-owned data collection', () => {
  const collectionPath = getSyncQueueCollectionPath('user-123');
  const documentPath = getSyncQueueDocumentPath('user-123', 'shop_profile-abc');

  assert.deepEqual(collectionPath, ['users', 'user-123', 'data', 'sync_queue', 'items']);
  assert.deepEqual(documentPath, ['users', 'user-123', 'data', 'sync_queue', 'items', 'shop_profile-abc']);
});

test('buildSettingsSyncPayload preserves service mode and marks payload for sync', () => {
  const payload = buildSettingsSyncPayload({ serviceMode: true, name: 'Laundry' }, { theme: 'light' });

  assert.equal(payload.serviceMode, true);
  assert.equal(payload.name, 'Laundry');
  assert.equal(payload.syncStatus, 'pending');
  assert.ok(payload.updatedAt);
  assert.ok(payload.version >= 1);
});

test('buildTransactionSyncPayload preserves order status and service details', () => {
  const payload = buildTransactionSyncPayload({
    id: 'tx-1',
    orderStatus: 'ready',
    orderType: 'service',
    serviceOrder: { pickupDate: '2026-08-10' }
  });

  assert.equal(payload.orderStatus, 'ready');
  assert.equal(payload.orderType, 'service');
  assert.equal(payload.serviceOrder.pickupDate, '2026-08-10');
  assert.equal(payload.syncStatus, 'pending');
  assert.ok(payload.updatedAt);
  assert.ok(payload.version >= 1);
});

test('buildInvoiceNumber and parser support the new date-based invoice format', () => {
  const invoiceNumber = buildInvoiceNumber(new Date('2026-08-07T12:00:00Z'), 7);
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  const sequence = parseInvoiceSequence(invoiceNumber);

  assert.equal(invoiceNumber, 'INV-07/08/2026/0007');
  assert.equal(normalized, 'INV-07/08/2026/0007');
  assert.equal(sequence, 7);
});
