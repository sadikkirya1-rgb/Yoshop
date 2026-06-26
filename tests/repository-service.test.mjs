import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositoryService } from '../repository-service.mjs';

function createFakeRepository(initialState = {}) {
  const stores = new Map(Object.entries(initialState));
  const syncQueue = [];

  return {
    async initialize() {},
    async saveState(key, value) {
      stores.set(key, value);
      return value;
    },
    async loadState(key) {
      return stores.get(key);
    },
    async saveEntity(entityType, entity) {
      const storeName = entityType;
      stores.set(`${storeName}:${entity.id}`, entity);
      return entity;
    },
    async getEntity(entityType, id) {
      return stores.get(`${entityType}:${id}`) || null;
    },
    async enqueueSyncAction(action) {
      const envelope = { id: action.id || 'sync-1', entityType: action.entityType, payload: action.payload };
      syncQueue.push(envelope);
      return envelope;
    },
    async getSyncQueue() {
      return syncQueue.slice();
    },
    async markSyncActionProcessed(id) {
      const index = syncQueue.findIndex((item) => item.id === id);
      if (index >= 0) syncQueue.splice(index, 1);
    },
    async markSyncActionFailed(id, errorMessage) {
      const item = syncQueue.find((entry) => entry.id === id);
      if (item) item.lastError = errorMessage;
    }
  };
}

test('createRepositoryService persists state through the repository abstraction', async () => {
  const fakeRepository = createFakeRepository();
  const service = createRepositoryService({ repository: fakeRepository, userId: 'user-1', deviceId: 'device-1' });

  await service.initialize();
  await service.saveState('settings', { theme: 'dark' });
  const loaded = await service.loadState('settings');

  assert.deepEqual(loaded, { theme: 'dark' });
});

test('createRepositoryService queues sync actions and flushes them through a cloud handler', async () => {
  const fakeRepository = createFakeRepository();
  const handled = [];
  const service = createRepositoryService({
    repository: fakeRepository,
    userId: 'user-1',
    deviceId: 'device-1',
    cloudSyncHandler: async (action) => handled.push(action)
  });

  await service.initialize();
  await service.enqueueSyncAction({ id: 'sync-123', entityType: 'products', payload: { id: 'p-1' } });
  await service.flushSyncQueue();

  assert.equal(handled.length, 1);
  assert.equal(handled[0].entityType, 'products');
});
