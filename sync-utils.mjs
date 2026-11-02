function buildSyncPayload(base = {}, defaults = {}) {
  const now = new Date().toISOString();
  return {
    ...defaults,
    ...base,
    updatedAt: base.updatedAt || defaults.updatedAt || now,
    syncStatus: base.syncStatus || defaults.syncStatus || 'pending',
    version: Number(base.version || defaults.version || 0) + 1
  };
}

export function buildSettingsSyncPayload(settings = {}, defaults = {}) {
  return buildSyncPayload(settings, {
    ...defaults,
    id: 'settings',
    recordId: 'settings',
    syncStatus: 'pending'
  });
}

export function buildTransactionSyncPayload(transaction = {}, defaults = {}) {
  return buildSyncPayload(transaction, {
    ...defaults,
    id: transaction?.id || transaction?.recordId || 'transaction',
    recordId: transaction?.recordId || transaction?.id || 'transaction',
    orderStatus: 'pending',
    orderType: 'product',
    serviceOrder: {},
    syncStatus: 'pending'
  });
}

export function normalizeInvoiceNumber(invoiceNumber) {
  if (!invoiceNumber || typeof invoiceNumber !== 'string') return invoiceNumber;
  const trimmed = invoiceNumber.trim();
  if (/^INV-\d{2}\/\d{2}\/\d{4}\/\d{4}$/.test(trimmed)) return trimmed;
  const oldDashMatch = /^INV-(\d{2})(\d{2})-(\d{4})$/.exec(trimmed);
  if (oldDashMatch) return `INV-${oldDashMatch[1]}/${oldDashMatch[2]}/${oldDashMatch[3]}`;
  const dashDateMatch = /^INV-(\d{2})\/(\d{2})-(\d{4})$/.exec(trimmed);
  if (dashDateMatch) return `INV-${dashDateMatch[1]}/${dashDateMatch[2]}/${dashDateMatch[3]}`;
  return trimmed;
}

export function parseInvoiceSequence(invoiceNumber) {
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  const match = /^INV-\d{2}\/\d{2}\/\d{4}\/(\d{4})$/.exec(normalized);
  if (!match) return null;
  const serial = Number(match[1]);
  return Number.isFinite(serial) && serial > 0 ? serial : null;
}

export function buildInvoiceNumber(dateValue = new Date(), nextNumber = 1) {
  const resolvedDate = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  const dd = String(resolvedDate.getDate()).padStart(2, '0');
  const mm = String(resolvedDate.getMonth() + 1).padStart(2, '0');
  const yyyy = String(resolvedDate.getFullYear());
  const serial = String(Number(nextNumber) || 1).padStart(4, '0');
  return `INV-${dd}/${mm}/${yyyy}/${serial}`;
}

export function getSyncQueueCollectionPath(uid) {
  return ['users', uid, 'data', 'sync_queue', 'items'];
}

export function getSyncQueueDocumentPath(uid, actionId) {
  return [...getSyncQueueCollectionPath(uid), actionId];
}

export function shouldProtectEmptyOverwriteField(field, action = {}) {
  const protectedFields = new Set([
    'menu',
    'staff',
    'customers',
    'suppliers',
    'dishCategories',
    'units',
    'restockHistory'
  ]);

  if (!field || !protectedFields.has(field)) {
    return false;
  }

  const payload = action.payload || {};
  const allowList = new Set([
    ...(Array.isArray(action.allowEmptyOverwriteFields) ? action.allowEmptyOverwriteFields : []),
    ...(Array.isArray(payload.allowEmptyOverwriteFields) ? payload.allowEmptyOverwriteFields : [])
  ]);

  return !allowList.has(field);
}

export function getPendingArraySnapshot(queue = [], entityType = '', stateId = '') {
  const pendingActions = (Array.isArray(queue) ? queue : [])
    .filter(action => {
      const payload = action?.payload || {};
      const status = String(action?.syncStatus || '').trim().toLowerCase();
      return action?.entityType === entityType &&
        String(payload.id || '') === String(stateId) &&
        Array.isArray(payload.value) &&
        !['processed', 'synced', 'completed', 'done'].includes(status);
    })
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime() || 0;
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime() || 0;
      return rightTime - leftTime;
    });

  return pendingActions.length ? pendingActions[0].payload.value : undefined;
}
