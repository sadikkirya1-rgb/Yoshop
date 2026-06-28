const DEFAULT_PERMISSION_TOKENS = [
  'menuTab',
  'inventoryTab',
  'customersTab',
  'reportsTab',
  'staffTab',
  'settingsTab',
  'expensesTab',
  'printingTab',
  'exportTab',
  'deleteTab',
  'discountApproval',
  'priceOverride',
  'lockPin',
  'logoutAccount'
];

const FEATURE_ALIASES = {
  products: 'menuTab',
  inventory: 'inventoryTab',
  customers: 'customersTab',
  reports: 'reportsTab',
  staff: 'staffTab',
  settings: 'settingsTab',
  expenses: 'expensesTab',
  printing: 'printingTab',
  export: 'exportTab',
  delete: 'deleteTab',
  discount: 'discountApproval',
  price: 'priceOverride',
  pin: 'lockPin',
  lock: 'lockPin',
  logout: 'logoutAccount'
};

function normalizePermissions(permissions = [], fallback = []) {
  const base = Array.isArray(permissions) ? permissions : [];
  const normalized = base
    .filter(Boolean)
    .map((permission) => String(permission).trim())
    .filter(Boolean);
  const fallbackPermissions = Array.isArray(fallback) ? fallback : [];
  const merged = [...new Set([...normalized, ...fallbackPermissions])];
  return merged.filter((permission) => permission && permission !== 'undefined');
}

function hasPermission(role, permissions = [], feature = '') {
  const normalizedRole = String(role || '').toLowerCase();
  if (!normalizedRole || normalizedRole === 'appadmin' || normalizedRole === 'manager') {
    return true;
  }

  const normalizedPermissions = normalizePermissions(permissions, []);
  const featureKey = String(feature || '').trim().toLowerCase();
  const alias = FEATURE_ALIASES[featureKey];
  const targetPermissions = [featureKey, alias].filter(Boolean);

  if (targetPermissions.length === 0) {
    return normalizedPermissions.length > 0;
  }

  return targetPermissions.some((permission) => normalizedPermissions.includes(permission));
}

function getEffectivePermissions(role, permissions = []) {
  const normalizedRole = String(role || '').toLowerCase();
  if (!normalizedRole || normalizedRole === 'appadmin' || normalizedRole === 'manager') {
    return [];
  }
  return normalizePermissions(permissions, []);
}

function getFirstAllowedTab(role, permissions = [], fallback = 'menuTab') {
  const normalizedPermissions = normalizePermissions(permissions, []);
  const normalizedRole = String(role || '').toLowerCase();
  if (normalizedRole === 'appadmin' || normalizedRole === 'manager') {
    return fallback;
  }
  if (normalizedPermissions.length === 0) {
    return fallback;
  }
  return normalizedPermissions[0] || fallback;
}

export {
  DEFAULT_PERMISSION_TOKENS,
  FEATURE_ALIASES,
  normalizePermissions,
  hasPermission,
  getEffectivePermissions,
  getFirstAllowedTab
};
