function normalizeDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function isValidBatch(batch) {
  return batch
    && typeof batch === 'object'
    && String(batch.id || '').trim()
    && String(batch.batchNumber || '').trim()
    && normalizeDate(batch.expiryDate)
    && Number.isFinite(Number(batch.quantity))
    && Number(batch.quantity) > 0;
}

export function getPharmacyAvailableStock(batches, today = new Date().toISOString().slice(0, 10)) {
  const currentDate = normalizeDate(today);
  if (!currentDate || !Array.isArray(batches)) return 0;
  return batches.reduce((total, batch) => {
    if (!isValidBatch(batch) || batch.expiryDate < currentDate) return total;
    return total + Number(batch.quantity);
  }, 0);
}

export function sumPharmacyBatchStock(batches) {
  if (!Array.isArray(batches)) return 0;
  return batches.reduce((total, batch) => (
    isValidBatch(batch) ? total + Number(batch.quantity) : total
  ), 0);
}

export function receivePharmacyBatch(batches, incomingBatch) {
  const currentBatches = Array.isArray(batches) ? batches.map(batch => ({ ...batch })) : [];
  if (currentBatches.some(batch => !isValidBatch(batch))) {
    throw new Error('Existing medicine batch data is invalid. Review the stock record before receiving more.');
  }
  const batchNumber = String(incomingBatch?.batchNumber || '').trim();
  const expiryDate = normalizeDate(incomingBatch?.expiryDate);
  const quantity = Number(incomingBatch?.quantity);
  const cost = Number(incomingBatch?.cost);

  if (!batchNumber) throw new Error('Enter a batch or lot number.');
  if (!expiryDate) throw new Error('Enter a valid batch expiry date.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a batch quantity greater than zero.');
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Enter a valid non-negative batch cost.');

  const duplicate = currentBatches.find(batch => (
    String(batch.batchNumber || '').trim().toLowerCase() === batchNumber.toLowerCase()
  ));
  if (duplicate && duplicate.expiryDate !== expiryDate) {
    throw new Error('This batch number is already recorded with a different expiry date.');
  }
  if (duplicate) {
    duplicate.quantity = Number(duplicate.quantity) + quantity;
    duplicate.cost = cost;
    duplicate.receivedAt = incomingBatch.receivedAt || duplicate.receivedAt;
    return currentBatches;
  }

  currentBatches.push({
    ...incomingBatch,
    id: String(incomingBatch.id || '').trim(),
    batchNumber,
    expiryDate,
    quantity,
    cost
  });
  if (!currentBatches[currentBatches.length - 1].id) {
    throw new Error('A unique batch identifier is required.');
  }
  return currentBatches;
}

export function allocatePharmacyBatches(batches, quantity, today = new Date().toISOString().slice(0, 10)) {
  const requested = Number(quantity);
  const currentDate = normalizeDate(today);
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('Dispense quantity must be greater than zero.');
  if (!currentDate) throw new Error('A valid dispensing date is required.');
  if (!Array.isArray(batches)) throw new Error('This medicine has no recorded batches.');

  const nextBatches = batches.map(batch => ({ ...batch }));
  const available = getPharmacyAvailableStock(nextBatches, currentDate);
  if (available < requested) {
    throw new Error(`Only ${available} unexpired units are available; ${requested} requested.`);
  }

  const eligible = nextBatches
    .map((batch, index) => ({ batch, index }))
    .filter(({ batch }) => isValidBatch(batch) && batch.expiryDate >= currentDate)
    .sort((left, right) => (
      left.batch.expiryDate.localeCompare(right.batch.expiryDate)
      || left.batch.batchNumber.localeCompare(right.batch.batchNumber)
    ));

  let remaining = requested;
  const allocations = [];
  for (const { batch, index } of eligible) {
    if (remaining <= 0) break;
    const allocated = Math.min(Number(batch.quantity), remaining);
    batch.quantity = Number(batch.quantity) - allocated;
    remaining -= allocated;
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: allocated,
      cost: Number(batch.cost) || 0
    });
  }

  return {
    batches: nextBatches.filter(batch => Number(batch.quantity) > 0),
    allocations
  };
}

export function removePharmacyBatches(batches, quantity) {
  const requested = Number(quantity);
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('Write-off quantity must be greater than zero.');
  if (!Array.isArray(batches)) throw new Error('This medicine has no recorded batches.');
  const nextBatches = batches.map(batch => ({ ...batch }));
  const physicalStock = sumPharmacyBatchStock(nextBatches);
  if (physicalStock < requested) {
    throw new Error(`Only ${physicalStock} units are recorded across medicine batches; ${requested} requested.`);
  }

  const eligible = nextBatches
    .map((batch, index) => ({ batch, index }))
    .filter(({ batch }) => isValidBatch(batch))
    .sort((left, right) => (
      left.batch.expiryDate.localeCompare(right.batch.expiryDate)
      || left.batch.batchNumber.localeCompare(right.batch.batchNumber)
    ));
  let remaining = requested;
  const allocations = [];
  for (const { batch, index } of eligible) {
    if (remaining <= 0) break;
    const removed = Math.min(Number(batch.quantity), remaining);
    batch.quantity = Number(batch.quantity) - removed;
    remaining -= removed;
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: removed,
      cost: Number(batch.cost) || 0
    });
  }
  return {
    batches: nextBatches.filter(batch => Number(batch.quantity) > 0),
    allocations
  };
}

export function restorePharmacyBatchAllocations(batches, allocations) {
  if (!Array.isArray(allocations)) throw new Error('Sale is missing its batch allocation record.');
  const restored = Array.isArray(batches) ? batches.map(batch => ({ ...batch })) : [];
  for (const allocation of allocations) {
    const batchId = String(allocation?.batchId || '').trim();
    const quantity = Number(allocation?.quantity);
    const expiryDate = normalizeDate(allocation?.expiryDate);
    const batchNumber = String(allocation?.batchNumber || '').trim();
    if (!batchId || !batchNumber || !expiryDate || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Sale contains an invalid batch allocation; inventory was not restored.');
    }

    const existing = restored.find(batch => String(batch.id) === batchId);
    if (existing) {
      if (existing.expiryDate !== expiryDate || existing.batchNumber !== batchNumber) {
        throw new Error('Batch details no longer match the sale; inventory was not restored.');
      }
      existing.quantity = Number(existing.quantity) + quantity;
    } else {
      restored.push({
        id: batchId,
        batchNumber,
        expiryDate,
        quantity,
        cost: Number(allocation.cost) || 0
      });
    }
  }
  return restored;
}

export function getPharmacyPrescriptionErrors(record, today = new Date().toISOString().slice(0, 10)) {
  const prescription = record && typeof record === 'object' ? record : {};
  const errors = [];
  if (!String(prescription.patientName || '').trim()) errors.push('Enter the patient name.');
  if (!String(prescription.prescriberName || '').trim()) errors.push('Enter the prescriber name.');
  const prescriptionDate = normalizeDate(prescription.date);
  const currentDate = normalizeDate(today);
  if (!prescriptionDate) errors.push('Enter a valid prescription date.');
  else if (currentDate && prescriptionDate > currentDate) errors.push('Prescription date cannot be in the future.');
  if (!String(prescription.directions || '').trim()) errors.push('Enter the prescriber’s directions.');
  return errors;
}
