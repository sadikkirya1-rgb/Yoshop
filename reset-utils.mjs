export const APP_STORAGE_KEYS_TO_CLEAR = [
  'lastUserUid',
  'currentUserUid',
  'currentUserRole',
  'currentUserPermissions',
  'currentLoggedInStaffName',
  'isPinVerified',
  'lastAdminNoticeSeen',
  'appNotifications',
  'pendingTransactions',
  'lastSyncTime',
  'menu',
  'activeOrders',
  'transactions',
  'settings',
  'staff',
  'dishCategories',
  'customers',
  'units',
  'expenses',
  'suppliers',
  'purchaseHistory',
  'wastageLossHistory',
  'restockHistory',
  'appAdminSettings',
  'auditTrail',
  'productViewMode',
  'themePreference',
  'shopName',
  'yoshop_invoice_counter',
  'skipCloudSyncOnNextLoad',
  'yoshopResetGuard'
];

export const RESET_GUARD_KEY = 'skipCloudSyncOnNextLoad';
export const RESET_GUARD_WINDOW_NAME = 'yoshop-reset-guard';

export function persistResetGuard(value = 'true') {
  const nextValue = String(value ?? 'true');

  try {
    if (typeof window !== 'undefined') {
      window.name = `${RESET_GUARD_WINDOW_NAME}=${nextValue}`;
    }
  } catch (error) {
    // Ignore browser restrictions for window.name, the fallback storage paths still apply.
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RESET_GUARD_KEY, nextValue);
    }
  } catch (error) {
    // Ignore storage restrictions while clearing state.
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(RESET_GUARD_KEY, nextValue);
    }
  } catch (error) {
    // Ignore storage restrictions while clearing state.
  }

  return nextValue;
}

export function readResetGuard() {
  try {
    if (typeof window !== 'undefined' && typeof window.name === 'string' && window.name.startsWith(`${RESET_GUARD_WINDOW_NAME}=`)) {
      return window.name.split('=').slice(1).join('=') || 'true';
    }
  } catch (error) {
    // Ignore browser restrictions.
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      const sessionValue = sessionStorage.getItem(RESET_GUARD_KEY);
      if (sessionValue !== null) return String(sessionValue);
    }
  } catch (error) {
    // Ignore storage restrictions.
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const localValue = localStorage.getItem(RESET_GUARD_KEY);
      if (localValue !== null) return String(localValue);
    }
  } catch (error) {
    // Ignore storage restrictions.
  }

  return null;
}

export function clearResetGuard() {
  try {
    if (typeof window !== 'undefined') {
      window.name = window.name.replace(new RegExp(`${RESET_GUARD_WINDOW_NAME}=.*`), '');
    }
  } catch (error) {
    // Ignore browser restrictions.
  }

  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(RESET_GUARD_KEY);
  } catch (error) {
    // Ignore storage restrictions.
  }

  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(RESET_GUARD_KEY);
  } catch (error) {
    // Ignore storage restrictions.
  }

  return null;
}

export function getAppResetState(overrides = {}) {
  return {
    menu: [],
    activeOrders: {},
    transactions: [],
    staff: [],
    dishCategories: [],
    customers: [],
    expenses: [],
    units: [],
    supplierList: [],
    purchaseHistory: [],
    wastageLossHistory: [],
    restockHistory: [],
    lastKnownDishImages: {},
    settings: overrides.defaultSettings ? { ...overrides.defaultSettings } : {},
    appAdminSettings: overrides.defaultAppAdminSettings ? { ...overrides.defaultAppAdminSettings } : {},
    auditTrail: [],
    pendingSyncQueue: [],
    currentLoggedInStaffName: '',
    currentUserRole: '',
    currentUserPermissions: [],
    appNotifications: [],
    userMetadata: null,
    currentUser: null
  };
}
