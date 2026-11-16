import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocatePharmacyBatches,
  getPharmacyAvailableStock,
  getPharmacyPrescriptionErrors,
  removePharmacyBatches,
  receivePharmacyBatch,
  restorePharmacyBatchAllocations,
  sumPharmacyBatchStock
} from '../pharmacy-utils.mjs';

const batches = [
  { id: 'later', batchNumber: 'L-2', expiryDate: '2027-01-31', quantity: 5, cost: 10 },
  { id: 'expired', batchNumber: 'OLD', expiryDate: '2026-03-31', quantity: 4, cost: 8 },
  { id: 'sooner', batchNumber: 'L-1', expiryDate: '2026-12-31', quantity: 3, cost: 9 }
];

test('available pharmacy stock excludes expired lots but includes today-expiring stock', () => {
  assert.equal(getPharmacyAvailableStock(batches, '2026-12-31'), 8);
  assert.equal(getPharmacyAvailableStock(batches, '2027-01-01'), 5);
  assert.equal(sumPharmacyBatchStock(batches), 12);
});

test('FEFO allocation consumes earliest unexpired lots first and can be restored', () => {
  const result = allocatePharmacyBatches(batches, 4, '2026-12-01');
  assert.deepEqual(result.allocations, [
    { batchId: 'sooner', batchNumber: 'L-1', expiryDate: '2026-12-31', quantity: 3, cost: 9 },
    { batchId: 'later', batchNumber: 'L-2', expiryDate: '2027-01-31', quantity: 1, cost: 10 }
  ]);
  assert.equal(sumPharmacyBatchStock(result.batches), 8);
  assert.equal(result.batches.find(batch => batch.id === 'expired').quantity, 4);
  assert.equal(sumPharmacyBatchStock(restorePharmacyBatchAllocations(result.batches, result.allocations)), 12);
});

test('batch write-off can remove expired stock while preserving its lot record', () => {
  const result = removePharmacyBatches(batches, 3);
  assert.deepEqual(result.allocations[0], {
    batchId: 'expired',
    batchNumber: 'OLD',
    expiryDate: '2026-03-31',
    quantity: 3,
    cost: 8
  });
  assert.equal(sumPharmacyBatchStock(result.batches), 9);
  assert.throws(() => removePharmacyBatches(result.batches, 20), /Only 9 units are recorded/);
});

test('FEFO allocation rejects unavailable quantities and invalid expiry dates', () => {
  assert.throws(() => allocatePharmacyBatches(batches, 9, '2026-12-01'), /Only 8 unexpired units are available/);
  assert.throws(() => receivePharmacyBatch([], {
    id: 'bad',
    batchNumber: 'BAD',
    expiryDate: '2026-02-30',
    quantity: 1,
    cost: 1
  }), /valid batch expiry date/);
});

test('receiving merges the same lot and rejects a conflicting expiry', () => {
  const received = receivePharmacyBatch(batches, {
    id: 'ignored',
    batchNumber: 'L-2',
    expiryDate: '2027-01-31',
    quantity: 2,
    cost: 11
  });
  assert.equal(received.find(batch => batch.id === 'later').quantity, 7);
  assert.throws(() => receivePharmacyBatch(batches, {
    id: 'conflict',
    batchNumber: 'L-2',
    expiryDate: '2027-02-28',
    quantity: 1,
    cost: 11
  }), /different expiry date/);
});

test('prescription validation requires patient, prescriber, date, and directions', () => {
  assert.deepEqual(getPharmacyPrescriptionErrors({
    patientName: 'Patient',
    prescriberName: 'Clinician',
    date: '2026-12-01',
    directions: 'Take as directed'
  }, '2026-12-02'), []);
  assert.deepEqual(getPharmacyPrescriptionErrors({ date: '2027-01-01' }, '2026-12-02'), [
    'Enter the patient name.',
    'Enter the prescriber name.',
    'Prescription date cannot be in the future.',
    'Enter the prescriber’s directions.'
  ]);
});
