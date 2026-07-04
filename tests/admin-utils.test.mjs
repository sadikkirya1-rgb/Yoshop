import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfiguredAdminEntries } from '../admin-utils.mjs';

test('getConfiguredAdminEntries does not auto-promote ordinary users to app admin', () => {
  const entries = getConfiguredAdminEntries({
    configuredEntries: [],
    currentEmail: 'shop@example.com'
  });

  assert.deepEqual(entries, []);
});

test('getConfiguredAdminEntries preserves explicit admin emails and optionally includes the current email', () => {
  const explicitEntries = getConfiguredAdminEntries({
    configuredEntries: [{ email: 'admin@example.com', status: 'active', type: 'password' }],
    currentEmail: 'shop@example.com'
  });

  const currentEmailEntries = getConfiguredAdminEntries({
    configuredEntries: [],
    currentEmail: 'shop@example.com',
    includeCurrentEmail: true
  });

  assert.deepEqual(explicitEntries, [{ email: 'admin@example.com', status: 'active', type: 'password' }]);
  assert.deepEqual(currentEmailEntries, [{ email: 'shop@example.com', status: 'active', type: 'google' }]);
});
