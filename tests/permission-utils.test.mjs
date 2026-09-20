import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePermissions, hasPermission, getEffectivePermissions, getFirstAllowedTab, ACTION_PERMISSION_TOKENS } from '../permission-utils.mjs';

test('normalizePermissions collapses duplicates and filters empty values', () => {
  assert.deepEqual(normalizePermissions(['menuTab', '', 'menuTab', 'reportsTab']), ['menuTab', 'reportsTab']);
});

test('hasPermission allows AppAdmin and ShopAdmin without explicit permission lists', () => {
  assert.equal(hasPermission('appAdmin', [], 'reports'), true);
  assert.equal(hasPermission('shopAdmin', [], 'inventory'), true);
});

test('hasPermission maps old manager data to ShopAdmin for compatibility', () => {
  assert.equal(hasPermission('manager', [], 'inventory'), true);
});

test('hasPermission respects staff permissions with feature aliases', () => {
  assert.equal(hasPermission('staff', ['inventoryTab'], 'inventory'), true);
  assert.equal(hasPermission('staff', ['menuTab'], 'reports'), false);
});

test('getEffectivePermissions returns a normalized permission list for staff', () => {
  assert.deepEqual(getEffectivePermissions('staff', ['menuTab', 'reportsTab', 'menuTab']), ['menuTab', 'reportsTab']);
});

test('getFirstAllowedTab picks the first allowed tab safely', () => {
  assert.equal(getFirstAllowedTab('staff', ['reportsTab', 'menuTab'], 'menuTab'), 'reportsTab');
  assert.equal(getFirstAllowedTab('staff', [], 'menuTab'), 'menuTab');
});

test('action permission tokens support section-specific staff actions', () => {
  assert.ok(ACTION_PERMISSION_TOKENS.includes('sales.edit'));
  assert.equal(hasPermission('staff', ['sales.edit'], 'sales.edit'), true);
  assert.equal(hasPermission('staff', ['sales.edit'], 'sales.delete'), false);
});

test('section read and write permissions are distinct and write implies actions', () => {
  assert.equal(hasPermission('staff', ['products.read'], 'products.read'), true);
  assert.equal(hasPermission('staff', ['products.read'], 'products.edit'), false);
  assert.equal(hasPermission('staff', ['products.write'], 'products.read'), true);
  assert.equal(hasPermission('staff', ['products.write'], 'products.edit'), true);
});
