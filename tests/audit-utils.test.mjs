import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditEvent, limitAuditTrail, acquireRecordLock, releaseRecordLock, isRecordLockActive, getRecordLockKey } from '../audit-utils.mjs';

test('createAuditEvent appends a structured event to the trail', () => {
  const trail = [];
  const nextTrail = createAuditEvent(trail, 'pin_login', { role: 'staff', staffName: 'Ada' });

  assert.equal(nextTrail.length, 1);
  assert.equal(nextTrail[0].type, 'pin_login');
  assert.equal(nextTrail[0].details.role, 'staff');
  assert.equal(nextTrail[0].details.staffName, 'Ada');
  assert.ok(nextTrail[0].timestamp);
});

test('limitAuditTrail trims older entries to the configured maximum', () => {
  const trail = Array.from({ length: 5 }, (_, index) => ({ id: index, type: 'test' }));

  const limited = limitAuditTrail(trail, 3);

  assert.equal(limited.length, 3);
  assert.deepEqual(limited.map(item => item.id), [2, 3, 4]);
});

test('createAuditEvent stores enterprise audit metadata for offline sync', () => {
  const trail = [];
  const nextTrail = createAuditEvent(trail, 'sale_completed', { total: 12.5 }, {
    businessId: 'biz-1',
    userId: 'user-1',
    staffId: 'staff-1',
    deviceId: 'device-1'
  });

  assert.equal(nextTrail[0].eventType, 'sale_completed');
  assert.equal(nextTrail[0].businessId, 'biz-1');
  assert.equal(nextTrail[0].userId, 'user-1');
  assert.equal(nextTrail[0].staffId, 'staff-1');
  assert.equal(nextTrail[0].deviceId, 'device-1');
  assert.equal(nextTrail[0].syncStatus, 'pending');
});

test('record locks prevent two staff members editing the same shared record simultaneously', () => {
  const locks = new Map();
  const first = acquireRecordLock(locks, 'sales', 'tx-123', 'staff-a', { ttlMs: 60000, now: 1_000 });
  const second = acquireRecordLock(locks, 'sales', 'tx-123', 'staff-b', { ttlMs: 60000, now: 1_100 });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'record_locked_by_other_staff');
  assert.equal(getRecordLockKey('sales', 'tx-123'), 'sales:tx-123');
  assert.equal(isRecordLockActive(locks, 'sales', 'tx-123', { now: 2_000 }), true);

  assert.equal(releaseRecordLock(locks, 'sales', 'tx-123', 'staff-a'), true);
  assert.equal(isRecordLockActive(locks, 'sales', 'tx-123', { now: 2_000 }), false);
});
