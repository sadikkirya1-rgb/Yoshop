const DEFAULT_ENTITY_MAPPINGS = {
  menu: { entityType: 'products', id: 'menu' },
  products: { entityType: 'products', id: 'products' },
  activeOrders: { entityType: 'dashboardCache', id: 'activeOrders' },
  transactions: { entityType: 'sales', id: 'transactions' },
  settings: { entityType: 'settings', id: 'settings' },
  staff: { entityType: 'staff', id: 'staff' },
  dishCategories: { entityType: 'categories', id: 'dishCategories' },
  customers: { entityType: 'customers', id: 'customers' },
  units: { entityType: 'units', id: 'units' },
  restockHistory: { entityType: 'inventoryHistory', id: 'restockHistory' },
  appAdminSettings: { entityType: 'settings', id: 'appAdminSettings' },
  auditTrail: { entityType: 'auditLog', id: 'auditTrail' },
  notifications: { entityType: 'notifications', id: 'notifications' },
  customers: { entityType: 'customers', id: 'customers' },
  suppliers: { entityType: 'suppliers', id: 'suppliers' },
  purchaseOrders: { entityType: 'purchaseOrders', id: 'purchaseOrders' },
  purchaseItems: { entityType: 'purchaseItems', id: 'purchaseItems' },
  expenses: { entityType: 'expenses', id: 'expenses' },
  payments: { entityType: 'payments', id: 'payments' },
  receipts: { entityType: 'receipts', id: 'receipts' },
  reports: { entityType: 'reports', id: 'reports' },
  roles: { entityType: 'roles', id: 'roles' },
  permissions: { entityType: 'permissions', id: 'permissions' },
  subscription: { entityType: 'subscription', id: 'subscription' },
  businessProfile: { entityType: 'businessProfile', id: 'businessProfile' },
  profile: { entityType: 'businessProfile', id: 'businessProfile' },
  metadata: { entityType: 'metadata', id: 'metadata' },
  databaseVersion: { entityType: 'databaseVersion', id: 'databaseVersion' },
  productImages: { entityType: 'productImages', id: 'productImages' },
  activityLog: { entityType: 'activityLog', id: 'activityLog' },
  sales: { entityType: 'sales', id: 'sales' },
  returns: { entityType: 'returns', id: 'returns' },
  inventory: { entityType: 'inventory', id: 'inventory' },
  purchaseOrders: { entityType: 'purchaseOrders', id: 'purchaseOrders' },
  expenses: { entityType: 'expenses', id: 'expenses' },
  payments: { entityType: 'payments', id: 'payments' },
  receipts: { entityType: 'receipts', id: 'receipts' },
  roles: { entityType: 'roles', id: 'roles' },
  permissions: { entityType: 'permissions', id: 'permissions' },
  staff: { entityType: 'staff', id: 'staff' },
  settings: { entityType: 'settings', id: 'settings' },
  subscription: { entityType: 'subscription', id: 'subscription' },
  syncQueue: { entityType: 'syncQueue', id: 'syncQueue' }
};

export function createRepositoryService(options = {}) {
  const repository = options.repository;
  const userId = options.userId || 'guest';
  const deviceId = options.deviceId || 'browser';
  const cloudSyncHandler = options.cloudSyncHandler || null;
  const tenantScope = options.tenantScope || `${userId}:${deviceId}`;

  if (!repository || typeof repository !== 'object') {
    throw new Error('A repository implementation is required');
  }

  const service = {
    async initialize() {
      if (typeof repository.initialize === 'function') {
        await repository.initialize();
      }
      return repository;
    },
    async saveState(key, value, options = {}) {
      const mapping = DEFAULT_ENTITY_MAPPINGS[key];
      if (mapping) {
        const normalized = {
          id: mapping.id,
          value,
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
          businessId: options.businessId || tenantScope,
          userId: options.userId || userId,
          deviceId: options.deviceId || deviceId,
          tenantScope
        };
        await repository.saveEntity(mapping.entityType, normalized, { enqueueSync: options.enqueueSync !== false });
        return value;
      }

      await repository.saveState(key, value);
      return value;
    },
    async loadState(key) {
      const mapping = DEFAULT_ENTITY_MAPPINGS[key];
      if (mapping) {
        const entity = await repository.getEntity(mapping.entityType, mapping.id);
        if (entity && Object.prototype.hasOwnProperty.call(entity, 'value')) {
          return entity.value;
        }
        if (entity) {
          return entity;
        }
      }

      return repository.loadState(key);
    },
    async enqueueSyncAction(action) {
      if (typeof repository.enqueueSyncAction === 'function') {
        const scopedAction = {
          ...action,
          tenantScope,
          businessId: action.businessId || tenantScope,
          userId: action.userId || userId,
          deviceId: action.deviceId || deviceId
        };
        return repository.enqueueSyncAction(scopedAction);
      }
      return null;
    },
    async flushSyncQueue() {
      if (!cloudSyncHandler || typeof cloudSyncHandler !== 'function') {
        return [];
      }
      const queue = await repository.getSyncQueue();
      const results = [];
      for (const action of queue) {
        try {
          await cloudSyncHandler(action);
          await repository.markSyncActionProcessed(action.id);
          results.push({ id: action.id, status: 'processed' });
        } catch (error) {
          await repository.markSyncActionFailed(action.id, error.message || 'Sync failed');
          results.push({ id: action.id, status: 'failed', error: error.message || 'Sync failed' });
        }
      }
      return results;
    },
    getRepository() {
      return repository;
    }
  };

  return service;
}
