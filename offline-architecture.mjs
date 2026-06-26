const DEFAULT_ENTITY_STORES = [
  'products',
  'categories',
  'brands',
  'units',
  'customers',
  'suppliers',
  'sales',
  'saleItems',
  'returns',
  'inventory',
  'inventoryHistory',
  'purchaseOrders',
  'purchaseItems',
  'expenses',
  'payments',
  'receipts',
  'reports',
  'dashboardCache',
  'staff',
  'roles',
  'permissions',
  'notifications',
  'auditLog',
  'activityLog',
  'settings',  'appAdminSettings',  'businessProfile',
  'subscription',
  'productImages',
  'metadata',
  'databaseVersion',
  'appState',
  'syncQueue'
];

const ENTITY_STORE_MAP = {
  product: 'products', products: 'products',
  category: 'categories', categories: 'categories',
  brand: 'brands', brands: 'brands',
  unit: 'units', units: 'units',
  customer: 'customers', customers: 'customers',
  supplier: 'suppliers', suppliers: 'suppliers',
  sale: 'sales', sales: 'sales',
  saleItem: 'saleItems', saleItems: 'saleItems',
  returnEntity: 'returns', returns: 'returns',
  inventory: 'inventory', inventoryHistory: 'inventoryHistory',
  purchaseOrder: 'purchaseOrders', purchaseOrders: 'purchaseOrders',
  purchaseItem: 'purchaseItems', purchaseItems: 'purchaseItems',
  expense: 'expenses', expenses: 'expenses',
  payment: 'payments', payments: 'payments',
  receipt: 'receipts', receipts: 'receipts',
  report: 'reports', reports: 'reports',
  dashboard: 'dashboardCache', dashboardCache: 'dashboardCache',
  staff: 'staff',
  role: 'roles', roles: 'roles',
  permission: 'permissions', permissions: 'permissions',
  notification: 'notifications', notifications: 'notifications',
  audit: 'auditLog', auditLog: 'auditLog',
  activity: 'activityLog', activityLog: 'activityLog',
  setting: 'settings', settings: 'settings',
  business: 'businessProfile', businessProfile: 'businessProfile',
  subscription: 'subscription',
  appAdminSettings: 'appAdminSettings',
  productImage: 'productImages', productImages: 'productImages',
  metadata: 'metadata', databaseVersion: 'databaseVersion',
  appState: 'appState', syncQueue: 'syncQueue'
};

const MEMORY_DATABASES = new Map();

function createMockRequest(result, error = null) {
  const request = { result, error };
  return request;
}

function dispatchMockRequest(request, result, error = null) {
  request.result = result;
  request.error = error;
  queueMicrotask(() => {
    if (error) {
      if (typeof request.onerror === 'function') {
        request.onerror({ target: request });
      }
      return;
    }
    if (typeof request.onsuccess === 'function') {
      request.onsuccess({ target: request });
    }
  });
  return request;
}

function createMemoryDatabase(dbName) {
  const stores = new Map();
  const ensureStore = (storeName) => {
    if (!stores.has(storeName)) {
      stores.set(storeName, new Map());
    }
    return stores.get(storeName);
  };

  return {
    name: dbName,
    objectStoreNames: {
      contains: (storeName) => stores.has(storeName)
    },
    transaction(storeNames, mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return {
        objectStore(storeName) {
          const store = ensureStore(storeName);
          return {
            get(key) {
              return dispatchMockRequest(createMockRequest(store.get(key)), store.get(key));
            },
            put(value) {
              let storageKey = null;
              if (value && typeof value === 'object') {
                if ('key' in value) {
                  storageKey = value.key;
                } else if ('id' in value) {
                  storageKey = value.id;
                } else if ('_id' in value) {
                  storageKey = value._id;
                }
              }
              const actualKey = storageKey ?? value;
              store.set(actualKey, value);
              return dispatchMockRequest(createMockRequest(value), value);
            },
            getAll() {
              return dispatchMockRequest(createMockRequest(Array.from(store.values())), Array.from(store.values()));
            },
            delete(key) {
              store.delete(key);
              return dispatchMockRequest(createMockRequest(undefined), undefined);
            },
            clear() {
              store.clear();
              return dispatchMockRequest(createMockRequest(undefined), undefined);
            }
          };
        }
      };
    },
    close() {}
  };
}

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
    recordId: id,
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

function getSharedMemoryDatabase(dbName) {
  if (!MEMORY_DATABASES.has(dbName)) {
    MEMORY_DATABASES.set(dbName, createMemoryDatabase(dbName));
  }
  return MEMORY_DATABASES.get(dbName);
}

