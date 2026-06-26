function normalizeSegments(segments) {
  return segments.flatMap((segment) => (Array.isArray(segment) ? segment : [segment]));
}

export function createCloudRepositoryService(options = {}) {
  const setDocFn = options.setDocFn || (async () => {});
  const getDocFn = options.getDocFn || (async () => ({ exists: () => false }));
  const docFn = options.docFn || ((...segments) => normalizeSegments(segments));
  const collectionFn = options.collectionFn || ((...segments) => normalizeSegments(segments));
  const deleteDocFn = options.deleteDocFn || (async () => {});

  return {
    async ensureTenantProfile(uid, payload) {
      const profileRef = docFn('users', uid, 'data', 'shop_profile');
      await setDocFn(profileRef, payload, { merge: true });
      return profileRef;
    },
    async saveTransaction(uid, txId, payload) {
      const txRef = collectionFn('users', uid, 'transactions');
      await setDocFn(docFn(txRef, txId), { ...payload, synced: true, lastSyncedAt: new Date().toISOString() }, { merge: true });
      return txRef;
    },
    async saveAuditEvent(uid, auditId, payload) {
      const auditRef = collectionFn('users', uid, 'audit_log');
      await setDocFn(docFn(auditRef, auditId), payload, { merge: true });
      return auditRef;
    },
    async saveNotification(uid, notificationId, payload) {
      const notificationRef = collectionFn('users', uid, 'notifications');
      await setDocFn(docFn(notificationRef, notificationId), payload, { merge: true });
      return notificationRef;
    },
    async readTenantProfile(uid) {
      const profileRef = docFn('users', uid, 'data', 'shop_profile');
      return getDocFn(profileRef);
    },
    async deleteTenantData(uid) {
      const txRef = collectionFn('users', uid, 'transactions');
      await deleteDocFn(docFn('users', uid, 'data', 'shop_profile'));
      await deleteDocFn(docFn('users', uid));
      return txRef;
    }
  };
}
