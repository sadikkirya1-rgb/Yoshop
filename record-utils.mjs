function getRecordIdentity(record = {}, entityType = '') {
  const id = typeof record?.recordId === 'string' && record.recordId.trim()
    ? record.recordId.trim()
    : (typeof record?.id === 'string' && record.id.trim() ? record.id.trim() : '');
  const name = typeof record?.name === 'string' ? record.name.trim().toLowerCase() : '';
  const barcode = typeof record?.barcode === 'string' ? record.barcode.trim() : '';
  const category = typeof record?.category === 'string' ? record.category.trim().toLowerCase() : '';

  if (entityType === 'products' || entityType === 'product') {
    if (id) return `id:${id}`;
    if (barcode) return `barcode:${barcode}`;
    if (name) return `name:${name}|cat:${category}`;
  }

  if (id) return `id:${id}`;
  if (name || barcode || category) return `fallback:${[name, barcode, category].filter(Boolean).join('|')}`;
  return '';
}

export function deduplicateRecords(records = [], entityType = '') {
  if (!Array.isArray(records)) return [];

  const deduped = [];
  const seen = new Set();

  records.forEach(record => {
    if (!record || typeof record !== 'object') return;

    const key = getRecordIdentity(record, entityType);
    if (!key) {
      deduped.push(record);
      return;
    }

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(record);
      return;
    }

    const existingIndex = deduped.findIndex(item => getRecordIdentity(item, entityType) === key);
    if (existingIndex < 0) return;

    const existingRecord = deduped[existingIndex];
    const currentVersion = Number(record.version || 0);
    const existingVersion = Number(existingRecord.version || 0);
    const currentTime = Number(new Date(record.updatedAt || record.date || 0).getTime());
    const existingTime = Number(new Date(existingRecord.updatedAt || existingRecord.date || 0).getTime());
    const shouldReplace = currentVersion > existingVersion || (currentVersion === existingVersion && currentTime >= existingTime);

    if (shouldReplace) {
      deduped[existingIndex] = { ...existingRecord, ...record };
    }
  });

  return deduped;
}
