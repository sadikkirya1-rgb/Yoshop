import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthErrorMessage } from '../auth-utils.mjs';

test('returns a clear message for invalid credentials', () => {
  const result = getAuthErrorMessage({ code: 'auth/invalid-credential' });
  assert.match(result.message, /password/i);
  assert.match(result.message, /Google|reset/i);
});

test('returns guidance when email/password provider is disabled', () => {
  const result = getAuthErrorMessage({ code: 'auth/operation-not-allowed' });
  assert.match(result.message, /Email\/Password/i);
  assert.match(result.message, /Firebase Console/i);
});

test('falls back to a generic message for unknown errors', () => {
  const result = getAuthErrorMessage({ message: 'Unexpected failure' });
  assert.match(result.message, /Unexpected failure/i);
});
