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
  const existingVersion = Number(existingRecord?.version || 0);
  const incomingVersion = Number(incomingRecord?.version || 0);
  const existingTime = new Date(existingRecord?.updatedAt || existingRecord?.date || 0).getTime();
  const incomingTime = new Date(incomingRecord?.updatedAt || incomingRecord?.date || 0).getTime();

  const existingHasTimeline = existingRecord?.version !== undefined || existingRecord?.updatedAt !== undefined || existingRecord?.date !== undefined;
  const incomingHasTimeline = incomingRecord?.version !== undefined || incomingRecord?.updatedAt !== undefined || incomingRecord?.date !== undefined;

  let incomingIsNewer = false;
  if (incomingHasTimeline && !existingHasTimeline) {
    incomingIsNewer = true;
  } else if (existingHasTimeline && !incomingHasTimeline) {
    incomingIsNewer = false;
  } else if (incomingHasTimeline && existingHasTimeline) {
    if (incomingVersion > existingVersion) {
      incomingIsNewer = true;
    } else if (existingVersion > incomingVersion) {
      incomingIsNewer = false;
    } else {
      incomingIsNewer = incomingTime >= existingTime;
    }
  } else {
    incomingIsNewer = true;
  }

  // Base merge starts with the older record, overridden by the newer record
  const merged = incomingIsNewer
    ? { ...existingRecord, ...incomingRecord }
    : { ...incomingRecord, ...existingRecord };

  // For specific fields, apply fallback logic if one of them is missing/undefined/zero
  // 1. Price
  const existingPrice = existingRecord?.price !== undefined ? Number(existingRecord.price) : undefined;
  const incomingPrice = incomingRecord?.price !== undefined ? Number(incomingRecord.price) : undefined;
  if (existingPrice !== undefined && incomingPrice !== undefined) {
    merged.price = incomingIsNewer ? incomingRecord.price : existingRecord.price;
  } else if (existingPrice !== undefined) {
    merged.price = existingRecord.price;
  } else if (incomingPrice !== undefined) {
    merged.price = incomingRecord.price;
  }

  // 2. CostPrice
  const existingCostPrice = existingRecord?.costPrice !== undefined ? Number(existingRecord.costPrice) : undefined;
  const incomingCostPrice = incomingRecord?.costPrice !== undefined ? Number(incomingRecord.costPrice) : undefined;
  if (existingCostPrice !== undefined && incomingCostPrice !== undefined) {
    merged.costPrice = incomingIsNewer ? incomingRecord.costPrice : existingRecord.costPrice;
  } else if (existingCostPrice !== undefined) {
    merged.costPrice = existingRecord.costPrice;
  } else if (incomingCostPrice !== undefined) {
    merged.costPrice = incomingRecord.costPrice;
  }

  // 3. Stock
  const existingStock = existingRecord?.stock !== undefined ? Number(existingRecord.stock) : undefined;
  const incomingStock = incomingRecord?.stock !== undefined ? Number(incomingRecord.stock) : undefined;
  if (existingStock !== undefined && incomingStock !== undefined) {
    merged.stock = incomingIsNewer ? incomingRecord.stock : existingRecord.stock;
  } else if (existingStock !== undefined) {
    merged.stock = existingRecord.stock;
  } else if (incomingStock !== undefined) {
    merged.stock = incomingRecord.stock;
  }

  // Fill in other string/object fields if missing in the chosen winner
  const fields = ['category', 'name', 'unit', 'barcode', 'image', 'recipe'];
  fields.forEach(field => {
    if (merged[field] === undefined || merged[field] === null || merged[field] === '') {
      merged[field] = existingRecord[field] || incomingRecord[field];
    }
  });

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
