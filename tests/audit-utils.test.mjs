import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditEvent, limitAuditTrail } from '../audit-utils.mjs';

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
