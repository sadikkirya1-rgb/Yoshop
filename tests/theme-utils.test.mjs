import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, getThemePreference } from '../theme-utils.mjs';

test('normalizeSettings falls back to defaults when loaded settings are missing', () => {
  const result = normalizeSettings(undefined, { theme: 'light', currency: '$' });
  assert.deepEqual(result, { theme: 'light', currency: '$' });
});

test('getThemePreference resolves a safe theme even when settings are absent', () => {
  assert.equal(getThemePreference(undefined, 'light'), 'light');
  assert.equal(getThemePreference({ theme: 'dark' }, 'light'), 'dark');
  assert.equal(getThemePreference({ theme: '' }, 'light'), 'light');
});
