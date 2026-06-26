function normalizeSettings(settings, defaults = {}) {
  const base = { ...(defaults || {}) };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return base;
  }

  return {
    ...base,
    ...settings,
    theme: settings.theme === 'dark' ? 'dark' : 'light'
  };
}

function getThemePreference(settings, fallback = 'light') {
  const normalized = normalizeSettings(settings, { theme: fallback });
  return normalized.theme === 'dark' ? 'dark' : 'light';
}

export { normalizeSettings, getThemePreference };
