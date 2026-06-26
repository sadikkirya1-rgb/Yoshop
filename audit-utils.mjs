export function createAuditEvent(trail, type, details = {}) {
  const entry = {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    details
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
