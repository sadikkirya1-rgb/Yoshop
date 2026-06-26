import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRepositoryService } from '../cloud-service.mjs';

test('createCloudRepositoryService writes tenant profile and transaction payloads through adapters', async () => {
  const writes = [];
  const service = createCloudRepositoryService({
    db: { name: 'test-db' },
    setDocFn: async (ref, data, options) => {
      writes.push({ ref, data, options });
    },
    getDocFn: async () => ({ exists: () => false }),
    docFn: (...pathSegments) => pathSegments.flatMap((segment) => (Array.isArray(segment) ? segment : [segment])),
    collectionFn: (...pathSegments) => pathSegments.flatMap((segment) => (Array.isArray(segment) ? segment : [segment])),
    deleteDocFn: async () => {}
  });

  await service.ensureTenantProfile('user-1', { settings: { name: 'Demo' } });
  await service.saveTransaction('user-1', 'tx-1', { total: 10 });

  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].ref[0], 'users');
  assert.deepEqual(writes[1].ref[0], 'users');
  assert.deepEqual(writes[1].ref.slice(0, 2), ['users', 'user-1']);
  assert.equal(writes[1].data.total, 10);
});