export function createBusinessRepository(options = {}) {
  const userId = options.userId || 'guest';
  const deviceId = options.deviceId || 'browser';
  const dbName = options.dbName || `posDB_${userId}${deviceId ? `_${deviceId}` : ''}`;
  const storeName = options.storeName || 'appState';
  const queueStoreName = options.queueStoreName || 'syncQueue';
  const metadataStoreName = options.metadataStoreName || 'metadata';
  const dbVersion = options.dbVersion || 3;

  let db = null;
  let dbPromise = null;
  let memoryDatabase = null;

  function resolveStoreName(entityType) {
    if (!entityType) return storeName;
    return ENTITY_STORE_MAP[String(entityType)] || String(entityType);
  }

  const open = async () => {
    if (db) return db;
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        memoryDatabase = getSharedMemoryDatabase(dbName);
        db = memoryDatabase;
        resolve(db);
        return;
      }

      const request = indexedDB.open(dbName, dbVersion);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        const allStores = [...new Set([...DEFAULT_ENTITY_STORES, storeName, queueStoreName, metadataStoreName])];
        allStores.forEach((store) => {
          if (!database.objectStoreNames.contains(store)) {
            database.createObjectStore(store, { keyPath: 'id' });
          }
        });
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
      request.onsuccess = () => resolve(request.result ? request.result.value : request.result);
      request.onerror = () => reject(request.error || new Error(`Failed to read ${key}`));
    });
  };

  const writeValue = async (store, key, value) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put({ id: key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Failed to write ${key}`));
    });
  };

  const writeEntityValue = async (store, entity) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put(entity);
      request.onsuccess = () => resolve(entity);
      request.onerror = () => reject(request.error || new Error('Failed to write entity'));
    });
  };

  const repository = {
    getDbName: () => dbName,
    db: null,
    initialize: async () => {
      await open();
      return db;
    },
    getEntityStoreNames: () => [...DEFAULT_ENTITY_STORES],
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
    saveEntity: async (entityType, entity, options = { enqueueSync: true }) => {
      const storeNameForEntity = resolveStoreName(entityType);
      const now = new Date().toISOString();
      const normalized = {
        ...entity,
        id: entity?.id || entity?._id || createEntityId(storeNameForEntity, entity),
        createdAt: entity?.createdAt || now,
        updatedAt: entity?.updatedAt || now,
        version: (entity?.version || 0) + 1,
        businessId: entity?.businessId || userId,
        userId: entity?.userId || userId,
        staffId: entity?.staffId || 'system',
        deviceId: entity?.deviceId || deviceId,
        syncStatus: entity?.syncStatus || 'pending'
      };

      await writeEntityValue(storeNameForEntity, normalized);
      if (options.enqueueSync !== false) {
        await repository.enqueueSyncAction({
          entityType: storeNameForEntity,
          payload: normalized,
          businessId: normalized.businessId,
          userId: normalized.userId,
          staffId: normalized.staffId,
          deviceId: normalized.deviceId,
          updatedBy: normalized.userId
        });
      }
      return normalized;
    },
    getEntity: async (entityType, id) => {
      const storeNameForEntity = resolveStoreName(entityType);
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([storeNameForEntity], 'readonly');
        const objectStore = transaction.objectStore(storeNameForEntity);
        const request = objectStore.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error(`Failed to read ${id}`));
      });
    },
    listEntities: async (entityType, filter = {}) => {
      const storeNameForEntity = resolveStoreName(entityType);
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([storeNameForEntity], 'readonly');
        const objectStore = transaction.objectStore(storeNameForEntity);
        const request = objectStore.getAll();
        request.onsuccess = () => {
          const items = request.result || [];
          if (!filter || typeof filter !== 'object') {
            resolve(items);
            return;
          }

          const filtered = items.filter((item) => {
            if (!item || typeof item !== 'object') return false;
            return Object.entries(filter).every(([key, value]) => item[key] === value);
          });
          resolve(filtered);
        };
        request.onerror = () => reject(request.error || new Error(`Failed to read ${entityType}`));
      });
    },
    deleteEntity: async (entityType, id) => {
      const storeNameForEntity = resolveStoreName(entityType);
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([storeNameForEntity], 'readwrite');
        const objectStore = transaction.objectStore(storeNameForEntity);
        const request = objectStore.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error || new Error(`Failed to delete ${id}`));
      });
    },
    saveBusinessProfile: async (profile) => repository.saveEntity('businessProfile', { ...profile, id: profile?.id || 'default' }),
    loadBusinessProfile: async () => repository.getEntity('businessProfile', 'default'),
    saveAuditEvent: async (event) => repository.saveEntity('auditLog', event),
    getAuditLog: async (limit = 200) => {
      const items = await repository.listEntities('auditLog');
      return items.sort((left, right) => new Date(right.timestamp || right.updatedAt || 0) - new Date(left.timestamp || left.updatedAt || 0)).slice(0, limit);
    },
    searchAuditLog: async (query = '') => {
      const normalized = String(query || '').trim().toLowerCase();
      if (!normalized) return repository.getAuditLog();
      const items = await repository.listEntities('auditLog');
      return items.filter((item) => `${item.type || ''} ${item.eventType || ''} ${JSON.stringify(item.details || item.newValues || {})}`.toLowerCase().includes(normalized));
    },
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
        const deleteRequest = typeof indexedDB !== 'undefined' ? indexedDB.deleteDatabase(dbName) : null;
        if (!deleteRequest) {
          MEMORY_DATABASES.delete(dbName);
          memoryDatabase = null;
          resolve();
          return;
        }
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error || new Error('Failed to delete repository database'));
      });
    }
  };

  return repository;
}
