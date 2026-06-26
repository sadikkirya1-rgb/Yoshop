export function createEntityId(entityType, payload = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };
  if (source.id || source._id) return source.id || source._id;
  const base = JSON.stringify(source);
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  }
  return `${entityType}-${hash.toString(16)}`;
}

export function createSyncEnvelope(entityType, payload = {}, context = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };
  const now = new Date().toISOString();
  const businessId = context.businessId || source.businessId || 'default-business';
  const userId = context.userId || source.userId || 'system';
  const staffId = context.staffId || source.staffId || 'system';
  const updatedBy = context.updatedBy || source.updatedBy || userId;
  const deviceId = context.deviceId || source.deviceId || 'browser';
  const id = source.id || source._id || createEntityId(entityType, source);

  return {
    id,
    entityType,
    payload: source,
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
    version: (source.version || 0) + 1,
    businessId,
    userId,
    staffId,
    updatedBy,
    deviceId,
    syncStatus: 'pending',
    lastSyncAt: null
  };
}

export function buildBusinessSnapshot(payload = {}, context = {}) {
  const now = new Date().toISOString();
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };
  return {
    ...base,
    __meta: {
      businessId: context.businessId || base.businessId || 'default-business',
      userId: context.userId || base.userId || 'system',
      staffId: context.staffId || base.staffId || 'system',
      deviceId: context.deviceId || base.deviceId || 'browser',
      updatedAt: base.__meta?.updatedAt || now,
      createdAt: base.__meta?.createdAt || now,
      version: (base.__meta?.version || 0) + 1,
      syncStatus: 'pending',
      lastSyncAt: null
    }
  };
}

export function mergeSnapshotData(localValue, remoteValue) {
  if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
    const remoteItems = Array.isArray(remoteValue) ? remoteValue : [];
    const localItems = Array.isArray(localValue) ? localValue : [];
    if (remoteItems.length === 0) return localItems;
    if (localItems.length === 0) return remoteItems;

    const combined = new Map();
    localItems.forEach((item) => {
      if (item && item.id) combined.set(item.id, item);
    });
    remoteItems.forEach((item) => {
      if (!item || !item.id) return;
      const localItem = combined.get(item.id);
      if (!localItem) {
        combined.set(item.id, item);
        return;
      }
      const localTime = new Date(localItem.updatedAt || localItem.createdAt || 0).getTime();
      const remoteTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
      combined.set(item.id, remoteTime >= localTime ? item : localItem);
    });
    return Array.from(combined.values());
  }

  if (localValue && typeof localValue === 'object' && remoteValue && typeof remoteValue === 'object') {
    const localMeta = localValue.__meta || {};
    const remoteMeta = remoteValue.__meta || {};
    const localTime = new Date(localMeta.updatedAt || 0).getTime();
    const remoteTime = new Date(remoteMeta.updatedAt || 0).getTime();
    return remoteTime >= localTime ? remoteValue : localValue;
  }

  return remoteValue ?? localValue;
}

export function createBusinessRepository(options = {}) {
  const userId = options.userId || 'guest';
  const deviceId = options.deviceId || 'browser';
  const dbName = options.dbName || `posDB_${userId}${deviceId ? `_${deviceId}` : ''}`;
  const storeName = options.storeName || 'appState';
  const queueStoreName = options.queueStoreName || 'syncQueue';
  const metadataStoreName = options.metadataStoreName || 'metadata';
  const dbVersion = options.dbVersion || 2;

  let db = null;
  let dbPromise = null;

  const open = async () => {
    if (db) return db;
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, dbVersion);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(queueStoreName)) {
          database.createObjectStore(queueStoreName, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(metadataStoreName)) {
          database.createObjectStore(metadataStoreName, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Failed to open offline repository'));
      };
    });

    return dbPromise;
  };

  const readValue = async (store, key) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([store], 'readonly');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error || new Error(`Failed to read ${key}`));
    });
  };

  const writeValue = async (store, key, value) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Failed to write ${key}`));
    });
  };

  return {
    getDbName: () => dbName,
    db: null,
    initialize: async () => {
      await open();
      return db;
    },
    saveState: async (key, value) => {
      await writeValue(storeName, key, value);
      return value;
    },
    loadState: async (key) => readValue(storeName, key),
    saveSnapshot: async (snapshot) => {
      await writeValue(storeName, 'business_snapshot', snapshot);
      return snapshot;
    },
    loadSnapshot: async () => readValue(storeName, 'business_snapshot'),
    enqueueSyncAction: async (action) => {
      const database = await open();
      const envelope = createSyncEnvelope(action.entityType || 'snapshot', action.payload || action, {
        businessId: action.businessId || userId,
        userId: action.userId || userId,
        staffId: action.staffId || 'system',
        updatedBy: action.updatedBy || userId,
        deviceId: action.deviceId || deviceId
      });

      await new Promise((resolve, reject) => {
        const transaction = database.transaction([queueStoreName], 'readwrite');
        const objectStore = transaction.objectStore(queueStoreName);
        const request = objectStore.put(envelope);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Failed to enqueue sync action'));
      });

      return envelope;
    },
    getSyncQueue: async () => {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([queueStoreName], 'readonly');
        const objectStore = transaction.objectStore(queueStoreName);
        const request = objectStore.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Failed to read sync queue'));
      });
    },
    markSyncActionProcessed: async (id) => {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([queueStoreName], 'readwrite');
        const objectStore = transaction.objectStore(queueStoreName);
        const request = objectStore.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Failed to clear sync action'));
      });
    },
    markSyncActionFailed: async (id, errorMessage) => {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([queueStoreName], 'readwrite');
        const objectStore = transaction.objectStore(queueStoreName);
        const getRequest = objectStore.get(id);

        getRequest.onsuccess = () => {
          const current = getRequest.result;
          if (!current) {
            resolve();
            return;
          }
          current.syncStatus = 'retry';
          current.lastError = errorMessage;
          current.updatedAt = new Date().toISOString();
          const putRequest = objectStore.put(current);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error || new Error('Failed to update sync action status'));
        };
        getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read sync action for update'));
      });
    },
    setMetadata: async (key, value) => writeValue(metadataStoreName, key, value),
    getMetadata: async (key) => readValue(metadataStoreName, key),
    close: async () => {
      if (db) {
        db.close();
        db = null;
      }
      dbPromise = null;
    },
    clear: async () => {
      if (db) {
        db.close();
        db = null;
      }
      dbPromise = null;
      return new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error || new Error('Failed to delete repository database'));
      });
    }
  };
}
