import test from 'node:test';
import assert from 'node:assert/strict';
import { getSyncQueueCollectionPath, getSyncQueueDocumentPath } from '../sync-utils.mjs';

test('sync queue path stays under the tenant-owned data collection', () => {
  const collectionPath = getSyncQueueCollectionPath('user-123');
  const documentPath = getSyncQueueDocumentPath('user-123', 'shop_profile-abc');

  assert.deepEqual(collectionPath, ['users', 'user-123', 'data', 'sync_queue', 'items']);
  assert.deepEqual(documentPath, ['users', 'user-123', 'data', 'sync_queue', 'items', 'shop_profile-abc']);
});
