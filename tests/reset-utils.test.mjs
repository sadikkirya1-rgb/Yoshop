import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_STORAGE_KEYS_TO_CLEAR, getAppResetState, persistResetGuard, readResetGuard, clearResetGuard } from '../reset-utils.mjs';

test('reset utility clears all app state buckets and preserves defaults as fresh objects', () => {
  const defaultSettings = { name: 'My Business', theme: 'light' };
  const defaultAppAdminSettings = { adminEmails: ['admin@example.com'] };

  const resetState = getAppResetState({ defaultSettings, defaultAppAdminSettings });

  assert.deepEqual(resetState.menu, []);
  assert.deepEqual(resetState.transactions, []);
  assert.deepEqual(resetState.staff, []);
  assert.deepEqual(resetState.customers, []);
  assert.deepEqual(resetState.supplierList, []);
  assert.deepEqual(resetState.purchaseHistory, []);
  assert.deepEqual(resetState.wastageLossHistory, []);
  assert.deepEqual(resetState.restockHistory, []);
  assert.deepEqual(resetState.activeOrders, {});
  assert.deepEqual(resetState.appNotifications, []);
  assert.deepEqual(resetState.auditTrail, []);
  assert.deepEqual(resetState.settings, defaultSettings);
  assert.deepEqual(resetState.appAdminSettings, defaultAppAdminSettings);
  assert.ok(APP_STORAGE_KEYS_TO_CLEAR.includes('transactions'));
  assert.ok(APP_STORAGE_KEYS_TO_CLEAR.includes('purchaseHistory'));
  assert.ok(APP_STORAGE_KEYS_TO_CLEAR.includes('supplierList') || APP_STORAGE_KEYS_TO_CLEAR.includes('suppliers'));
});

test('reset guard survives a full storage clear and is cleared after the app resumes sync', () => {
  const originalWindow = globalThis.window;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocalStorage = globalThis.localStorage;

  const fakeSession = { data: {}, setItem(k, v) { this.data[k] = String(v); }, getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; }, removeItem(k) { delete this.data[k]; }, clear() { this.data = {}; } };
  const fakeLocal = { data: {}, setItem(k, v) { this.data[k] = String(v); }, getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; }, removeItem(k) { delete this.data[k]; }, clear() { this.data = {}; } };

  globalThis.window = { name: '' };
  globalThis.sessionStorage = fakeSession;
  globalThis.localStorage = fakeLocal;

  persistResetGuard('true');
  assert.equal(readResetGuard(), 'true');

  fakeSession.clear();
  fakeLocal.clear();
  assert.equal(readResetGuard(), 'true');

  clearResetGuard();
  assert.equal(readResetGuard(), null);

  globalThis.window = originalWindow;
  globalThis.sessionStorage = originalSessionStorage;
  globalThis.localStorage = originalLocalStorage;
});
