function normalizeText(value = '') {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getRecordIdentity(record = {}, entityType = '') {
  const id = typeof record?.recordId === 'string' && record.recordId.trim()
    ? record.recordId.trim()
    : (typeof record?.id === 'string' && record.id.trim() ? record.id.trim() : '');
  const name = normalizeText(record?.name);
  const barcode = typeof record?.barcode === 'string' ? record.barcode.trim() : '';
  const category = normalizeText(record?.category);

  if (entityType === 'products' || entityType === 'product') {
    if (id) return `id:${id}`;
    if (name) return `name:${name}`;
    if (barcode) return `barcode:${barcode}`;
    if (category) return `cat:${category}`;
  }

  if (id) return `id:${id}`;
  if (name || barcode || category) return `fallback:${[name, barcode, category].filter(Boolean).join('|')}`;
  return '';
}

function isSellableProduct(record = {}) {
  const price = Number(record?.price || 0);
  const category = typeof record?.category === 'string' ? record.category.trim() : '';
  const hasRecipe = Array.isArray(record?.recipe) && record.recipe.length > 0;
  return hasRecipe || (price > 0 && Boolean(category));
}

export function mergeProductRecord(existingRecord = {}, incomingRecord = {}) {
  const merged = { ...existingRecord, ...incomingRecord };

  const existingPrice = Number(existingRecord?.price ?? 0);
  const incomingPrice = Number(incomingRecord?.price ?? 0);
  if (incomingPrice > existingPrice) {
    merged.price = incomingRecord.price;
  } else if (existingPrice > 0 && incomingPrice <= 0) {
    merged.price = existingRecord.price;
  }

  const existingCostPrice = Number(existingRecord?.costPrice ?? 0);
  const incomingCostPrice = Number(incomingRecord?.costPrice ?? 0);
  if (incomingCostPrice > 0 && (existingCostPrice <= 0 || incomingCostPrice < existingCostPrice)) {
    merged.costPrice = incomingRecord.costPrice;
  } else if (existingCostPrice > 0 && incomingCostPrice <= 0) {
    merged.costPrice = existingRecord.costPrice;
  }

  const existingStock = Number(existingRecord?.stock ?? 0);
  const incomingStock = Number(incomingRecord?.stock ?? 0);
  if (incomingStock > 0 && (existingStock <= 0 || incomingStock > existingStock)) {
    merged.stock = incomingRecord.stock;
  } else if (existingStock > 0 && incomingStock <= 0) {
    merged.stock = existingRecord.stock;
  }

  if (!merged.category && (existingRecord?.category || incomingRecord?.category)) {
    merged.category = existingRecord?.category || incomingRecord?.category;
  }

  if (!merged.name && (existingRecord?.name || incomingRecord?.name)) {
    merged.name = existingRecord?.name || incomingRecord?.name;
  }

  if (!merged.unit && (existingRecord?.unit || incomingRecord?.unit)) {
    merged.unit = existingRecord?.unit || incomingRecord?.unit;
  }

  if (!merged.barcode && (existingRecord?.barcode || incomingRecord?.barcode)) {
    merged.barcode = existingRecord?.barcode || incomingRecord?.barcode;
  }

  if (!merged.image && (existingRecord?.image || incomingRecord?.image)) {
    merged.image = existingRecord?.image || incomingRecord?.image;
  }

  return merged;
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

    const mergedRecord = mergeProductRecord(existingRecord, record);
    if (shouldReplace || entityType === 'products' || entityType === 'product') {
      deduped[existingIndex] = mergedRecord;
    }
  });

  return deduped;
}

export function getCanonicalProductCatalog(records = [], options = {}) {
  const includeOnlySellable = options.includeOnlySellable !== undefined ? options.includeOnlySellable : true;
  const deduped = deduplicateRecords(Array.isArray(records) ? records : [], 'products');
  return includeOnlySellable ? deduped.filter(isSellableProduct) : deduped;
}
