export function createAuditEvent(trail, type, details = {}, context = {}) {
  const entry = {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    eventType: type,
    type,
    timestamp: new Date().toISOString(),
    details,
    businessId: context.businessId || 'default-business',
    userId: context.userId || 'system',
    staffId: context.staffId || 'system',
    deviceId: context.deviceId || 'browser',
    syncStatus: 'pending',
    lastSyncAt: null
  };

  if (!Array.isArray(trail)) {
    return [entry];
  }

  const nextTrail = [...trail, entry];
  return nextTrail;
}

export function getRecordLockKey(entityType, recordId) {
  const normalizedType = String(entityType || 'record').trim();
  const normalizedId = String(recordId ?? 'unknown').trim();
  return `${normalizedType}:${normalizedId}`;
}

export function acquireRecordLock(lockState = new Map(), entityType, recordId, staffId, options = {}) {
  const map = lockState instanceof Map ? lockState : new Map();
  const key = getRecordLockKey(entityType, recordId);
  const now = options.now || Date.now();
  const ttlMs = Number(options.ttlMs || 60000);
  const lock = map.get(key);

  if (lock && lock.expiresAt > now && lock.staffId !== staffId) {
    return {
      acquired: false,
      lock,
      key,
      reason: 'record_locked_by_other_staff'
    };
  }

  const nextLock = {
    entityType,
    recordId,
    staffId,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: now + ttlMs,
    ttlMs,
    lockId: `${entityType}-${String(recordId)}-${staffId}-${now}`
  };

  map.set(key, nextLock);
  return {
    acquired: true,
    lock: nextLock,
    key,
    reason: 'record_lock_acquired'
  };
}

export function releaseRecordLock(lockState = new Map(), entityType, recordId, staffId) {
  const map = lockState instanceof Map ? lockState : new Map();
  const key = getRecordLockKey(entityType, recordId);
  const lock = map.get(key);

  if (!lock) {
    return false;
  }

  if (staffId && lock.staffId !== staffId) {
    return false;
  }

  map.delete(key);
  return true;
}

export function isRecordLockActive(lockState = new Map(), entityType, recordId, options = {}) {
  const map = lockState instanceof Map ? lockState : new Map();
  const key = getRecordLockKey(entityType, recordId);
  const lock = map.get(key);
  if (!lock) return false;
  const now = options.now || Date.now();
  if (lock.expiresAt <= now) {
    map.delete(key);
    return false;
  }
  return true;
}

export function limitAuditTrail(trail, maxItems = 200) {
  if (!Array.isArray(trail)) return [];
  if (trail.length <= maxItems) return trail;
  return trail.slice(-maxItems);
}
