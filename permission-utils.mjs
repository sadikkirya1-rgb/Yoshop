const DEFAULT_PERMISSION_TOKENS = [
  'dashboardTab',
  'menuTab',
  'addDishTab',
  'categoryTab',
  'unitTab',
  'staffTab',
  'customerTab',
  'stockTab',
  'transactionsTab',
  'reportsTab',
  'settingsTab',
  'lockPin',
  'logoutAccount',
  'expensesTab',
  'printingTab',
  'exportTab',
  'deleteTab',
  'discountApproval',
  'priceOverride'
];

const ACTION_PERMISSION_TOKENS = [
  'dashboard.read', 'dashboard.write',
  'sales.read', 'sales.write',
  'products.read', 'products.write',
  'categories.read', 'categories.write',
  'units.read', 'units.write',
  'staff.read', 'staff.write',
  'customers.read', 'customers.write',
  'inventory.read', 'inventory.write',
  'reports.read', 'reports.write',
  'settings.read', 'settings.write',
  'invoices.read', 'invoices.write',
  'products.create', 'products.edit', 'products.delete',
  'categories.create', 'categories.edit', 'categories.delete',
  'units.create', 'units.edit', 'units.delete',
  'staff.create', 'staff.edit', 'staff.delete', 'staff.permissions',
  'customers.create', 'customers.edit', 'customers.delete',
  'sales.create', 'sales.edit', 'sales.delete',
  'invoices.edit', 'invoices.delete', 'inventory.create', 'inventory.edit', 'inventory.delete',
  'settings.edit', 'reports.export', 'printing.use'
];

const FEATURE_ALIASES = {
  dashboard: 'dashboardTab',
  shop: 'menuTab',
  products: 'addDishTab',
  categories: 'categoryTab',
  units: 'unitTab',
  staff: 'staffTab',
  customers: 'customerTab',
  stock: 'stockTab',
  sales: 'transactionsTab',
  reports: 'reportsTab',
  settings: 'settingsTab',
  pin: 'lockPin',
  lock: 'lockPin',
  logout: 'logoutAccount',
  inventory: 'stockTab',
  printing: 'printingTab',
  export: 'exportTab',
  delete: 'deleteTab',
  discount: 'discountApproval',
  price: 'priceOverride'
};
const FEATURE_LEGACY_ALIASES = {
  inventory: ['inventoryTab'],
  stock: ['inventoryTab']
};

function normalizeRole(role = '') {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'appadmin') return 'appAdmin';
  if (normalized === 'shopadmin') return 'shopAdmin';
  if (normalized === 'admin') return 'shopAdmin'; // old data fallback
  if (normalized === 'manager') return 'shopAdmin'; // old data fallback
  if (normalized === 'staff') return 'staff';
  return normalized || 'staff';
}

function normalizePermissions(permissions = [], fallback = []) {
  const base = Array.isArray(permissions) ? permissions : [];
  const fallbackPermissions = Array.isArray(fallback) ? fallback : [];

  return [...new Set([...base, ...fallbackPermissions])]
    .filter(Boolean)
    .map(permission => String(permission).trim())
    .filter(permission => permission && permission !== 'undefined');
}

function hasPermission(role, permissions = [], feature = '') {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'appAdmin' || normalizedRole === 'shopAdmin') return true;

  const normalizedPermissions = normalizePermissions(permissions, []);
  const featureKey = String(feature || '').trim();
  const featureName = featureKey.toLowerCase();
  const alias = FEATURE_ALIASES[featureName];
  const legacyAliases = FEATURE_LEGACY_ALIASES[featureName] || [];
  const targets = [featureKey, alias, ...legacyAliases].filter(Boolean);

  const directMatch = targets.length === 0
    ? normalizedPermissions.length > 0
    : targets.some(permission => normalizedPermissions.includes(permission));
  if (directMatch) return true;

  const featureParts = featureKey.toLowerCase().split('.');
  const section = featureParts[0];
  const requestedAction = featureParts[1] || '';
  if (!section) return false;
  if (requestedAction === 'read' || requestedAction === 'create' || requestedAction === 'edit' || requestedAction === 'delete' || requestedAction === 'permissions') {
    return normalizedPermissions.includes(`${section}.write`);
  }
  return false;
}

function getEffectivePermissions(role, permissions = []) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'appAdmin' || normalizedRole === 'shopAdmin') return [];
  return normalizePermissions(permissions, []);
}

function getFirstAllowedTab(role, permissions = [], fallback = 'menuTab') {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'appAdmin' || normalizedRole === 'shopAdmin') return fallback;

  const normalizedPermissions = normalizePermissions(permissions, []);
  const sectionTabs = {
    dashboard: 'dashboardTab', sales: 'menuTab', products: 'addDishTab', categories: 'categoryTab',
    units: 'unitTab', staff: 'staffTab', customers: 'customerTab', inventory: 'stockTab',
    reports: 'reportsTab', settings: 'settingsTab', invoices: 'invoicesTab'
  };
  const directTab = normalizedPermissions.find(permission => permission.endsWith('Tab'));
  if (directTab) return directTab;
  const sectionPermission = normalizedPermissions.find(permission => /\.(read|write)$/.test(permission));
  return sectionPermission ? (sectionTabs[sectionPermission.split('.')[0]] || fallback) : fallback;
}

export {
  DEFAULT_PERMISSION_TOKENS,
  ACTION_PERMISSION_TOKENS,
  FEATURE_ALIASES,
  normalizePermissions,
  hasPermission,
  getEffectivePermissions,
  getFirstAllowedTab
};