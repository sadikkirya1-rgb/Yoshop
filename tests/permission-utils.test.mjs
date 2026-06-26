import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePermissions, hasPermission, getEffectivePermissions, getFirstAllowedTab } from '../permission-utils.mjs';

test('normalizePermissions collapses duplicates and filters empty values', () => {
  assert.deepEqual(normalizePermissions(['menuTab', '', 'menuTab', 'reportsTab']), ['menuTab', 'reportsTab']);
});

test('hasPermission allows admins and managers without explicit permission lists', () => {
  assert.equal(hasPermission('appAdmin', [], 'reports'), true);
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
