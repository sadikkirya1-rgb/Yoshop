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

export function limitAuditTrail(trail, maxItems = 200) {
  if (!Array.isArray(trail)) return [];
  if (trail.length <= maxItems) return trail;
  return trail.slice(-maxItems);
}
