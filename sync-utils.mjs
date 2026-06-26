export function getSyncQueueCollectionPath(uid) {
  return ['users', uid, 'data', 'sync_queue', 'items'];
}

export function getSyncQueueDocumentPath(uid, actionId) {
  return [...getSyncQueueCollectionPath(uid), actionId];
}
