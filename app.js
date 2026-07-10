// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, query, orderBy, limit, getDocs, deleteDoc, where, arrayUnion } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";
import { getAuth, signInWithPopup, signInWithRedirect, GoogleAuthProvider, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, linkWithCredential, EmailAuthProvider, updatePassword, reauthenticateWithCredential, updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { createBusinessRepository, createSyncEnvelope, mergeSnapshotData, createEntityId, calculatePendingSyncCount } from './offline-architecture.mjs';
import { createAuditEvent, limitAuditTrail } from './audit-utils.mjs';
import { getConfiguredAdminEntries as getConfiguredAdminEntriesFromUtils, getSubscriptionMeta, isAppAdminRestrictedIdentity } from './admin-utils.mjs';
import { getSyncQueueCollectionPath, getSyncQueueDocumentPath } from './sync-utils.mjs';
import { normalizeSettings, getThemePreference } from './theme-utils.mjs';
import { createRepositoryService } from './repository-service.mjs';
import { createCloudRepositoryService } from './cloud-service.mjs';
import { resetActiveOrdersCart } from './dashboard-state-utils.mjs';
import { normalizePermissions, hasPermission, getEffectivePermissions, getFirstAllowedTab } from './permission-utils.mjs';
import { deduplicateRecords, getCanonicalProductCatalog, mergeProductRecord } from './record-utils.mjs';
import { getAuthErrorMessage } from './auth-utils.mjs';
import { buildInvoiceListItems, mergeTransactionsPreservingDuplicates, deduplicateTransactions, getTransactionDuplicateKey, summarizeDebtInvoices } from './invoice-utils.mjs';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAYvXfCDMzylmevTAoePLW84KhxLHAX9SA",
  authDomain: "yoshop-b502f.firebaseapp.com",
  projectId: "yoshop-b502f",
  storageBucket: "yoshop-b502f.firebasestorage.app",
  messagingSenderId: "860076092806",
  appId: "1:860076092806:web:1a83971ae7637ef2cd1007",
  measurementId: "G-5PETKNBCNF"
};

// REPLACEMENT: Put your actual Firebase UID here (find it in Firebase Console > Auth)
const MASTER_APP_ADMIN_UID = "Y0N3Ny1AX9VZEQb6AdRwhK8xpkg2"; // Also detects sadikkirya@gmail.com automatically

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
let dbFirestore;
try {
  // Connecting to the named database "yoshop" which contains your data and rules
  dbFirestore = getFirestore(app, "yoshop");
  console.log("Firestore (yoshop) initialized successfully");
} catch (error) {
  // Firestore will be re-initialized on demand if needed
  console.error("Firestore init error:", error);
}

async function markNoticeReadOnServer(uid, sentAt) {
  if (!uid || !dbFirestore || !sentAt) return;
  try {
    // Record the latest read timestamp only to reduce Firestore writes
    await setDoc(doc(dbFirestore, 'users', uid, 'data', 'shop_profile'), { appAdminSettings: { lastNoticeReadAt: sentAt } }, { merge: true });
  } catch (e) {
    console.warn('Failed to mark notice read on server:', e);
  }
}

function updateHeaderNoticeBadge(unreadCount) {
  try {
          const badge = document.getElementById('update-badge');
          if (!badge) return;
          badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
          badge.classList.toggle('notice-unread-badge', unreadCount > 0);
  } catch (e) { /* non-blocking */ }
}

async function showNoticesPage() {
  // Show dedicated notices container (SPA-style)
  const main = document.getElementById('noticesPage');
  if (!main) return;
  // Hide other main sections (best-effort)
  document.querySelectorAll('main, section, [data-page]').forEach(el => { if (el.id !== 'noticesPage') el.style.display = 'none'; });
  main.style.display = 'block';
  // Render notices into the dedicated list container
  const list = document.getElementById('noticesPageList');
    await renderShopNoticesInSettings(list, true);
}

async function renderShopNoticesInSettings(containerParam) {
  const container = containerParam || document.getElementById('shopNoticesList');
  if (!container) return;
  container.innerHTML = '<p style="opacity:0.7;">Loading notices...</p>';
  if (!currentUser || !dbFirestore) {
    container.innerHTML = '<p style="opacity:0.7;">Not available.</p>';
    return;
  }
  try {
    const snap = await getDoc(doc(dbFirestore, 'users', currentUser.uid, 'data', 'shop_profile'));
    if (!snap.exists()) { container.innerHTML = '<p style="opacity:0.7;">No notices.</p>'; return; }
    const data = snap.data() || {};
    const notices = Array.isArray(data.appAdminSettings && data.appAdminSettings.notices) ? (data.appAdminSettings.notices.slice().reverse()) : (data.appAdminSettings && data.appAdminSettings.noticeMessage ? [{ message: data.appAdminSettings.noticeMessage, sentAt: data.appAdminSettings.noticeSentAt }] : []);
    if (!notices || notices.length === 0) { container.innerHTML = '<p style="opacity:0.7;">No notices.</p>'; return; }
    container.innerHTML = '';
    // compute unread count comparing sentAt to lastNoticeReadAt
    const lastRead = data.appAdminSettings && data.appAdminSettings.lastNoticeReadAt ? new Date(data.appAdminSettings.lastNoticeReadAt).getTime() : 0;
    let unreadCount = 0;
    notices.forEach(n => {
      const t = n && n.sentAt ? new Date(n.sentAt).getTime() : 0;
      if (t && t > lastRead) unreadCount += 1;
    });
    addOrUpdateAdminNoticeNotification(notices[0].message || '', notices[0].sentAt || new Date().toISOString(), notices);
    // Show unread summary at top of page list
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    const title = document.createElement('div'); title.textContent = `Notices (${notices.length})`;
    header.appendChild(title);
    if (unreadCount > 0) {
      const badge = document.createElement('div'); badge.textContent = `${unreadCount} unread`; badge.style.background = '#ff6b35'; badge.style.color = 'white'; badge.style.padding = '4px 8px'; badge.style.borderRadius = '999px'; badge.style.fontSize = '0.8em'; header.appendChild(badge);
    }
    container.appendChild(header);
    notices.forEach(n => {
      const card = document.createElement('div');
      card.className = 'admin-notice-card';
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = n.by ? `${n.by} • ${n.sentAt ? new Date(n.sentAt).toLocaleString() : ''}` : `${n.sentAt ? new Date(n.sentAt).toLocaleString() : ''}`;
      const msg = document.createElement('div'); msg.textContent = n.message || n;
      const actions = document.createElement('div'); actions.style.marginTop = '8px'; actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.justifyContent = 'flex-end';
      const markBtn = document.createElement('button'); markBtn.className = 'btn btn-secondary'; markBtn.textContent = 'Mark Read'; markBtn.onclick = async () => { try { await markNoticeReadOnServer(currentUser.uid, n.sentAt || new Date().toISOString()); markBtn.textContent = 'Marked'; markBtn.disabled = true; } catch (e) {} };
      actions.appendChild(markBtn);
      card.appendChild(meta); card.appendChild(msg); card.appendChild(actions);
      container.appendChild(card);
    });
  } catch (e) {
    console.warn('Failed to render shop notices:', e);
    container.innerHTML = '<p style="color:red;">Error loading notices.</p>';
  }
}

async function markAllNoticesRead() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(dbFirestore, 'users', currentUser.uid, 'data', 'shop_profile'));
    if (!snap.exists()) return;
    const data = snap.data() || {};
    const notices = Array.isArray(data.appAdminSettings && data.appAdminSettings.notices) ? data.appAdminSettings.notices : [];
    const latest = notices.length ? notices[notices.length - 1] : (data.appAdminSettings && data.appAdminSettings.noticeSentAt) ? { sentAt: data.appAdminSettings.noticeSentAt } : null;
    if (latest && latest.sentAt) await markNoticeReadOnServer(currentUser.uid, latest.sentAt);
    // Also set local seen key
    try { localStorage.setItem(`lastAdminNoticeSeen_${currentUser.uid}`, latest && latest.sentAt ? latest.sentAt : new Date().toISOString()); } catch (e) {}
    removeAdminNoticeNotification();
    renderShopNoticesInSettings();
  } catch (e) { console.warn(e); }
}

// Optional cleanup helper: clear any existing noticeReads array to reduce storage (does not run automatically)
async function cleanupNoticeReadsForUser(uid) {
  if (!uid || !dbFirestore) return;
  try {
    await setDoc(doc(dbFirestore, 'users', uid, 'data', 'shop_profile'), { appAdminSettings: { noticeReads: [] } }, { merge: true });
    return true;
  } catch (e) {
    console.warn('Failed to cleanup noticeReads:', e);
    return false;
  }
}

console.log("Firebase initialized for project:", firebaseConfig.projectId);

const storage = getStorage(app);
const auth = getAuth(app);
let currentUser = null;
let userMetadata = null; // Stores status and subscription info
let currentUserRole = sessionStorage.getItem('currentUserRole') || localStorage.getItem('currentUserRole');
let localRepository = null;
let localRepositoryReady = false;
let repositoryService = null;
let cloudRepositoryService = null;
let pendingSyncQueue = [];
let currentUserPermissions = normalizePermissions(JSON.parse(sessionStorage.getItem('currentUserPermissions') || localStorage.getItem('currentUserPermissions') || '[]'));
let isPinVerified = (sessionStorage.getItem('isPinVerified') || localStorage.getItem('isPinVerified')) === 'true' && !!currentUserRole;
let auditTrail = [];
let isLoggingOut = false;

function getNormalizedRole(role = currentUserRole) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'appadmin') return 'appAdmin';
  if (normalized === 'shopadmin') return 'shopAdmin';
  if (normalized === 'admin') return 'shopAdmin'; // old data fallback
  if (normalized === 'manager') return 'shopAdmin'; // old data fallback
  if (normalized === 'staff') return 'staff';
  return normalized || 'staff';
}

function isShopAdminRole(role = currentUserRole) {
  return getNormalizedRole(role) === 'shopAdmin';
}

function isAppAdminRole(role = currentUserRole) {
  return getNormalizedRole(role) === 'appAdmin';
}

function normalizeEmailAddress(value = '') {
  return String(value || '').trim().toLowerCase();
}

function getConfiguredAdminEntries(options = {}) {
  return getConfiguredAdminEntriesFromUtils({
    configuredEntries: Array.isArray(appAdminSettings?.adminEmails) ? appAdminSettings.adminEmails : [],
    currentEmail: currentUser?.email || '',
    ...options
  });
}

function getConfiguredAppAdminEmails() {
  return getConfiguredAdminEntries()
    .filter((entry) => entry.status !== 'inactive')
    .map((entry) => entry.email);
}

function formatPresenceValue(lastSeenValue) {
  if (!lastSeenValue) return 'Never';

  const parsed = new Date(lastSeenValue);
  if (Number.isNaN(parsed.getTime())) return 'Never';

  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getPresenceStatus(userData = {}) {
  const isOnline = userData.isOnline === true;
  const lastSeen = userData.lastSeen || userData.lastLogin;
  const detail = isOnline ? 'Online now' : `Last seen ${formatPresenceValue(lastSeen)}`;

  return {
    isOnline,
    detail,
    label: isOnline ? 'Online' : 'Offline',
    className: isOnline ? 'active' : 'suspended'
  };
}

async function syncUserPresence(online = true) {
  if (!dbFirestore || !auth?.currentUser?.uid) return;

  try {
    const now = new Date().toISOString();
    await setDoc(doc(dbFirestore, 'users', auth.currentUser.uid), {
      isOnline: online,
      lastSeen: now,
      ...(online ? { lastLogin: now } : {})
    }, { merge: true });
  } catch (error) {
    console.warn('Presence sync failed:', error);
  }
}

function isRecognizedAppAdminUser(user = currentUser) {
  if (!user) return false;

  return isAppAdminRestrictedIdentity({
    email: user.email,
    uid: user.uid,
    configuredAdminEmails: getConfiguredAppAdminEmails(),
    masterAdminUid: MASTER_APP_ADMIN_UID
  });
}

function isFullAccessRole(role = currentUserRole) {
  return isShopAdminRole(role) || isAppAdminRole(role);
}
function savePinSession(role, permissions = [], staffName = '') {
  const normalizedPermissions = normalizePermissions(permissions);

  sessionStorage.setItem('isPinVerified', 'true');
  localStorage.setItem('isPinVerified', 'true');

  sessionStorage.setItem('currentUserRole', role);
  localStorage.setItem('currentUserRole', role);

  sessionStorage.setItem('currentLoggedInStaffName', staffName);
  localStorage.setItem('currentLoggedInStaffName', staffName);

  if (role === 'shopAdmin' || role === 'appAdmin') {
    sessionStorage.removeItem('currentUserPermissions');
    localStorage.removeItem('currentUserPermissions');
  } else {
    sessionStorage.setItem('currentUserPermissions', JSON.stringify(normalizedPermissions));
    localStorage.setItem('currentUserPermissions', JSON.stringify(normalizedPermissions));
  }
}

function clearPinSession() {
  sessionStorage.removeItem('isPinVerified');
  localStorage.removeItem('isPinVerified');
  sessionStorage.removeItem('currentUserRole');
  localStorage.removeItem('currentUserRole');
  sessionStorage.removeItem('currentUserPermissions');
  localStorage.removeItem('currentUserPermissions');
  sessionStorage.removeItem('currentLoggedInStaffName');
  localStorage.removeItem('currentLoggedInStaffName');
}

function appendAuditEvent(type, details = {}) {
  const context = getSyncMetadataContext();
  const nextTrail = createAuditEvent(auditTrail, type, details, context);
  const latestEvent = nextTrail[nextTrail.length - 1];

  if (latestEvent) {
    nextTrail[nextTrail.length - 1] = enrichEnterpriseRecord('auditLog', latestEvent, latestEvent);
  }

  auditTrail = limitAuditTrail(nextTrail, 500);
  return auditTrail;
}

async function persistAuditTrail() {
  try {
    await saveState('auditTrail', auditTrail || []);
  } catch (error) {
    console.warn('Audit trail persistence failed:', error);
  }
}
let currentLoggedInStaffName = sessionStorage.getItem('currentLoggedInStaffName') || localStorage.getItem('currentLoggedInStaffName') || '';
function getCurrentDeviceId() {
  return new URLSearchParams(window.location.search).get('device') || 'browser';
}

function getCurrentStaffId() {
  return currentLoggedInStaffName || currentUser?.uid || 'system';
}

function getSyncMetadataContext() {
  const effectiveUid = getEffectiveUid?.() || currentUser?.uid || 'guest';
  return {
    businessId: effectiveUid,
    userId: currentUser?.uid || effectiveUid || 'system',
    staffId: getCurrentStaffId(),
    deviceId: getCurrentDeviceId()
  };
}

function enrichEnterpriseRecord(entityType, record = {}, existingRecord = null) {
  const now = new Date().toISOString();
  const context = getSyncMetadataContext();
  const currentVersion = Number(existingRecord?.version || record.version || 0);
  const generatedId = record.id || record.recordId || existingRecord?.id || existingRecord?.recordId || createEntityId(entityType, record);

  return {
    ...record,
    id: record.id || record.recordId || existingRecord?.id || generatedId,
    recordId: record.recordId || record.id || existingRecord?.recordId || generatedId,
    businessId: record.businessId || existingRecord?.businessId || context.businessId,
    userId: record.userId || existingRecord?.userId || context.userId,
    staffId: record.staffId || existingRecord?.staffId || context.staffId,
    deviceId: record.deviceId || existingRecord?.deviceId || context.deviceId,
    createdAt: record.createdAt || existingRecord?.createdAt || now,
    updatedAt: now,
    version: currentVersion + 1,
    syncStatus: record.syncStatus || 'pending',
    lastSyncAt: record.lastSyncAt || null
  };
}

function touchSettingsRecord(record = {}, recordId = 'settings') {
  const now = new Date().toISOString();
  const context = getSyncMetadataContext();
  const currentVersion = Number(record.version || 0);

  return {
    ...record,
    id: record.id || recordId,
    recordId: record.recordId || recordId,
    businessId: record.businessId || context.businessId,
    userId: record.userId || context.userId,
    staffId: context.staffId,
    deviceId: context.deviceId,
    createdAt: record.createdAt || now,
    updatedAt: now,
    version: currentVersion + 1,
    syncStatus: 'pending',
    lastSyncAt: record.lastSyncAt || null
  };
}
function pickNewestSettingsRecord(localRecord = {}, cloudRecord = {}, defaults = {}) {
  if (!cloudRecord || typeof cloudRecord !== 'object' || Object.keys(cloudRecord).length === 0) {
    return { ...defaults, ...(localRecord || {}) };
  }

  const localVersion = Number(localRecord?.version || 0);
  const cloudVersion = Number(cloudRecord?.version || 0);
  const localTime = localRecord?.updatedAt ? new Date(localRecord.updatedAt).getTime() : 0;
  const cloudTime = cloudRecord?.updatedAt ? new Date(cloudRecord.updatedAt).getTime() : 0;

  if (cloudVersion > localVersion) return { ...defaults, ...cloudRecord };
  if (cloudVersion < localVersion) return { ...defaults, ...(localRecord || {}) };
  if (cloudTime >= localTime) return { ...defaults, ...cloudRecord };

  console.warn('[SYNC_CONFLICT] Older cloud settings ignored', {
    localVersion,
    cloudVersion,
    localUpdatedAt: localRecord?.updatedAt,
    cloudUpdatedAt: cloudRecord?.updatedAt
  });

  return { ...defaults, ...(localRecord || {}) };
}

function hydrateEnterpriseRecord(entityType, record = {}, index = 0) {
  if (!record || typeof record !== 'object') return record;

  const now = new Date().toISOString();
  const context = getSyncMetadataContext();
  const generatedId = record.id || record.recordId || createEntityId(entityType, { ...record, index });

  return {
    ...record,
    id: record.id || generatedId,
    recordId: record.recordId || record.id || generatedId,
    businessId: record.businessId || context.businessId,
    userId: record.userId || context.userId,
    staffId: record.staffId || context.staffId,
    deviceId: record.deviceId || context.deviceId,
    createdAt: record.createdAt || record.date || now,
    updatedAt: record.updatedAt || record.date || now,
    version: Number(record.version || 1),
    syncStatus: record.syncStatus || (record.lastSyncAt ? 'synced' : 'pending'),
    lastSyncAt: record.lastSyncAt || null
  };
}

function normalizeProductCatalog(products = []) {
  return getCanonicalProductCatalog(Array.isArray(products) ? products : [], { includeOnlySellable: false });
}

function getProductCatalogMatchIndex(name = '', barcode = '') {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedBarcode = String(barcode || '').trim();

  return menu.findIndex(item => {
    if (!item || typeof item !== 'object') return false;
    if (normalizedBarcode && String(item.barcode || '').trim() === normalizedBarcode) return true;
    if (normalizedName && String(item.name || '').trim().toLowerCase() === normalizedName) return true;
    return false;
  });
}

function hydrateEnterpriseRecords(entityType, records = []) {
  if (!Array.isArray(records)) return [];
  const hydrated = records
    .filter(record => record && typeof record === 'object')
    .map((record, index) => hydrateEnterpriseRecord(entityType, record, index));

  return entityType === 'products' ? normalizeProductCatalog(hydrated) : deduplicateRecords(hydrated, entityType);
}
function getEnterpriseMirrorSignature() {
  const summarize = (records = []) => {
    if (!Array.isArray(records)) return '0';
    return records
      .filter(record => record && typeof record === 'object')
      .map(record => [
        record.recordId || record.id || record.name || '',
        record.version || 1,
        record.updatedAt || record.date || ''
      ].join(':'))
      .join('|');
  };

  return JSON.stringify({
    products: summarize(menu),
    categories: summarize(getCategoryRecordsFromList(dishCategories)),
    sales: summarize(transactions),
    saleItems: summarize(Array.isArray(transactions) ? transactions.flatMap(buildSaleItemRecords) : []),
    payments: summarize(Array.isArray(transactions) ? transactions.map(buildPaymentRecord) : []),
    staff: summarize(staff),
    customers: summarize(customers),
    units: summarize(units),
    inventoryHistory: summarize(restockHistory)
  });
}

async function mirrorEnterpriseRecordsToLocalStores(options = {}) {
  if (!localRepositoryReady || !localRepository || typeof localRepository.saveEntity !== 'function') {
    return;
  }

  const signature = getEnterpriseMirrorSignature();
  const metadataKey = 'enterpriseRecordMirrorSignature';

  if (!options.force && typeof localRepository.getMetadata === 'function') {
    const previousSignature = await localRepository.getMetadata(metadataKey);
    if (previousSignature === signature) {
      return;
    }
  }

  const mirrorJobs = [
    ...(Array.isArray(menu) ? menu.map(record => ['products', record]) : []),
    ...(Array.isArray(dishCategories) ? getCategoryRecordsFromList(dishCategories).map(record => ['categories', record]) : []),
    ...(Array.isArray(transactions) ? transactions.map(record => ['sales', record]) : []),
    ...(Array.isArray(transactions) ? transactions.flatMap(buildSaleItemRecords).map(record => ['saleItems', record]) : []),
    ...(Array.isArray(transactions) ? transactions.map(buildPaymentRecord).map(record => ['payments', record]) : []),
    ...(Array.isArray(staff) ? staff.map(record => ['staff', record]) : []),
    ...(Array.isArray(customers) ? customers.map(record => ['customers', record]) : []),
    ...(Array.isArray(units) ? units.map(record => ['units', record]) : []),
    ...(Array.isArray(restockHistory) ? restockHistory.map(record => ['inventoryHistory', record]) : [])
  ];

  await Promise.allSettled(
    mirrorJobs
      .filter(([, record]) => record && typeof record === 'object')
      .map(([entityType, record]) => localRepository.saveEntity(entityType, record, {
        enqueueSync: false,
        preserveVersion: true
      }))
  );

  if (typeof localRepository.setMetadata === 'function') {
    await localRepository.setMetadata(metadataKey, signature);
    await localRepository.setMetadata('enterpriseRecordMirrorLastRunAt', new Date().toISOString());
  }
}

let isInitialLoadComplete = false; // Safety flag to prevent overwriting cloud data on startup
let isMonitoringMode = false; // Tracks if App Admin has activated monitoring context

const defaultAppAdminSettings = {
  username: "",
  pin: "",
  shopStatus: "active",
  adminEmails: []
};
let appAdminSettings = { ...defaultAppAdminSettings };
let editingAdminEmail = null;

let syncFailureCount = 0;
let syncDebounceTimer = null;
let isDebouncing = false;
let isSyncing = false;
const SYNC_DEBOUNCE_DELAY = 200; // 200ms debounce for rapid changes (reduced for quicker sync)
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL = 200; // Minimum 200ms between syncs to allow near-immediate updates

// ===== PRODUCTION OPTIMIZATION: Request Deduplication & Caching =====
const requestCache = new Map(); // Cache for expensive queries
const CACHE_TTL = 30000; // 30 seconds cache for list queries
let requestInFlight = new Map(); // Track in-flight requests to avoid duplicates

/**
 * Deduplicates and caches expensive Firestore queries
 * Prevents N+1 queries and duplicate API calls
 */
async function getCachedQuery(cacheKey, queryFn, ttl = CACHE_TTL) {
  const now = Date.now();

  // Check if request is already in flight
  if (requestInFlight.has(cacheKey)) {
    return await requestInFlight.get(cacheKey);
  }

  async function resetLocalDatabase() {
    if (typeof showAppConfirm === 'function') {
      const resp = await showAppConfirm('This will wipe all local data. Continue?', 'Reset Local Data', 'Continue', 'Cancel');
      if (!resp || !resp.confirmed) return;
    }
    try {
      indexedDB.deleteDatabase('posDB');
      location.reload();
    } catch (e) {
      console.error('Failed to reset local DB:', e);
      if (typeof showAppAlert === 'function') showAppAlert('Could not reset local database.', 'Reset Failed');
      else alert('Could not reset local database.');
    }
  }

  // Check cache validity
  const cached = requestCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < ttl) {
    return cached.data;
  }

  // Create new request promise
  const promise = queryFn().then(data => {
    requestCache.set(cacheKey, { data, timestamp: now });
    requestInFlight.delete(cacheKey);
    return data;
  }).catch(error => {
    requestInFlight.delete(cacheKey);
    throw error;
  });

  requestInFlight.set(cacheKey, promise);
  return promise;
}

// ===== PRODUCTION OPTIMIZATION: Firestore Pagination with Cursors =====
let shopsPaginationState = {
  currentPage: 0,
  pageSize: 25, // Increased from 10 for better performance
  lastDocSnapshot: null,
  hasMore: true,
  totalLoaded: 0
};

/**
 * Optimized shop query with pagination and aggregation
 * Reduces memory usage and API calls for 100+ shops
 */
async function getShopsPageOptimized(pageNumber = 0) {
  try {
    const pageSize = 25;
    const startIndex = pageNumber * pageSize;

    // For production with 100+ shops, use aggregation queries when available
    // or fetch with pagination cursor
    // ENFORCE TENANT ISOLATION: Only Master Admin may query global users list
    const effectiveUid = getEffectiveUid();
    const isMasterAdmin = (effectiveUid === MASTER_APP_ADMIN_UID || (currentUser && currentUser.email === 'sadikkirya@gmail.com'));

    if (!isMasterAdmin) {
      // Normal tenant: load only their private profile document
      if (!effectiveUid) return { docs: [], pageNumber, pageSize, total: 0, hasMore: false };
      const docRef = doc(dbFirestore, 'users', effectiveUid);
      const single = await getDoc(docRef);
      return {
        docs: single.exists() ? [single] : [],
        pageNumber,
        pageSize: 1,
        total: single.exists() ? 1 : 0,
        hasMore: false
      };
    }

    // Master admin: allowed to query global users with pagination
    const usersSnap = await getCachedQuery(
      `shops_page_${pageNumber}`,
      async () => {
        const queryConstraints = [
          orderBy('lastLogin', 'desc'),
          limit(pageSize * (pageNumber + 1))
        ];
        return await getDocs(query(collection(dbFirestore, "users"), ...queryConstraints));
      },
      60000 // Cache for 1 minute
    );

    return {
      docs: usersSnap.docs,
      pageNumber,
      pageSize,
      total: usersSnap.docs.length,
      hasMore: usersSnap.docs.length === (pageSize * (pageNumber + 1))
    };
  } catch (error) {
    console.error('[QUERY] Shops page fetch failed:', error);
    return { docs: [], error: error.message };
  }
}

/**
 * Ensure tenant's local and cloud parameters are initialized after login/registration
 */
async function setupTenantShopParameters(uid) {
  try {
    if (!uid) return;

    const isRestrictedIdentity = isAppAdminRestrictedIdentity({
      email: currentUser?.email || '',
      uid,
      configuredAdminEmails: getConfiguredAppAdminEmails(),
      masterAdminUid: MASTER_APP_ADMIN_UID
    });

    if (isRestrictedIdentity) {
      console.log(`[SHOP] Skipping tenant shop initialization for app admin identity ${uid}`);
      return;
    }
    // Initialize IndexedDB for this user (namespaced)
    await initDB(uid);

    // Ensure cloud profile document exists with sane defaults
    const profileRef = doc(dbFirestore, 'users', uid, 'data', 'shop_profile');
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      await setDoc(profileRef, {
        settings: { name: 'My Business', currency: '$' },
        menu: [],
        staff: [],
        customers: [],
        dishCategories: [],
        units: [],
        restockHistory: [],
        lastUpdated: new Date().toISOString()
      });
    } else {
      const cloudData = snap.data() || {};
      const recoveredMenu = getCloudMenuItems(cloudData);
      const recoveredCategories = getCloudCategoryList(cloudData);
      const compatibilityPatch = {};

      if ((!Array.isArray(cloudData.menu) || cloudData.menu.length === 0) && recoveredMenu.length > 0) {
        compatibilityPatch.menu = recoveredMenu;
      }

      if ((!Array.isArray(cloudData.dishCategories) || cloudData.dishCategories.length === 0) && recoveredCategories.length > 0) {
        compatibilityPatch.dishCategories = recoveredCategories;
      }

      if (Object.keys(compatibilityPatch).length > 0) {
        await setDoc(profileRef, {
          ...compatibilityPatch,
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }
    }

    // Load initial tenant data into memory and mark ready
    await setupRealTimeSync(uid);
  } catch (error) {
    console.warn('setupTenantShopParameters error:', error);
  }
}

/**
 * Register a new tenant shop programmatically with immediate tenant initialization
 */
async function registerNewTenantShop(email, password, businessName) {
  if (!email || !password) throw new Error('Email and password required');

  if (isAppAdminRestrictedIdentity({
    email,
    uid: auth.currentUser?.uid || '',
    configuredAdminEmails: getConfiguredAppAdminEmails(),
    masterAdminUid: MASTER_APP_ADMIN_UID
  })) {
    throw new Error('App administrator accounts cannot create or own shops.');
  }
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  if (businessName) await updateProfile(userCredential.user, { displayName: businessName });

  // Root metadata
  await setDoc(doc(dbFirestore, 'users', userCredential.user.uid), {
    email: email,
    name: businessName || null,
    status: 'pending',
    createdAt: new Date().toISOString()
  }, { merge: true });

  // Tenant private profile
  await setDoc(doc(dbFirestore, 'users', userCredential.user.uid, 'data', 'shop_profile'), {
    settings: { name: businessName || 'My Business' },
    menu: [],
    lastUpdated: new Date().toISOString()
  }, { merge: true });

  // Initialize local DB and run first sync
  await setupTenantShopParameters(userCredential.user.uid);
  return userCredential.user;
}

// ===== PRODUCTION ERROR MONITORING =====
const errorLog = [];
const MAX_ERROR_LOG_SIZE = 100;

/**
 * Production error logger with optional remote monitoring
 * Captures stack traces and context for debugging
 */
function captureError(errorType, error, context = {}) {
  const errorEntry = {
    timestamp: new Date().toISOString(),
    type: errorType,
    message: error?.message || String(error),
    stack: error?.stack,
    context,
    userAgent: navigator.userAgent,
    url: window.location.href
  };

  errorLog.push(errorEntry);
  if (errorLog.length > MAX_ERROR_LOG_SIZE) {
    errorLog.shift(); // Keep only last 100 errors
  }

  console.error(`[${errorType}]`, error, context);

  // In production, you could send to external monitoring service:
  // if (window.location.hostname !== 'localhost') {
  //   sendToMonitoringService(errorEntry);
  // }
}

/**
 * Export error log for debugging
 */
function exportErrorLog() {
  const blob = new Blob([JSON.stringify(errorLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `yoshop-errors-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
}

// ===== PRODUCTION OPTIMIZATION: Health Monitoring =====
const healthMetrics = {
  firebaseCalls: 0,
  firebaseErrors: 0,
  indexedDBWrites: 0,
  indexedDBErrors: 0,
  lastCheckTime: Date.now()
};

/**
 * Get health status of app
 */
function getAppHealthStatus() {
  const now = Date.now();
  const uptime = now - healthMetrics.lastCheckTime;
  const errorRate = healthMetrics.firebaseCalls > 0
    ? (healthMetrics.firebaseErrors / healthMetrics.firebaseCalls) * 100
    : 0;

  return {
    status: errorRate < 5 ? 'healthy' : errorRate < 15 ? 'degraded' : 'critical',
    uptime: `${(uptime / 1000 / 60).toFixed(2)} minutes`,
    errorRate: `${errorRate.toFixed(2)}%`,
    firebaseCalls: healthMetrics.firebaseCalls,
    errors: healthMetrics.firebaseErrors,
    cacheSize: requestCache.size
  };
}

// Helper function to upload images to Firebase Storage
async function uploadImage(base64Data, path) {
  try {
    if (!base64Data || !base64Data.startsWith('data:image')) return base64Data;
    let uid = getEffectiveUid() || 'anonymous';
    const userPath = `users/${uid}/${path}`;
    const storageRef = ref(storage, userPath);
    await uploadString(storageRef, base64Data, 'data_url');
    return await getDownloadURL(storageRef);
  } catch (error) {
    if (error.code === 'storage/unauthorized') {
      console.error("CRITICAL: Firebase Storage permission denied. Please ensure your Storage Security Rules allow writes to the 'users/' path for authenticated users.");
    }
    console.error("Image upload failed:", error);
    return base64Data; // Return original (likely placeholder) on failure
  }
}

/**
 * Clears a specific image URL from all Service Worker / Cache API caches
 * to ensure the new version is fetched and displayed immediately.
 */
async function clearImageFromCache(url) {
  if (!url || !window.caches) return;
  try {
    const cacheNames = await window.caches.keys();
    for (const cacheName of cacheNames) {
      const cache = await window.caches.open(cacheName);
      // Delete the exact URL
      const deletedExact = await cache.delete(url);
      if (deletedExact) {
        console.log(`[CACHE] Deleted exact URL from cache ${cacheName}:`, url);
      }

      // Also delete any cache entries matching the URL without query parameters
      const keys = await cache.keys();
      for (const request of keys) {
        const requestUrlClean = request.url.split('?')[0];
        const targetUrlClean = url.split('?')[0];
        if (requestUrlClean === targetUrlClean) {
          await cache.delete(request);
          console.log(`[CACHE] Deleted matched request URL from cache ${cacheName}:`, request.url);
        }
      }
    }
  } catch (e) {
    console.warn('[CACHE] Error clearing image from cache:', e);
  }
}

/**
 * Returns the UID of the account currently being viewed/operated on.
 * This handles the context switch during Admin Monitoring mode.
 */
function getEffectiveUid() {
  if (isMonitoringMode && userMetadata && userMetadata.uid) return userMetadata.uid;
  if (currentUser) return currentUser.uid;
  return null;
}

function isMasterAdminUser() {
  return currentUser && (currentUser.uid === MASTER_APP_ADMIN_UID || currentUser.email === 'sadikkirya@gmail.com');
}

// ===== IndexedDB Setup =====
let db;
const DB_VERSION = 1;
const STORE_NAME = 'appState';
const CART_ID = 'SHOP_CART';

const APP_STORAGE_KEYS_TO_CLEAR = [
  'lastUserUid',
  'currentUserUid',
  'currentUserRole',
  'currentUserPermissions',
  'currentLoggedInStaffName',
  'isPinVerified',
  'lastAdminNoticeSeen',
  'appNotifications',
  'pendingTransactions',
  'lastSyncTime'
];

function clearBrowserStorageForThisOrigin() {
  try {
    const localKeys = Object.keys(localStorage || {});
    localKeys.forEach((key) => {
      if (!key || key.startsWith('firebase:')) return;
      try { localStorage.removeItem(key); } catch (e) { }
    });
  } catch (e) {
    console.warn('[CLEAR] Failed to clear localStorage:', e);
  }

  try {
    const sessionKeys = Object.keys(sessionStorage || {});
    sessionKeys.forEach((key) => {
      try { sessionStorage.removeItem(key); } catch (e) { }
    });
  } catch (e) {
    console.warn('[CLEAR] Failed to clear sessionStorage:', e);
  }
}

async function deleteYoShopIndexedDatabases() {
  const namedDatabases = [];
  if (window.indexedDB && typeof window.indexedDB.databases === 'function') {
    try {
      const databases = await window.indexedDB.databases();
      databases.filter(Boolean).forEach((database) => {
        if (database && database.name) namedDatabases.push(database.name);
      });
    } catch (e) {
      console.warn('[CLEAR] Unable to list IndexedDB databases:', e);
    }
  }

  if (!namedDatabases.length) {
    namedDatabases.push('posDB');
  }

  const uniqueDatabaseNames = [...new Set(namedDatabases.filter((name) => typeof name === 'string' && (name === 'posDB' || name.startsWith('posDB_'))))];
  for (const dbName of uniqueDatabaseNames) {
    await new Promise((resolve) => {
      const request = window.indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
}

async function clearYoShopLocalData(options = {}) {
  const { skipConfirm = false, reload = true } = options;

  if (!skipConfirm && typeof showAppConfirm === 'function') {
    const response = await showAppConfirm('This will remove the local sales archive, IndexedDB data, app caches, and browser storage for YoShop. Continue?', 'Clear Local App Data', 'Clear Data', 'Cancel');
    if (!response || !response.confirmed) return false;
  }

  try {
    if (db) {
      db.close();
      db = null;
    }
    if (localRepository) {
      await localRepository.close();
      localRepository = null;
    }

    repositoryService = null;
    localRepositoryReady = false;

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }

    clearBrowserStorageForThisOrigin();
    await deleteYoShopIndexedDatabases();

    APP_STORAGE_KEYS_TO_CLEAR.forEach((key) => {
      try { localStorage.removeItem(key); } catch (e) { }
      try { sessionStorage.removeItem(key); } catch (e) { }
    });

    if (reload) {
      window.location.reload();
    }
    return true;
  } catch (error) {
    console.error('[CLEAR] Failed to clear YoShop local data:', error);
    return false;
  }
}

async function resetLocalDatabase() {
  return clearYoShopLocalData({ skipConfirm: false, reload: true });
}

const shouldClearLocalDataOnLoad = new URLSearchParams(window.location.search).get('clearLocalData') === '1';
if (shouldClearLocalDataOnLoad) {
  window.addEventListener('load', () => {
    clearYoShopLocalData({ skipConfirm: true, reload: true }).catch((error) => {
      console.error('[CLEAR] Startup cleanup failed:', error);
      window.location.reload();
    });
  });
}

async function initDB(userId = 'guest') {
  const deviceId = new URLSearchParams(window.location.search).get('device') || '';
  const effectiveUserId = userId || 'guest';
  localRepository = createBusinessRepository({ userId: effectiveUserId, deviceId });
  repositoryService = createRepositoryService({
    repository: localRepository,
    userId: effectiveUserId,
    deviceId,
    cloudSyncHandler: async (action) => {
      if (!currentUser || !dbFirestore) {
        throw new Error('Cloud sync is waiting for an authenticated session and Firestore connection.');
      }
      await syncCloudAction(action);
    }
  });
  cloudRepositoryService = createCloudRepositoryService({
    setDocFn: async (ref, data, options) => {
      if (!dbFirestore) return;
      await setDoc(ref, data, options);
    },
    getDocFn: async (ref) => {
      if (!dbFirestore) return { exists: () => false };
      return getDoc(ref);
    },
    docFn: (...segments) => {
      if (segments.length === 1 && Array.isArray(segments[0])) {
        return doc(...segments[0]);
      }
      return doc(...segments);
    },
    collectionFn: (...segments) => {
      if (segments.length === 1 && Array.isArray(segments[0])) {
        return collection(...segments[0]);
      }
      return collection(...segments);
    },
    deleteDocFn: async (ref) => {
      if (!dbFirestore) return;
      await deleteDoc(ref);
    }
  });
  localRepositoryReady = true;
  await repositoryService.initialize();
  db = await localRepository.initialize();
  if (db && typeof db === 'object') {
    console.log(`[LOCAL] Repository ready for ${localRepository.getDbName()}`);
  }
  await restoreImageCache();
  return db;
}

function initDBLegacy(userId = 'guest') {
  return new Promise((resolve, reject) => {
    const deviceId = new URLSearchParams(window.location.search).get('device') || '';
    const dbName = `posDB_${userId}${deviceId ? '_' + deviceId : ''}`;
    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log(`[DEVICE:${deviceId || 'default'}] Local database [${dbName}] initialized successfully.`);
      resolve(db);
    };

    request.onblocked = () => {
      if (typeof showAppAlert === 'function') showAppAlert('Database is blocked. Please close other tabs of this app and refresh.');
      else alert('Database is blocked. Please close other tabs of this app and refresh.');
      reject('DB_BLOCKED');
    };

    request.onerror = (event) => {
      console.error('Database error:', event.target.errorCode);
      reject(event.target.errorCode);
    };
  });
}

const enterpriseStateMap = {
  menu: { entityType: 'products', id: 'menu' },
  activeOrders: { entityType: 'dashboardCache', id: 'activeOrders' },
  transactions: { entityType: 'sales', id: 'transactions' },
  settings: { entityType: 'settings', id: 'settings' },
  staff: { entityType: 'staff', id: 'staff' },
  dishCategories: { entityType: 'categories', id: 'dishCategories' },
  customers: { entityType: 'customers', id: 'customers' },
  units: { entityType: 'units', id: 'units' },
  restockHistory: { entityType: 'inventoryHistory', id: 'restockHistory' },
  appAdminSettings: { entityType: 'appAdminSettings', id: 'appAdminSettings' },
  auditTrail: { entityType: 'auditLog', id: 'auditTrail' },
  notifications: { entityType: 'notifications', id: 'notifications' },
  suppliers: { entityType: 'suppliers', id: 'suppliers' },
  purchaseOrders: { entityType: 'purchaseOrders', id: 'purchaseOrders' },
  purchaseItems: { entityType: 'purchaseItems', id: 'purchaseItems' },
  expenses: { entityType: 'expenses', id: 'expenses' },
  payments: { entityType: 'payments', id: 'payments' },
  receipts: { entityType: 'receipts', id: 'receipts' },
  reports: { entityType: 'reports', id: 'reports' },
  roles: { entityType: 'roles', id: 'roles' },
  permissions: { entityType: 'permissions', id: 'permissions' },
  subscription: { entityType: 'subscription', id: 'subscription' },
  businessProfile: { entityType: 'businessProfile', id: 'businessProfile' },
  metadata: { entityType: 'metadata', id: 'metadata' },
  databaseVersion: { entityType: 'databaseVersion', id: 'databaseVersion' },
  productImages: { entityType: 'productImages', id: 'productImages' },
  activityLog: { entityType: 'activityLog', id: 'activityLog' }
};

async function saveState(key, value, options = { enqueueSync: true }) {
  if (!localRepositoryReady || !repositoryService) {
    return initDB(sessionStorage.getItem('currentUserUid') || 'guest').then(() => saveState(key, value, options));
  }

  return repositoryService.saveState(key, value, options);
}

async function loadState(key) {
  if (!localRepositoryReady || !repositoryService) {
    return initDB(sessionStorage.getItem('currentUserUid') || 'guest').then(() => loadState(key));
  }

  return repositoryService.loadState(key);
}

async function enqueueLocalSyncAction(action) {
  if (!localRepositoryReady || !repositoryService) {
    await initDB(sessionStorage.getItem('currentUserUid') || 'guest');
  }
  const envelope = await repositoryService.enqueueSyncAction(action);
  if (envelope) {
    pendingSyncQueue = [...pendingSyncQueue.filter(item => item.id !== envelope.id), envelope];
    await updateOnlineStatus().catch(error => {
      console.warn('[SYNC] Could not refresh sync status after queue update:', error);
    });
  }
  return envelope;
}

function getCloudPayloadForSyncAction(action) {
  if (!action || !action.entityType || !action.payload) return null;
  const value = action.payload.value ?? action.payload;
  switch (action.entityType) {
    case 'products': return { menu: Array.isArray(value) ? value : [] };
    case 'staff': return { staff: Array.isArray(value) ? value : [] };
    case 'categories': return { dishCategories: Array.isArray(value) ? value : [] };
    case 'brands': return { brands: Array.isArray(value) ? value : [] };
    case 'units': return { units: Array.isArray(value) ? value : [] };
    case 'customers': return { customers: Array.isArray(value) ? value : [] };
    case 'suppliers': return { suppliers: Array.isArray(value) ? value : [] };
    case 'inventoryHistory': return { restockHistory: Array.isArray(value) ? value : [] };
    case 'dashboardCache': return { activeOrders: value || {} };
    case 'settings': return { settings: value || {} };
    case 'appAdminSettings': return { appAdminSettings: value || {} };
    case 'subscription': return { subscription: value || {} };
    case 'businessProfile': return { businessProfile: value || {} };
    // NOTE: productImages is intentionally excluded — image cache is local-only
    default: return null;
  }
}

const PROTECTED_EMPTY_OVERWRITE_FIELDS = [
  'menu',
  'staff',
  'customers',
  'dishCategories',
  'units',
  'restockHistory'
];

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isEmptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function getAllowedEmptyOverwriteFields(action = {}) {
  const fromAction = Array.isArray(action.allowEmptyOverwriteFields) ? action.allowEmptyOverwriteFields : [];
  const fromPayload = Array.isArray(action.payload?.allowEmptyOverwriteFields) ? action.payload.allowEmptyOverwriteFields : [];
  return new Set([...fromAction, ...fromPayload]);
}

function isMeaningfulObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function looksLikeDefaultSettings(value) {
  if (!isMeaningfulObject(value)) return true;
  const defaults = typeof defaultSettings === 'object' ? defaultSettings : {};
  return (
    value.name === defaults.name &&
    value.address === defaults.address &&
    value.contact === defaults.contact &&
    value.currency === defaults.currency &&
    value.logo === defaults.logo
  );
}

// Global sanitizer to convert undefined values to null recursively for Firestore
function sanitizeForFirestore(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(v => sanitizeForFirestore(v));
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(k => {
      const v = value[k];
      out[k] = sanitizeForFirestore(v);
    });
    return out;
  }
  return value;
}

function shouldProtectSettingsOverwrite(incomingSettings, remoteSettings) {
  if (!isMeaningfulObject(remoteSettings)) return false;
  if (!isMeaningfulObject(incomingSettings)) return true;
  return looksLikeDefaultSettings(incomingSettings) && !looksLikeDefaultSettings(remoteSettings);
}

async function protectCloudPayloadFromEmptyOverwrite(shopDocRef, cloudPayload, action = {}) {
  if (!cloudPayload || typeof cloudPayload !== 'object') return cloudPayload;

  const allowedEmptyOverwriteFields = getAllowedEmptyOverwriteFields(action);

  const needsProtection = PROTECTED_EMPTY_OVERWRITE_FIELDS.some((field) =>
    isEmptyArray(cloudPayload[field]) && !allowedEmptyOverwriteFields.has(field)
  ) || (
      Object.prototype.hasOwnProperty.call(cloudPayload, 'settings') &&
      !allowedEmptyOverwriteFields.has('settings')
    );

  if (!needsProtection) return cloudPayload;

  try {
    const remoteSnap = await getDoc(shopDocRef);
    if (!remoteSnap.exists()) return cloudPayload;

    const remoteData = remoteSnap.data() || {};
    const safePayload = { ...cloudPayload };
    const protectedFields = [];

    PROTECTED_EMPTY_OVERWRITE_FIELDS.forEach((field) => {
      if (
        isEmptyArray(safePayload[field]) &&
        isNonEmptyArray(remoteData[field]) &&
        !allowedEmptyOverwriteFields.has(field)
      ) {
        delete safePayload[field];
        protectedFields.push(field);
      }
    });



    if (
      Object.prototype.hasOwnProperty.call(safePayload, 'settings') &&
      shouldProtectSettingsOverwrite(safePayload.settings, remoteData.settings) &&
      !allowedEmptyOverwriteFields.has('settings')
    ) {
      delete safePayload.settings;
      protectedFields.push('settings');
    }

    if (protectedFields.length > 0) {
      console.warn('[SYNC_GUARD] Prevented empty/default overwrite for:', protectedFields.join(', '), {
        entityType: action.entityType,
        actionId: action.id
      });
    }

    return Object.keys(safePayload).length > 0 ? safePayload : null;
  } catch (error) {
    console.warn('[SYNC_GUARD] Could not verify remote data before sync. Skipping protected payload to avoid data loss.', error);
    return null;
  }
}

function getFirstNonEmptyArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeCategoryValue(category) {
  if (typeof category === 'string') return category.trim();
  if (category && typeof category === 'object') {
    return String(category.name || category.title || category.label || category.id || '').trim();
  }
  return '';
}

function normalizeCategoryList(categories = []) {
  return [...new Set((Array.isArray(categories) ? categories : [])
    .map(normalizeCategoryValue)
    .filter(Boolean))]
    .sort();
}

function deriveCategoriesFromProducts(products = []) {
  return normalizeCategoryList((Array.isArray(products) ? products : []).map(item => item && item.category));
}

function getCloudMenuItems(cloudData = {}) {
  return getFirstNonEmptyArray(
    cloudData.menu,
    cloudData.products,
    cloudData.productList,
    cloudData.items
  );
}

function getCloudCategoryList(cloudData = {}) {
  const explicitCategories = getFirstNonEmptyArray(
    cloudData.dishCategories,
    cloudData.categories,
    cloudData.categoryList
  );
  const normalizedExplicit = normalizeCategoryList(explicitCategories);
  if (normalizedExplicit.length > 0) return normalizedExplicit;
  return deriveCategoriesFromProducts(getCloudMenuItems(cloudData));
}
function createCategoryRecord(categoryName, existingRecord = null) {
  const name = normalizeCategoryValue(categoryName);
  if (!name) return null;

  const baseId = existingRecord?.recordId || existingRecord?.id || `category-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  return enrichEnterpriseRecord('categories', {
    ...(existingRecord && typeof existingRecord === 'object' ? existingRecord : {}),
    id: baseId,
    recordId: baseId,
    name
  }, existingRecord);
}

function getCategoryNameFromRecord(record) {
  return normalizeCategoryValue(record);
}

function getCategoryRecordsFromList(categories = []) {
  return normalizeCategoryList(categories)
    .map(categoryName => createCategoryRecord(categoryName))
    .filter(Boolean);
}

function mergeCategoryRecordIntoList(categories = [], incomingRecord = {}) {
  const incomingName = getCategoryNameFromRecord(incomingRecord);
  if (!incomingName) return normalizeCategoryList(categories);

  return normalizeCategoryList([
    ...(Array.isArray(categories) ? categories : []),
    incomingName
  ]);
}

function removeCategoryRecordFromList(categories = [], removedRecord = {}) {
  const removedName = getCategoryNameFromRecord(removedRecord);
  if (!removedName) return normalizeCategoryList(categories);

  return normalizeCategoryList((Array.isArray(categories) ? categories : []).filter(categoryName =>
    normalizeCategoryValue(categoryName) !== removedName
  ));
}

const RECORD_SYNC_COLLECTIONS = {
  productRecord: 'products',
  categoryRecord: 'categories',
  customerRecord: 'customers',
  staffRecord: 'staff',
  unitRecord: 'units',
  inventoryHistoryRecord: 'inventory_history',
  saleItemRecord: 'sale_items',
  paymentRecord: 'payments'
};
const RECORD_SYNC_LOCAL_STORES = {
  productRecord: 'products',
  categoryRecord: 'categories',
  customerRecord: 'customers',
  staffRecord: 'staff',
  unitRecord: 'units',
  inventoryHistoryRecord: 'inventoryHistory',
  saleItemRecord: 'saleItems',
  paymentRecord: 'payments'
};

function getLocalRecordArrayForSync(entityType) {
  switch (entityType) {
    case 'productRecord': return menu;
    case 'categoryRecord': return dishCategories;
    case 'customerRecord': return customers;
    case 'staffRecord': return staff;
    case 'unitRecord': return units;
    case 'inventoryHistoryRecord': return restockHistory;
    default: return null;
  }
}

async function markEnterpriseRecordSyncedLocally(action = {}) {
  const storeName = RECORD_SYNC_LOCAL_STORES[action.entityType];
  if (!storeName || !localRepository) return;

  const payload = action.payload || {};
  if (payload.operation === 'delete' || action.operation === 'delete') return;

  const recordId = payload.recordId || payload.id || action.recordId || action.id;
  if (!recordId) return;

  const now = new Date().toISOString();
  const { operation, ...recordPayload } = payload;

  const syncedRecord = {
    ...recordPayload,
    id: recordPayload.id || recordId,
    recordId: recordPayload.recordId || recordId,
    syncStatus: 'synced',
    lastSyncAt: now,
    lastSyncedAt: now
  };

  const records = getLocalRecordArrayForSync(action.entityType);
  if (Array.isArray(records)) {
    const index = records.findIndex(record =>
      record && (record.recordId === recordId || record.id === recordId)
    );

    if (index >= 0) {
      records[index] = {
        ...records[index],
        ...syncedRecord
      };
    }
  }

  await localRepository.saveEntity(storeName, syncedRecord, {
    enqueueSync: false,
    preserveVersion: true
  });
}
async function markEnterpriseRecordDeletedLocally(action = {}) {
  const storeName = RECORD_SYNC_LOCAL_STORES[action.entityType];
  if (!storeName || !localRepository || typeof localRepository.deleteEntity !== 'function') return;

  const payload = action.payload || {};
  const recordId = payload.recordId || payload.id || action.recordId || action.id;
  if (!recordId) return;

  await localRepository.deleteEntity(storeName, String(recordId));
}

async function markTransactionSyncedLocally(action = {}) {
  const payload = action.payload || {};
  const txId = payload.id || payload.recordId || action.id || payload.date;
  if (!txId || !Array.isArray(transactions)) return;

  const now = new Date().toISOString();
  const index = transactions.findIndex(tx =>
    tx && (tx.id === txId || tx.recordId === txId || tx.date === payload.date)
  );

  if (index >= 0) {
    transactions[index] = {
      ...transactions[index],
      synced: true,
      syncStatus: 'synced',
      lastSyncAt: now,
      lastSyncedAt: now
    };

    await saveState('transactions', transactions, { enqueueSync: false });
  }
}

async function syncEnterpriseRecordAction(action) {
  const collectionName = RECORD_SYNC_COLLECTIONS[action.entityType];
  if (!collectionName) return false;

  const payload = action.payload || {};
  const recordId = payload.recordId || payload.id || action.recordId || action.id;
  if (!recordId) return true;

  if (collectionName === 'products') {
    const normalizedPayload = normalizeProductCatalog([payload])[0] || payload;
    const canonicalId = normalizedPayload.recordId || normalizedPayload.id || String(recordId);
    if (canonicalId && canonicalId !== String(recordId)) {
        await setDoc(doc(dbFirestore, 'users', currentUser.uid, collectionName, String(canonicalId)), sanitizeForFirestore({
          ...normalizedPayload,
          id: String(canonicalId),
          recordId: String(canonicalId),
          deleted: false,
          deletedAt: null,
          operation: null,
          syncStatus: 'synced',
          lastSyncedAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString()
        }), { merge: true });
    }
  }

  const recordRef = doc(dbFirestore, 'users', currentUser.uid, collectionName, String(recordId));

  if (payload.operation === 'delete' || action.operation === 'delete') {
    const now = new Date().toISOString();

    await setDoc(recordRef, {
      id: String(recordId),
      recordId: String(recordId),
      deleted: true,
      operation: 'delete',
      syncStatus: 'deleted',
      deletedAt: now,
      updatedAt: now,
      lastSyncedAt: now,
      lastSyncAt: now,
      businessId: payload.businessId || action.businessId || getEffectiveUid(),
      userId: payload.userId || action.userId || currentUser?.uid || getEffectiveUid(),
      staffId: payload.staffId || action.staffId || getCurrentStaffId(),
      deviceId: payload.deviceId || action.deviceId || getCurrentDeviceId()
    }, { merge: true });

    await markEnterpriseRecordDeletedLocally(action);
    return true;
  }
  const { operation, ...recordPayload } = payload;

  await setDoc(recordRef, sanitizeForFirestore({
    ...recordPayload,
    deleted: false,
    deletedAt: null,
    operation: null,
    syncStatus: 'synced',
    lastSyncedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString()
  }), { merge: true });

  await markEnterpriseRecordSyncedLocally(action);

  return true;
}

async function enqueueEnterpriseRecordChange(collectionName, record, operation = 'upsert') {
  if (!record || typeof record !== 'object') return;

  const entityTypeMap = {
    products: 'productRecord',
    categories: 'categoryRecord',
    customers: 'customerRecord',
    staff: 'staffRecord',
    units: 'unitRecord',
    inventory_history: 'inventoryHistoryRecord',
    sale_items: 'saleItemRecord',
    payments: 'paymentRecord'
  };

  const entityType = entityTypeMap[collectionName];
  if (!entityType) return;

  const effectiveUid = getEffectiveUid();
  if (!effectiveUid) return;

  await enqueueLocalSyncAction({
    entityType,
    payload: {
      ...record,
      operation
    },
    businessId: effectiveUid,
    userId: currentUser?.uid || effectiveUid,
    staffId: getCurrentStaffId(),
    updatedBy: currentUser?.uid || effectiveUid,
    deviceId: getCurrentDeviceId()
  });
}

function getProductDuplicateKey(record = {}) {
  const id = String(record?.recordId || record?.id || '').trim();
  const name = String(record?.name || '').trim().toLowerCase();
  const barcode = String(record?.barcode || '').trim();
  const category = String(record?.category || '').trim().toLowerCase();

  if (id) return `id:${id}`;
  if (barcode) return `barcode:${barcode}`;
  if (name) return `name:${name}|cat:${category}`;
  return '';
}

async function cleanupDuplicateProductRecordsInCloud(uid) {
  if (!uid || !dbFirestore) return;

  try {
    const productsRef = collection(dbFirestore, 'users', uid, 'products');
    const snapshot = await getDocs(productsRef);
    const documents = snapshot.docs.map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));

    if (!Array.isArray(documents) || documents.length < 2) return;

    const groups = new Map();
    documents.forEach(record => {
      const key = getProductDuplicateKey(record) || `${record.id || ''}|${record.name || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });

    const duplicates = [...groups.values()].filter(group => group.length > 1);
    if (duplicates.length === 0) return;

    for (const group of duplicates) {
      const canonicalRecord = getCanonicalProductCatalog(group, { includeOnlySellable: false })[0] || group[0];
      const canonicalId = String(canonicalRecord?.recordId || canonicalRecord?.id || group[0]?.recordId || group[0]?.id || '').trim();
      if (!canonicalId) continue;

      await setDoc(doc(dbFirestore, 'users', uid, 'products', canonicalId), sanitizeForFirestore({
        ...canonicalRecord,
        id: canonicalId,
        recordId: canonicalId,
        deleted: false,
        deletedAt: null,
        operation: null,
        syncStatus: 'synced',
        lastSyncedAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString()
      }), { merge: true });

      const duplicatesToDelete = group.filter(record => String(record?.recordId || record?.id || '').trim() !== canonicalId);
      await Promise.allSettled(duplicatesToDelete.map(record => deleteDoc(doc(dbFirestore, 'users', uid, 'products', String(record?.id || record?.recordId || '')))));
    }

    console.info('[DB_CLEANUP] Consolidated duplicate product records in Firestore.');
  } catch (error) {
    console.warn('[DB_CLEANUP] Duplicate product cleanup failed:', error);
  }
}

async function backfillEnterpriseRecordCollectionsOnce(uid) {
  if (!uid || !dbFirestore || !localRepositoryReady || !localRepository) return;

  const metadataKey = `enterpriseRecordBackfill:${uid}`;
  if (typeof localRepository.getMetadata === 'function') {
    const alreadyBackfilled = await localRepository.getMetadata(metadataKey);
    if (alreadyBackfilled) return;
  }

  const backfillGroups = [
    { collectionName: 'products', entityType: 'products', records: menu },
    { collectionName: 'categories', entityType: 'categories', records: getCategoryRecordsFromList(dishCategories) },
    { collectionName: 'customers', entityType: 'customers', records: customers },
    { collectionName: 'staff', entityType: 'staff', records: staff },
    { collectionName: 'units', entityType: 'units', records: units },
    { collectionName: 'inventory_history', entityType: 'inventoryHistory', records: restockHistory },
    { collectionName: 'sale_items', entityType: 'saleItems', records: Array.isArray(transactions) ? transactions.flatMap(buildSaleItemRecords) : [] },
    { collectionName: 'payments', entityType: 'payments', records: Array.isArray(transactions) ? transactions.map(buildPaymentRecord) : [] }
  ];

  for (const group of backfillGroups) {
    const records = Array.isArray(group.records) ? group.records : [];

    for (const record of records) {
      if (!record || typeof record !== 'object') continue;

      const hydratedRecord = hydrateEnterpriseRecord(group.entityType, record);
      const recordId = hydratedRecord.recordId || hydratedRecord.id;
      if (!recordId) continue;

      if (group.collectionName === 'products') {
        const deduped = normalizeProductCatalog([hydratedRecord])[0] || hydratedRecord;
        const canonicalId = deduped.recordId || deduped.id || String(recordId);
        if (canonicalId !== String(recordId)) {
          await setDoc(doc(dbFirestore, 'users', uid, group.collectionName, String(canonicalId)), sanitizeForFirestore({
            ...deduped,
            id: String(canonicalId),
            recordId: String(canonicalId),
            syncStatus: 'synced',
            lastSyncedAt: new Date().toISOString(),
            lastSyncAt: new Date().toISOString()
          }), { merge: true });
          continue;
        }
      }

      await setDoc(
        doc(dbFirestore, 'users', uid, group.collectionName, String(recordId)),
        sanitizeForFirestore({
          ...hydratedRecord,
          syncStatus: 'synced',
          lastSyncedAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString()
        }),
        { merge: true }
      );
    }
  }

  if (typeof localRepository.setMetadata === 'function') {
    await localRepository.setMetadata(metadataKey, new Date().toISOString());
  }
}


async function syncCloudAction(action) {
  if (!currentUser || !currentUser.uid) {
    throw new Error('Cloud sync is waiting for an authenticated session.');
  }

  // Convert undefined values to null recursively so Firestore doesn't reject documents
  function sanitizeForFirestore(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(v => sanitizeForFirestore(v));
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => {
        const v = value[k];
        out[k] = sanitizeForFirestore(v);
      });
      return out;
    }
    return value;
  }

  const queueCollectionPath = getSyncQueueCollectionPath(currentUser.uid);
  const queueDocRef = doc(collection(dbFirestore, ...queueCollectionPath), action.id);
  const sanitizedQueueEntry = sanitizeForFirestore({ ...action, syncStatus: 'synced', lastSyncAt: new Date().toISOString() });
  await setDoc(queueDocRef, sanitizedQueueEntry, { merge: true });

  if (await syncEnterpriseRecordAction(action)) {
    return;
  }

  const cloudPayload = getCloudPayloadForSyncAction(action);
    if (cloudPayload) {
      const shopDocRef = doc(dbFirestore, 'users', currentUser.uid, 'data', 'shop_profile');
      const safeCloudPayload = await protectCloudPayloadFromEmptyOverwrite(shopDocRef, cloudPayload, action);
      if (safeCloudPayload) {
        await setDoc(shopDocRef, sanitizeForFirestore(safeCloudPayload), { merge: true });
      }
      return;
    }

  if (action.entityType === 'sales' || action.entityType === 'transactions') {
    const txRef = collection(dbFirestore, 'users', currentUser.uid, 'transactions');
    const payload = action.payload || {};
    const txId = payload.id || action.id;
    await setDoc(doc(txRef, txId), sanitizeForFirestore({
      ...payload,
      synced: true,
      syncStatus: 'synced',
      lastSyncedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    }), { merge: true });

    await markTransactionSyncedLocally(action);
    return;
  }

  if (action.entityType === 'auditLog') {
    const auditRef = collection(dbFirestore, 'users', currentUser.uid, 'audit_log');
    const payload = action.payload || {};
    const auditId = payload.id || action.id;
    await setDoc(doc(auditRef, auditId), sanitizeForFirestore({
      ...payload,
      syncStatus: 'synced',
      lastSyncedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    }), { merge: true });
    return;
  }

  if (action.entityType === 'notifications') {
    const notificationRef = collection(dbFirestore, 'users', currentUser.uid, 'notifications');
    const payload = action.payload || {};
    const notificationId = payload.id || action.id;
    await setDoc(doc(notificationRef, notificationId), sanitizeForFirestore({ ...payload, lastSyncedAt: new Date().toISOString() }), { merge: true });
    return;
  }
}

async function flushLocalSyncQueue(options = {}) {
  if (!currentUser || !dbFirestore || !navigator.onLine || !localRepositoryReady || !repositoryService) return [];
  if (isSyncing) return [];

  const statusEl = document.getElementById('connectivity-status');
  if (statusEl) {
    statusEl.classList.add('sync-pulse');
    statusEl.title = 'Online • syncing to cloud...';
  }
  isSyncing = true;

  const results = await repositoryService.flushSyncQueue(options);

  isSyncing = false;
  if (statusEl) {
    statusEl.classList.remove('sync-pulse');
  }

  try {
    if (localRepository && typeof localRepository.getSyncQueue === 'function') {
      pendingSyncQueue = await localRepository.getSyncQueue();
    }
  } catch (error) {
    console.warn('[SYNC] Could not refresh local sync queue after flush:', error);
  }

  if (!options.skipStatusUpdate) {
    await updateOnlineStatus().catch(error => {
      console.warn('[SYNC] Could not refresh sync status after queue flush:', error);
    });
  }
  return results;
}

function summarizeSyncResults(results = []) {
  const summary = {
    processed: 0,
    failed: 0,
    scheduled: 0,
    total: Array.isArray(results) ? results.length : 0
  };

  if (!Array.isArray(results)) return summary;

  results.forEach(result => {
    if (!result || !result.status) return;
    if (result.status === 'processed') summary.processed += 1;
    if (result.status === 'failed') summary.failed += 1;
    if (result.status === 'scheduled') summary.scheduled += 1;
  });

  return summary;
}

async function scheduleBackgroundSync() {
  if (!localRepositoryReady || !localRepository || !navigator.onLine || !currentUser) return;
  if (syncDebounceTimer) return;
  syncDebounceTimer = setTimeout(async () => {
    syncDebounceTimer = null;
    try {
      await flushLocalSyncQueue();
    } catch (error) {
      console.warn('[SYNC] Background sync failed:', error);
    }
  }, 300);
}

async function restoreImageCache() {
  if (!localRepositoryReady || !localRepository) return;
  try {
    const cachedImages = await localRepository.getEntity('productImages', 'dish-image-cache');
    if (cachedImages && cachedImages.images) {
      lastKnownDishImages = { ...cachedImages.images };
    }
  } catch (error) {
    console.warn('[IMG_CACHE] Unable to restore image cache:', error);
  }
}

async function persistImageCache() {
  if (!localRepositoryReady || !localRepository) return;
  try {
    // enqueueSync: false — image cache is local-only, never sync to cloud
    await localRepository.saveEntity('productImages', {
      id: 'dish-image-cache',
      images: lastKnownDishImages || {},
      updatedAt: new Date().toISOString(),
      syncStatus: 'local'
    }, { enqueueSync: false });
  } catch (error) {
    console.warn('[IMG_CACHE] Unable to persist image cache:', error);
  }
}

// ===== Data Handling =====
const PLACEHOLDER_IMAGE = 'https://placehold.co/100';
let defaultMenu = [];
let menu = [];
let activeOrders = {};
let transactions = [];
let staff = [];
let dishCategories = [];
let customers = [];
let restockHistory = [];
let lastKnownDishImages = {}; // Cache the last valid image URL for each product name

const defaultDishCategories = [];
const defaultSettings = {
  name: "My Business",
  address: "123 Business Avenue, Suite 100",
  contact: "555-123-4567",
  currency: "$",
  theme: "light",
  defaultMarkup: 200, // Default 200% markup
  lowStockThreshold: 10,
  taxRate: 0,
  ShopAdminPIN: "1234" // Default ShopAdmin PIN
};
let settings = { ...defaultSettings };
const defaultStaff = [];

let printerDevice = null;
let printerType = null; // 'USB' or 'BLUETOOTH'
let units = [];

// Helper to get logged in user's first name
function getCurrentServerName() {
  // Return logged-in staff member's name if available
  if (currentLoggedInStaffName) {
    return currentLoggedInStaffName;
  }
  // Otherwise, return Google user's name
  if (currentUser) {
    if (currentUser.displayName) return currentUser.displayName.trim().split(/\s+/)[0];
    if (currentUser.email) return currentUser.email.split('@')[0];
  }
  return 'N/A';
}

/**
 * Ensures the App Admin tab has the required dashboard layout elements
 * This creates the UI dynamically if not present in the HTML template.
 */
function initAppAdminDashboardLayout() {
  const adminTab = document.getElementById('appAdminTab');
  if (!adminTab) return;

  // If layout already exists, don't recreate
  if (document.getElementById('admin-dashboard-view')) return;

  adminTab.innerHTML = `
      <div class="shop-selected-banner" id="selectedShopBanner" style="display:none; margin-bottom:20px; border-left: 5px solid #17a2b8;"></div>
      
      <!-- Dashboard View -->
      <div id="admin-dashboard-view">
        <h3 class="u-mb-20">📊 App Admin Dashboard</h3>
        <div class="dashboard-grid u-mb-20">
          <div class="dashboard-card">
            <h4>Total Global Revenue</h4>
            <p id="globalTotalRevenue"><span class="spinner"></span></p>
          </div>
          <div class="dashboard-card">
            <h4>Total Shops</h4>
            <p id="globalTotalShops">0</p>
          </div>
          <div class="dashboard-card">
            <h4>Total Transactions</h4>
            <p id="globalTotalTransactions">0</p>
          </div>
          <div class="dashboard-card" style="border-bottom: 4px solid #ffc107;">
            <h4>Pending Approval</h4>
            <p id="globalPendingShops">0</p>
          </div>
          <div class="dashboard-card">
            <h4>Avg Order Value</h4>
            <p id="adminAvgOrderValue">-</p>
          </div>
          <div class="dashboard-card">
            <h4>Sales Today</h4>
            <p id="adminTotalSalesToday">-</p>
          </div>
          <div class="dashboard-card">
            <h4>New Shops (7d)</h4>
            <p id="adminNewShopsThisWeek">-</p>
          </div>
        </div>

        <div class="charts-container">
          <div class="chart-wrapper" style="flex: 1 1 260px; min-width:220px;">
            <canvas id="adminGlobalRevenueChart" style="height:220px;"></canvas>
          </div>
          <div class="chart-wrapper" style="flex: 1 1 260px; min-width:220px;">
            <canvas id="adminShopsComparisonChart" style="height:220px;"></canvas>
          </div>
          <div class="chart-wrapper chart-pie" style="flex: 1 1 220px; min-width:200px;">
            <canvas id="adminPaymentMethodsChart"></canvas>
          </div>
          <div class="chart-wrapper chart-pie" style="flex: 1 1 220px; min-width:200px;">
            <canvas id="adminShopsStatusChart"></canvas>
          </div>
        </div>

        <div class="u-mb-20" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color);">
          <h4 class="u-mb-10">🏪 Shops Management Control Section</h4>
          <div class="dashboard-grid u-mb-20">
            <div class="dashboard-card">
              <h4>Active Shops</h4>
              <p id="subscriptionsActiveCount">0</p>
            </div>
            <div class="dashboard-card">
              <h4>Expired</h4>
              <p id="subscriptionsExpiredCount">0</p>
            </div>
            <div class="dashboard-card" style="border-bottom: 4px solid #ffc107;">
              <h4>Expiring Soon</h4>
              <p id="subscriptionsExpiringCount">0</p>
            </div>
            <div class="dashboard-card" style="border-bottom: 4px solid #17a2b8;">
              <h4>Pending / Suspended</h4>
              <p id="subscriptionsPendingCount">0</p>
            </div>
            <div class="dashboard-card">
              <h4>Trialing</h4>
              <p id="subscriptionsTrialingCount">0</p>
            </div>
            <div class="dashboard-card">
              <h4>Free / Promo</h4>
              <p id="subscriptionsFreeCount">0</p>
            </div>
            <div class="dashboard-card">
              <h4>No Sales (7d)</h4>
              <p id="subscriptionsNoSalesCount">0</p>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-info u-m-0" onclick="setSubscriptionsFilter('all')">All</button>
              <button class="btn btn-success u-m-0" onclick="setSubscriptionsFilter('active')">Active</button>
              <button class="btn btn-danger u-m-0" onclick="setSubscriptionsFilter('expired')">Expired</button>
              <button class="btn btn-warning u-m-0" onclick="setSubscriptionsFilter('expiring-soon')">Expiring Soon</button>
              <button class="btn btn-secondary u-m-0" onclick="setSubscriptionsFilter('pending')">Pending</button>
              <button class="btn btn-secondary u-m-0" onclick="setSubscriptionsFilter('suspended')">Suspended</button>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-info u-m-0" onclick="toggleSelectAllSubscriptionRows()">Select All Visible</button>
              <button class="btn btn-success u-m-0" onclick="runBulkSubscriptionAction('activate')">Activate</button>
              <button class="btn btn-warning u-m-0" onclick="runBulkSubscriptionAction('suspend')">Suspend</button>
              <button class="btn btn-danger u-m-0" onclick="runBulkSubscriptionAction('deactivate')">Deactivate</button>
              <button class="btn btn-purple u-m-0" onclick="runBulkSubscriptionAction('notice')">Send Notice</button>
            </div>
          </div>
          <div class="u-overflow-x-auto">
            <table class="u-w-full">
              <thead>
                <tr>
                  <th class="u-text-center">#</th>
                  <th class="u-text-center"><input type="checkbox" id="subscriptionsSelectAllCheckbox" onclick="toggleSelectAllSubscriptionRows(this.checked)"></th>
                  <th class="u-text-center">Logo</th>
                  <th>Shop</th>
                  <th>Owner</th>
                  <th>WhatsApp</th>
                  <th>Status</th>
                  <th>Off/ON</th>
                  <th>Subscription</th>
                  <th>Last Sync</th>
                  <th class="u-text-center">Actions</th>
                </tr>
              </thead>
              <tbody id="appAdminSubscriptionsTableBody">
                <tr><td colspan="11" class="u-text-center">Loading subscriptions...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Shops View -->
      <div id="admin-shops-view" style="display:none;">
          <h3 class="u-mb-20">🏪 Registered Shops Directory</h3>
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 15px;">
            <h4 class="u-m-0">Registered Shops Directory</h4>
            <button class="btn btn-info u-m-0" onclick="refreshAppAdminShops()">↻ Refresh Shops</button>
          </div>
          
          <div id="appAdminShopCardsContainer" class="shop-cards-grid">
            <p class="u-text-center u-w-full">Shops list is loading...</p>
          </div>
      </div>

      <!-- Shops Table View -->
      <div id="admin-shops-list-view" style="display:none;">
          <h3 class="u-mb-20">📋 Registered Shops Details</h3>
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 15px;">
            <h4 class="u-m-0">Shop Registration Details</h4>
            <button class="btn btn-info u-m-0" onclick="refreshAppAdminShopsTable()">↻ Refresh Table</button>
          </div>
          
          <div class="u-overflow-x-auto">
            <table class="u-w-full">
              <thead>
                <tr>
                  <th class="u-text-center">Logo</th>
                  <th>Shop Name</th>
                  <th>Owner Account</th>
                  <th>Contact</th>
                  <th>WhatsApp</th>
                  <th class="u-text-center">Status</th>
                  <th>Subscription</th>
                  <th>Last Sync</th>
                  <th class="u-text-right">Actions</th>
                </tr>
              </thead>
              <tbody id="appAdminShopsTableBody">
                <tr><td colspan="8" class="u-text-center">Loading shops details...</td></tr>
              </tbody>
            </table>
          </div>
      </div>

      <!-- Settings View -->
      <div id="admin-settings-view" style="display:none;">
        <h3 class="u-mb-20">⚙️ App Admin Settings</h3>
        <div style="display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px;" class="u-mb-20">
          <!-- Global System Status -->
          <div class="form-panel">
            <h4 class="u-m-0">Global Shop Status</h4>
            <p class="u-fs-08 u-text-muted u-mb-15">Control access for all users.</p>
            <div class="u-text-center u-mb-15">
              Status: <strong id="currentShopStatusDisplay" style="color: var(--primary);">Active</strong>
            </div>
            <div style="display: flex; gap: 5px;">
              <button class="btn btn-success u-flex-1 u-m-0" onclick="updateShopStatus('active')">Activate</button>
              <button class="btn btn-warning u-flex-1 u-m-0" onclick="updateShopStatus('suspended')">Suspend</button>
              <button class="btn btn-danger u-flex-1 u-m-0" onclick="updateShopStatus('deactivated')">Deactivate</button>
            </div>
          </div>

          <!-- Admin Access Configuration -->
          <div class="form-panel">
            <h4 class="u-m-0">App Admin Access</h4>
            <p class="u-fs-08 u-text-muted u-mb-15">Manage the Google account and linked email/password access for the app admin.</p>
            <div id="appAdminFormContainer" style="display:none; margin-bottom: 12px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(0,0,0,0.03);">
              <div class="input-row">
                <input type="email" id="appAdminEmailInput" placeholder="Linked Email Address">
                <input type="password" id="appAdminPasswordInput" placeholder="Password">
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="btn btn-success u-m-0" onclick="saveAdminAccessEntry()">Save</button>
                <button class="btn btn-secondary u-m-0" onclick="toggleAdminAccessForm(false)">Cancel</button>
              </div>
            </div>
            <button class="btn btn-info u-w-full u-m-0" onclick="toggleAdminAccessForm(true)">Add / Link Admin Access</button>
            <div class="u-mt-15">
              <div class="u-fs-08 u-text-muted u-mb-8">Current App Admin Access</div>
              <div class="u-overflow-x-auto">
                <table class="u-w-full" style="border-collapse: collapse; font-size: 0.9em;">
                  <thead>
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <th style="text-align:left; padding:6px 8px;">Name</th>
                      <th style="text-align:left; padding:6px 8px;">Email</th>
                      <th style="text-align:left; padding:6px 8px;">Password</th>
                      <th style="text-align:left; padding:6px 8px;">Type</th>
                      <th style="text-align:left; padding:6px 8px;">Status</th>
                      <th style="text-align:left; padding:6px 8px;">Actions</th>
                    </tr>
                  </thead>
                  <tbody id="appAdminAuthorizedEmailsList">
                    <tr><td colspan="6" style="padding:8px; color: var(--text-muted);">Loading admin logins...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
}

/**
 * Switches between sub-views in the App Admin panel
 */
function switchAppAdminView(view) {
  // Toggle view visibility
  document.getElementById('admin-dashboard-view').style.display = (view === 'dashboard' || view === 'subscriptions') ? 'block' : 'none';
  document.getElementById('admin-shops-view').style.display = view === 'shops' ? 'block' : 'none';
  document.getElementById('admin-shops-list-view').style.display = view === 'shops-table' ? 'block' : 'none';
  document.getElementById('admin-settings-view').style.display = view === 'settings' ? 'block' : 'none';

  // Conditional data fetching based on active sub-view
  if (view === 'dashboard' || view === 'subscriptions') {
    fetchGlobalAnalytics();
    refreshAppAdminSubscriptions();
  }
  if (view === 'shops') refreshAppAdminShops();
  if (view === 'shops-table') refreshAppAdminShopsTable();
  if (view === 'settings') {
    const statusDisplay = document.getElementById('currentShopStatusDisplay');
    if (statusDisplay) statusDisplay.textContent = appAdminSettings.shopStatus.charAt(0).toUpperCase() + appAdminSettings.shopStatus.slice(1);
    renderAppAdminEmailAccessList();
  }
}

/**
 * Aggregates sales and data across all registered shops
 */
async function fetchGlobalAnalytics() {
  if (currentUserRole !== 'appAdmin') return;

  const displayRevenue = document.getElementById('globalTotalRevenue');
  const displayShops = document.getElementById('globalTotalShops');
  const displayTx = document.getElementById('globalTotalTransactions');
  const displayPending = document.getElementById('globalPendingShops');

  if (displayRevenue) displayRevenue.textContent = 'Calculating...';

  try {
    const usersSnap = await getDocs(collection(dbFirestore, "users"));
    let totalRevenue = 0;
    let totalTxCount = 0;
    let validShopCount = 0;
    let pendingCount = 0;
    const seenEmails = new Set();

    const revenuePerShop = {};
    const revenuePerDay = {};
    const paymentMethodsTotals = {};
    const statusCounts = {};
    let salesToday = 0;
    let newShopsThisWeek = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();

      if (userData.status === 'pending') {
        pendingCount++;
      }

      // 1. Fetch the specific shop data first to verify existence
      const dataDoc = await getDoc(doc(dbFirestore, "users", uid, "data", "shop_profile"));
      if (!dataDoc.exists()) continue;

      const shopData = dataDoc.data();
      const shopName = (shopData.settings && shopData.settings.name) || 'Unnamed Shop';
      const menuItems = shopData.menu || [];
      if (uid === MASTER_APP_ADMIN_UID && menuItems.length === 0) continue;

      // 2. Enforce email deduplication to match Directory logic
      const userEmail = (userData.email || '').toLowerCase().trim();
      const effectiveEmail = (uid.includes('@') && !userEmail) ? uid.toLowerCase().trim() : userEmail;

      if (effectiveEmail && seenEmails.has(effectiveEmail)) continue;
      if (effectiveEmail) seenEmails.add(effectiveEmail);

      validShopCount++;

      const txSnap = await getDocs(collection(dbFirestore, "users", uid, "transactions"));
      let shopRevenue = 0;
      txSnap.forEach(doc => {
        const t = doc.data();
        const amount = (t.total || 0);
        totalRevenue += amount;
        shopRevenue += amount;
        totalTxCount++;

        // revenue per day
        if (t.date) {
          const date = new Date(t.date).toLocaleDateString();
          revenuePerDay[date] = (revenuePerDay[date] || 0) + amount;

          // sales today
          const txDate = new Date(t.date);
          const today = new Date();
          if (txDate.toDateString() === today.toDateString()) salesToday += amount;
        }

        // payment methods aggregation
        const pm = (t.paymentMethod || 'Unknown');
        paymentMethodsTotals[pm] = (paymentMethodsTotals[pm] || 0) + amount;
      });

      revenuePerShop[shopName] = (revenuePerShop[shopName] || 0) + shopRevenue;

      // status counts
      const st = userData.status || (shopData.status) || 'active';
      statusCounts[st] = (statusCounts[st] || 0) + 1;

      // new shops this week (best-effort using createdAt fields)
      try {
        const createdRaw = userData.createdAt || userData.joinedAt || shopData.createdAt || userDoc.createTime && userDoc.createTime.toDate && userDoc.createTime.toDate();
        if (createdRaw) {
          const createdDate = (typeof createdRaw === 'string') ? new Date(createdRaw) : (createdRaw instanceof Date ? createdRaw : new Date(createdRaw));
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          if (createdDate >= sevenDaysAgo) newShopsThisWeek++;
        }
      } catch (e) {
        // ignore parsing errors
      }
    }

    if (displayShops) displayShops.textContent = validShopCount;
    if (displayRevenue) displayRevenue.textContent = formatCurrency(totalRevenue);
    if (displayTx) displayTx.textContent = totalTxCount;
    if (displayPending) displayPending.textContent = pendingCount;

    // update new small cards
    const avgOrderEl = document.getElementById('adminAvgOrderValue');
    const salesTodayEl = document.getElementById('adminTotalSalesToday');
    const newShopsEl = document.getElementById('adminNewShopsThisWeek');
    const avgOrder = totalTxCount ? (totalRevenue / totalTxCount) : 0;
    if (avgOrderEl) avgOrderEl.textContent = formatCurrency(avgOrder);
    if (salesTodayEl) salesTodayEl.textContent = formatCurrency(salesToday);
    if (newShopsEl) newShopsEl.textContent = newShopsThisWeek;

    renderAdminGlobalRevenueChart(revenuePerDay);
    renderAdminShopsComparisonChart(revenuePerShop);
    renderAdminPaymentMethodsChart(paymentMethodsTotals);
    renderAdminShopsStatusChart(statusCounts);
  } catch (error) {
    handleFirebaseError(error, "Global Analytics", "users (collection level)");
  }
}

/**
 * Permanently removes a shop and all its associated data
 */
async function deleteShop(shopUid, shopName) {
  if (currentUserRole !== 'appAdmin') return;

  const confirmation = await showAppConfirm(
    `CRITICAL: Are you sure you want to PERMANENTLY delete "${shopName}"?\n\nThis will wipe all inventory, transactions, and settings. This cannot be undone.`,
    'Delete Shop',
    'Delete',
    'Cancel'
  );
  if (!confirmation) return;

  try {
    // If the admin is deleting their OWN account's shop data, 
    // we must clear local state first to prevent auto-resync from recreating it.
    if (shopUid === currentUser?.uid) {
      menu = [];
      activeOrders = {};
      transactions = [];
      staff = [];
      dishCategories = [];
      customers = [];
      restockHistory = [];
      settings = { ...defaultSettings };
      // Save cleared state locally only, do NOT sync or mirror deleted records
      await saveData(false, { skipEnterpriseMirror: true });
    }

    // 1. Delete transactions sub-collection (all historical data)
    const txRef = collection(dbFirestore, "users", shopUid, "transactions");
    const txSnap = await getDocs(txRef);
    if (!txSnap.empty) {
      const txDeletes = txSnap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(txDeletes);
    }

    // 2. Delete the main shop_profile document
    await deleteDoc(doc(dbFirestore, "users", shopUid, "data", "shop_profile"));

    // Stop sync if we deleted our own data
    if (shopUid === currentUser?.uid) isInitialLoadComplete = false;

    // 3. Delete the user metadata document
    await deleteDoc(doc(dbFirestore, "users", shopUid));

    alert(`Success: "${shopName}" and all its Firestore data have been deleted.`);
    refreshAppAdminShops();
  } catch (error) {
    handleFirebaseError(error, "Delete Shop", `users/${shopUid}`);
  }
}

let subscriptionsAdminState = { filter: 'all', selectedUids: new Set(), rows: [] };

function updateSubscriptionsSummaryCards(stats = {}) {
  const activeEl = document.getElementById('subscriptionsActiveCount');
  const expiredEl = document.getElementById('subscriptionsExpiredCount');
  const expiringEl = document.getElementById('subscriptionsExpiringCount');
  const pendingEl = document.getElementById('subscriptionsPendingCount');
  const trialEl = document.getElementById('subscriptionsTrialingCount');
  const freeEl = document.getElementById('subscriptionsFreeCount');
  const noSalesEl = document.getElementById('subscriptionsNoSalesCount');

  if (activeEl) activeEl.textContent = stats.active || 0;
  if (expiredEl) expiredEl.textContent = stats.expired || 0;
  if (expiringEl) expiringEl.textContent = stats['expiring-soon'] || 0;
  if (pendingEl) pendingEl.textContent = (stats.pending || 0) + (stats.suspended || 0);
  if (trialEl) trialEl.textContent = stats.trialing || 0;
  if (freeEl) freeEl.textContent = stats.free || 0;
  if (noSalesEl) noSalesEl.textContent = stats['no-sales-7d'] || 0;
}

function setSubscriptionsFilter(filter) {
  subscriptionsAdminState.filter = filter;
  refreshAppAdminSubscriptions(filter);
}

function toggleSubscriptionSelection(uid, checked) {
  if (checked) subscriptionsAdminState.selectedUids.add(uid);
  else subscriptionsAdminState.selectedUids.delete(uid);
  const selectAllCheckbox = document.getElementById('subscriptionsSelectAllCheckbox');
  if (selectAllCheckbox) {
    const visibleRows = subscriptionsAdminState.rows.filter(row => row.visible);
    selectAllCheckbox.checked = visibleRows.length > 0 && visibleRows.every(row => subscriptionsAdminState.selectedUids.has(row.uid));
  }
}

function toggleSelectAllSubscriptionRows(forceChecked) {
  const tbody = document.getElementById('appAdminSubscriptionsTableBody');
  if (!tbody) return;
  const visibleRows = subscriptionsAdminState.rows.filter(row => row.visible);
  const checked = typeof forceChecked === 'boolean' ? forceChecked : visibleRows.some(row => !subscriptionsAdminState.selectedUids.has(row.uid));

  visibleRows.forEach(row => {
    if (checked) subscriptionsAdminState.selectedUids.add(row.uid);
    else subscriptionsAdminState.selectedUids.delete(row.uid);
  });

  tbody.querySelectorAll('input.subscription-row-checkbox').forEach(checkbox => {
    checkbox.checked = checked;
  });

  const selectAllCheckbox = document.getElementById('subscriptionsSelectAllCheckbox');
  if (selectAllCheckbox) selectAllCheckbox.checked = checked && visibleRows.length > 0;
}

async function runBulkSubscriptionAction(action) {
  const selectedUids = Array.from(subscriptionsAdminState.selectedUids);
  if (!selectedUids.length) {
    await showAppAlert('Please select at least one shop first.', 'No Selection');
    return;
  }

  if (action === 'notice') {
    const message = await showAppPrompt('Enter a notice message to send to the selected shops:', 'Send Notice', 'Message');
    if (!message) return;
    await Promise.all(selectedUids.map(uid => updateTargetShopSubscriptionState(uid, 'notice', message, false)));
    refreshAppAdminSubscriptions();
    return;
  }

  const actionLabel = action === 'activate' ? 'activate' : (action === 'suspend' ? 'suspend' : 'deactivate');
  const confirmed = await showAppConfirm(`Apply ${actionLabel} to ${selectedUids.length} selected shop(s)?`, 'Bulk Subscription Action', 'Continue', 'Cancel');
  if (!confirmed || !confirmed.confirmed) return;

  await Promise.all(selectedUids.map(uid => updateTargetShopSubscriptionState(uid, action, '', false)));
  subscriptionsAdminState.selectedUids.clear();
  refreshAppAdminSubscriptions();
}

async function refreshAppAdminSubscriptions(filter = subscriptionsAdminState.filter) {
  if (currentUserRole !== 'appAdmin') return;

  const tbody = document.getElementById('appAdminSubscriptionsTableBody');
  if (!tbody) return;

tbody.innerHTML = '<tr><td colspan="11" class="u-text-center"><span class="spinner"></span> Loading subscriptions...</td></tr>';

  try {
    const usersSnap = await getDocs(collection(dbFirestore, 'users'));
    const rows = [];
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const dataDoc = await getDoc(doc(dbFirestore, 'users', uid, 'data', 'shop_profile'));
      if (!dataDoc.exists()) continue;

      const userData = userDoc.data();
      const shopData = dataDoc.data();
      const shopName = (shopData.settings && shopData.settings.name) || 'Unnamed Shop';
      const ownerEmail = (userData.email || '').trim() || uid;
      const contact = (shopData.settings && shopData.settings.contact) || 'N/A';
      const whatsapp = userData.whatsapp || 'N/A';
      const logoUrl = sanitizeLogoUrl((shopData.settings && shopData.settings.logo)) || 'assets/icons/icon.png';
      const userStatus = userData.status || 'active';
      const shopStatus = (shopData.appAdminSettings && shopData.appAdminSettings.shopStatus) || 'active';
      const subscriptionExpires = userData.subscriptionExpires || null;
      const meta = getSubscriptionMeta({ userStatus, shopStatus, subscriptionExpires, now: today });
      const lastSync = shopData.lastUpdated ? new Date(shopData.lastUpdated).toLocaleDateString() : 'Never';
      const presence = getPresenceStatus(userData);

      // compute plan details and recent sales
      const planType = String(userData?.planType || userData?.subscriptionPlan || userData?.plan || userData?.billingCycle || userData?.subscriptionType || '').trim().toLowerCase();
      const isTrial = planType === 'trial' || planType === 'trialing' || userData?.isTrial === true;
      const isFree = planType === 'promo' || planType === 'demo' || planType === 'free' || (!userData?.subscriptionExpires && !userData?.subscriptionStartedAt && !userData?.subscriptionStartDate && !userData?.startedAt);

      // check recent transactions (lightweight: fetch latest tx date)
      let hasRecentSales = false;
      try {
        const txRef = collection(dbFirestore, 'users', uid, 'transactions');
        const q = query(txRef, orderBy('date', 'desc'), limit(1));
        const txSnap = await getDocs(q);
        if (!txSnap.empty) {
          const lastTx = txSnap.docs[0].data();
          if (lastTx && lastTx.date) {
            const lastDate = new Date(lastTx.date);
            if (!Number.isNaN(lastDate.getTime()) && lastDate >= sevenDaysAgo) hasRecentSales = true;
          }
        }
      } catch (e) {
        // ignore failures to avoid blocking subscription view
      }

      rows.push({
        uid,
        shopName,
        ownerEmail,
        contact,
        whatsapp,
        logoUrl,
        userStatus,
        shopStatus,
        subscriptionExpires,
        lastSync,
        presence,
        bucket: meta.bucket,
        label: meta.label,
        className: meta.className,
        planType,
        isTrial,
        isFree,
        hasRecentSales,
        visible: true
      });
    }

    const stats = { active: 0, expired: 0, 'expiring-soon': 0, pending: 0, suspended: 0, trialing: 0, free: 0, 'no-sales-7d': 0 };
    const filteredRows = rows.filter(row => {
      if (filter === 'all') return true;
      if (filter === 'active') return row.bucket === 'active';
      if (filter === 'expired') return row.bucket === 'expired';
      if (filter === 'expiring-soon') return row.bucket === 'expiring-soon';
      if (filter === 'pending') return row.bucket === 'pending';
      if (filter === 'suspended') return row.bucket === 'suspended';
      return true;
    });

    filteredRows.forEach(row => {
      if (row.bucket === 'active') stats.active += 1;
      if (row.bucket === 'expired') stats.expired += 1;
      if (row.bucket === 'expiring-soon') stats['expiring-soon'] += 1;
      if (row.bucket === 'pending') stats.pending += 1;
      if (row.bucket === 'suspended') stats.suspended += 1;
      if (row.isTrial) stats.trialing += 1;
      if (row.isFree) stats.free += 1;
      if (!row.hasRecentSales) stats['no-sales-7d'] += 1;
    });

    updateSubscriptionsSummaryCards(stats);
    subscriptionsAdminState.rows = filteredRows;
    subscriptionsAdminState.rows.forEach(row => { row.visible = true; });

    if (!filteredRows.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="u-text-center">No shops match this filter.</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    filteredRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      const expiryText = row.subscriptionExpires ? (() => {
        const expiryDate = new Date(row.subscriptionExpires);
        const isExpired = expiryDate < new Date();
        return `${expiryDate.toLocaleDateString()}${isExpired ? ' (EXPIRED)' : ''}`;
      })() : 'PROMO PLAN';
      const isSelected = subscriptionsAdminState.selectedUids.has(row.uid);
      const shopNameSafe = (row.shopName || 'Unnamed Shop').replace(/'/g, "\\'");
      const ownerEmailSafe = (row.ownerEmail || 'No Email').replace(/'/g, "\\'");
      tr.innerHTML = `
        <td class="u-text-center">${index + 1}</td>
        <td class="u-text-center"><input type="checkbox" class="subscription-row-checkbox" data-uid="${row.uid}" ${isSelected ? 'checked' : ''}></td>
        <td class="u-text-center"><img src="${row.logoUrl}" style="width:32px; height:32px; object-fit:contain; border-radius:4px; border:1px solid var(--border-color);" onerror="this.src='assets/icons/icon.png';"></td>
        <td class="u-bold">${row.shopName}</td>
        <td class="u-fs-08">${row.ownerEmail}</td>
        <td class="u-fs-08">${row.whatsapp}</td>
        <td class="u-fs-08"><span class="shop-card-status ${row.className}">${row.label}</span></td>
        <td class="u-fs-08">
          <span class="shop-card-status ${row.presence.className}" style="padding:2px 6px; font-size:0.7em;">${row.presence.label}</span>
          <div class="u-fs-08" style="margin-top:2px; color: var(--text-muted);">${row.presence.detail}</div>
        </td>
        <td class="u-fs-08">${expiryText}</td>
        <td class="u-fs-08">${row.lastSync}</td>
        <td class="u-text-right">
          <div style="display:flex; gap:4px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn btn-info u-fs-08" style="padding:4px 8px; margin:0;" onclick="monitorShop('${row.uid}', '${shopNameSafe}')">Monitor</button>
            ${row.userStatus === 'pending' ? `<button class="btn btn-success u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetUserStatus('${row.uid}', 'active'); refreshAppAdminSubscriptions();">Approve</button>` : ''}
            <button class="btn btn-danger u-fs-08" style="padding:4px 8px; margin:0;" onclick="deleteShop('${row.uid}', '${shopNameSafe}')">Delete</button>
            <button class="btn btn-success u-fs-08" style="padding:4px 8px; margin:0;" onclick="window.open('https://wa.me/${row.whatsapp}', '_blank')" ${row.whatsapp === 'N/A' ? 'disabled' : ''}>WhatsApp</button>
            <button class="btn btn-success u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetShopSubscriptionState('${row.uid}', 'activate')">Activate</button>
            <button class="btn btn-warning u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetShopSubscriptionState('${row.uid}', 'suspend')">Suspend</button>
            <button class="btn btn-danger u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetShopSubscriptionState('${row.uid}', 'deactivate')">Deactivate</button>
            <button class="btn btn-purple u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetShopSubscriptionState('${row.uid}', 'notice')">Notice</button>
            <input type="date" id="sub-date-${row.uid}" class="u-fs-08" style="padding:3px; border-radius:4px; border:1px solid #ccc; background: white; color: black;">
            <button class="btn btn-purple u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetSubscriptionDate('${row.uid}')">Set Expiry</button>
            <button class="btn btn-primary-blue u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetSubscription('${row.uid}', 1)">+1 Month</button>
            <button class="btn btn-secondary u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetSubscription('${row.uid}', 12)">+1 Year</button>
            <button class="btn btn-success u-fs-08" style="padding:4px 8px; margin:0;" onclick="setFreePlan('${row.uid}')">Promo</button>
          </div>
        </td>
      `;
      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    // Disable auto-refresh to prevent the dashboard section from shifting or scrolling unexpectedly.
    // If manual refresh is needed, the admin can still use the Refresh button.

    tbody.querySelectorAll('input.subscription-row-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (event) => {
        const uid = event.target.getAttribute('data-uid');
        toggleSubscriptionSelection(uid, event.target.checked);
      });
    });

    const selectAllCheckbox = document.getElementById('subscriptionsSelectAllCheckbox');
    if (selectAllCheckbox) {
      const visibleRows = subscriptionsAdminState.rows.filter(row => row.visible);
      selectAllCheckbox.checked = visibleRows.length > 0 && visibleRows.every(row => subscriptionsAdminState.selectedUids.has(row.uid));
    }
  } catch (error) {
    handleFirebaseError(error, 'Load Subscription View', 'users');
    tbody.innerHTML = '<tr><td colspan="11" class="u-text-center" style="color:red;">Error loading subscriptions.</td></tr>';
  }
}

async function updateTargetShopSubscriptionState(uid, action, message = '', refresh = true) {
  if (action === 'notice') {
    const noticeMessage = message || await showAppPrompt('Enter a notice message for this shop:', 'Send Notice', 'Message');
    if (!noticeMessage) return;
    try {
      const sentAt = new Date().toISOString();
      // Save the current notice as latest and append to the history array
      await setDoc(doc(dbFirestore, 'users', uid, 'data', 'shop_profile'), {
        appAdminSettings: {
          noticeMessage,
          noticeSentAt: sentAt,
          notices: arrayUnion({ message: noticeMessage, sentAt, by: (currentUser && currentUser.email) ? currentUser.email : currentUser?.uid || 'admin' })
        }
      }, { merge: true });
      if (typeof showAppAlert === 'function') showAppAlert(`Notice sent to ${uid}.`);
      if (refresh) refreshAppAdminSubscriptions();
    } catch (error) {
      handleFirebaseError(error, 'Send Subscription Notice', `users/${uid}/data/shop_profile`);
    }
    return;
  }

  const statusMap = {
    activate: 'active',
    suspend: 'suspended',
    deactivate: 'deactivated'
  };
  const nextStatus = statusMap[action];
  if (!nextStatus) return;

  if (typeof showAppConfirm === 'function') {
    const resp = await showAppConfirm(`Set this shop to ${nextStatus.toUpperCase()}?`, 'Update Subscription Status', 'Continue', 'Cancel');
    if (!resp || !resp.confirmed) return;
  }

  try {
    await Promise.all([
      setDoc(doc(dbFirestore, 'users', uid), { status: nextStatus }, { merge: true }),
      setDoc(doc(dbFirestore, 'users', uid, 'data', 'shop_profile'), { appAdminSettings: { shopStatus: nextStatus } }, { merge: true })
    ]);

    if (typeof showAppAlert === 'function') showAppAlert(`Shop status updated to ${nextStatus}.`);
    if (refresh) {
      refreshAppAdminSubscriptions();
      refreshAppAdminShops();
    }
  } catch (error) {
    handleFirebaseError(error, 'Update Subscription Status', `users/${uid}`);
  }
}

/**
 * Fetches all registered shops for the App Admin dashboard
 */
let lastShopsRefreshId = 0; // Concurrency lock to prevent duplicate UI rendering
async function refreshAppAdminShops() {
  if (currentUserRole !== 'appAdmin') return;

  const currentRefreshId = ++lastShopsRefreshId;
  const container = document.getElementById('appAdminShopCardsContainer');
  if (!container) return;

  // Show loading state and clear existing content
  container.innerHTML = '<div class="u-text-center u-w-full" id="shops-loading-indicator"><span class="spinner"></span> Loading registered shops...</div>';
  const loadingIndicator = document.getElementById('shops-loading-indicator');

  try {
    // ===== PRODUCTION OPTIMIZATION: Batched query with request deduplication =====
    healthMetrics.firebaseCalls++;

    // Use optimized cached query instead of raw getDocs
    const queryResult = await getCachedQuery(
      'admin_shops_all',
      () => getDocs(collection(dbFirestore, "users")),
      60000 // Cache for 1 minute
    );

    const usersSnap = queryResult;

    // Use Sets to track processed UIDs and Emails to prevent UI duplication
    const seenUids = new Set();
    const seenEmails = new Set();
    const seenShopNames = new Set();

    if (usersSnap.empty) {
      container.innerHTML = '<p class="u-text-center u-w-full">No registered shops found.</p>';
      return;
    }

    const shopCards = [];

    for (const userDoc of usersSnap.docs) {
      // Abort this execution if a newer refresh request has started
      if (currentRefreshId !== lastShopsRefreshId) return;

      const uid = userDoc.id;

      // 1. Fetch the specific shop data first to verify existence and name
      const dataDoc = await getDoc(doc(dbFirestore, "users", uid, "data", "shop_profile"));
      if (!dataDoc.exists()) continue; // Skip accounts that haven't initialized shop data

      const shopData = dataDoc.data();

      // 1b. Filtering: If it's the Master Admin account, only show it if they actually have a menu
      // This prevents the Admin's internal document from appearing as a "Shop".
      const menuItems = shopData.menu || [];
      if (uid === MASTER_APP_ADMIN_UID && menuItems.length === 0) continue;

      const shopSettings = shopData.settings || {};
      const shopName = (shopSettings.name || '').toLowerCase().trim();

      const userData = userDoc.data();
      const userEmail = (userData.email || '').toLowerCase().trim();
      const userStatus = userData.status || 'active';
      const whatsappNum = userData.whatsapp || 'N/A';
      const subExpires = userData.subscriptionExpires || null;

      // Robust email detection: sometimes the document ID itself is the email
      const effectiveEmail = (uid.includes('@') && !userEmail) ? uid.toLowerCase().trim() : userEmail;

      // 2. Enforce strict uniqueness across Email and Shop Name to prevent logical duplicates
      // (e.g. if a user logs in with Google and Password separately creating two UIDs)
      if (effectiveEmail && seenEmails.has(effectiveEmail)) continue;

      // Only filter by name if it's a "real" name (not the default placeholder)
      const isDefaultName = shopName === 'my business' || shopName === 'yoshop';
      if (!isDefaultName && shopName && seenShopNames.has(shopName)) continue;
      if (seenUids.has(uid)) continue;

      const lastActive = userData.lastLogin ? new Date(userData.lastLogin).toLocaleString() : 'Never';

      seenUids.add(uid);
      if (userEmail) seenEmails.add(userEmail);
      if (shopName) seenShopNames.add(shopName);

      const accountEmail = userData.email || 'No Email';
      const contactInfo = shopSettings.contact || 'N/A';
      const logoUrl = sanitizeLogoUrl(shopSettings.logo) || 'assets/icons/icon.png';

      // Determine shop status from its own admin settings
      const shopStatus = (shopData.appAdminSettings && shopData.appAdminSettings.shopStatus) || 'active';

      // Priority: Global User Status (Pending/Active) then Shop-specific status
      let statusLabel = userStatus.charAt(0).toUpperCase() + userStatus.slice(1);
      let statusClass = userStatus === 'active' ? 'active' : (userStatus === 'pending' ? 'suspended' : 'deactivated');

      if (userStatus === 'active' && shopStatus !== 'active') {
        statusLabel = shopStatus.charAt(0).toUpperCase() + shopStatus.slice(1);
        statusClass = 'suspended';
      }

      let subStatusHtml = '';
      if (subExpires) {
        const expiryDate = new Date(subExpires);
        const isExpired = expiryDate < new Date();
        subStatusHtml = `<p class="u-fs-08" style="color: ${isExpired ? '#dc3545' : 'inherit'}"><strong>Subscription:</strong> ${expiryDate.toLocaleDateString()} ${isExpired ? '(EXPIRED)' : ''}</p>`;
      } else if (userStatus === 'active') {
        subStatusHtml = `<p class="u-fs-08" style="color: #28a745"><strong>Plan:</strong> PROMO PLAN</p>`;
      }

      const card = document.createElement('div');
      card.className = 'shop-card';
      card.onclick = (e) => { if (!e.target.closest('button')) monitorShop(uid, shopSettings.name || 'Unnamed Shop'); };

      card.innerHTML = `
          <img src="${logoUrl}" class="shop-card-logo" onerror="this.src='assets/icons/icon.png';">
          <div class="shop-card-title">${shopSettings.name || 'New Shop'}</div>
          <div class="shop-card-meta">
            <span class="shop-card-status ${statusClass}">${statusLabel}</span>
            <span class="u-fs-08" title="UID: ${uid}">${uid.substring(0, 8)}...</span>
          </div>
          <div class="shop-card-details">
            <p class="u-fs-08" title="${accountEmail}"><strong>Owner Account:</strong> ${accountEmail}</p>
            <p class="u-fs-08"><strong>Contact:</strong> ${contactInfo}</p>
            <p class="u-fs-08"><strong>WhatsApp:</strong> ${whatsappNum}</p>
            <p class="u-fs-08"><strong>Last Active:</strong> ${lastActive}</p>
            <p class="u-fs-08"><strong>Last Sync:</strong> ${shopData.lastUpdated ? new Date(shopData.lastUpdated).toLocaleDateString() : 'Never'}</p>
            ${subStatusHtml}
          </div>
          <div style="display:flex; gap:5px; margin-top:auto; padding-top:10px; border-top: 1px solid var(--border-color); flex-wrap: wrap;">
            <button class="btn btn-info u-flex-1" onclick="monitorShop('${uid}', '${(shopSettings.name || 'Unnamed Shop').replace(/'/g, "\\'")}')" style="margin:0;">Monitor</button>
            ${userStatus === 'pending' ? `<button class="btn btn-success u-flex-1" onclick="updateTargetUserStatus('${uid}', 'active')" style="margin:0;">Approve</button>` : ''}
            <button class="btn btn-danger" onclick="deleteShop('${uid}', '${(shopSettings.name || 'Unnamed').replace(/'/g, "\\'")}')" style="margin:0; flex: 0.5;">Delete</button>
            <button class="btn btn-success" onclick="window.open('https://wa.me/${whatsappNum}', '_blank')" style="margin:0; flex: 0.5;" ${whatsappNum === 'N/A' ? 'disabled' : ''}>WhatsApp</button>
          </div>
          <div style="display:flex; gap:5px; margin-top:5px; align-items:center;">
            <input type="date" id="sub-date-${uid}" class="u-fs-08" style="flex:2; padding:3px; border-radius:4px; border:1px solid #ccc; background: white; color: black;">
            <button class="btn btn-purple u-fs-08 u-flex-1" onclick="updateTargetSubscriptionDate('${uid}')" style="margin:0; padding:4px;">Set Expiry</button>
          </div>

          <div style="display:flex; gap:5px; margin-top:5px;">
            <button class="btn btn-success u-fs-08 u-flex-1" onclick="updateTargetShopStatus('${uid}', 'active')" style="margin:0; padding:4px;">Activate</button>
            <button class="btn btn-warning u-fs-08 u-flex-1" onclick="updateTargetShopStatus('${uid}', 'suspended')" style="margin:0; padding:4px;">Suspend</button>
          </div>
          <div style="display:flex; gap:5px; margin-top:5px;">
            <button class="btn btn-primary-blue u-fs-08 u-flex-1" onclick="updateTargetSubscription('${uid}', 1)" style="margin:0; padding:4px;">+1 Month</button>
            <button class="btn btn-secondary u-fs-08 u-flex-1" onclick="updateTargetSubscription('${uid}', 12)" style="margin:0; padding:4px;">+1 Year</button>
            <button class="btn btn-success u-fs-08 u-flex-1" onclick="setFreePlan('${uid}')" style="margin:0; padding:4px;">Promo Plan</button>
          </div>
        `;
      shopCards.push(card);
    }

    // Final UI update: only if we are still the latest request
    if (currentRefreshId === lastShopsRefreshId) {
      container.innerHTML = ''; // Final clear right before appending
      if (shopCards.length === 0) {
        container.innerHTML = '<p class="u-text-center u-w-full">No active shops found.</p>';
        return;
      }

      // ===== PRODUCTION OPTIMIZATION: Improved pagination for 100+ shops =====
      const shopsPerPage = 25; // Increased from 10 for better loading
      const initialShops = shopCards.slice(0, shopsPerPage);
      const remainingShops = shopCards.slice(shopsPerPage);

      initialShops.forEach(card => container.appendChild(card));

      if (remainingShops.length > 0) {
        const showMoreContainer = document.createElement('div');
        showMoreContainer.style.textAlign = 'center';
        showMoreContainer.style.padding = '20px';
        showMoreContainer.innerHTML = `
            <button class="btn btn-info" onclick="document.getElementById('appAdminShopCardsContainer').querySelectorAll('.shop-card.hidden').forEach(c => { c.classList.remove('hidden'); c.style.display=''; }); this.style.display='none';" style="padding: 12px 30px;">
              Show ${remainingShops.length} More Shops (${shopCards.length} total)
            </button>
          `;
        container.appendChild(showMoreContainer);

        // Add hidden class to remaining shops
        remainingShops.forEach(card => {
          card.classList.add('hidden');
          card.style.display = 'none';
          container.appendChild(card);
        });
      }
    }

  } catch (error) {
    healthMetrics.firebaseErrors++;
    captureError('ADMIN_SHOPS_REFRESH', error);
    handleFirebaseError(error, "Load All Shops", "users (collection level)");
    container.innerHTML = '<p class="u-text-center u-w-full">Error loading shops. Check console.</p>';
  }
}

/**
 * Fetches all registered shops and displays them in a table for detailed management
 */
let lastShopsTableRefreshId = 0;
async function refreshAppAdminShopsTable() {
  if (currentUserRole !== 'appAdmin') return;

  const currentRefreshId = ++lastShopsTableRefreshId;
  const tbody = document.getElementById('appAdminShopsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="u-text-center"><span class="spinner"></span> Loading shops details...</td></tr>';

  try {
    const usersSnap = await getDocs(collection(dbFirestore, "users"));

    const seenEmails = new Set();
    const rows = [];

    if (usersSnap.empty) {
      tbody.innerHTML = '<tr><td colspan="8" class="u-text-center">No registered shops found.</td></tr>';
      return;
    }

    for (const userDoc of usersSnap.docs) {
      if (currentRefreshId !== lastShopsTableRefreshId) return;

      const uid = userDoc.id;
      const dataDoc = await getDoc(doc(dbFirestore, "users", uid, "data", "shop_profile"));
      if (!dataDoc.exists()) continue;

      const shopData = dataDoc.data();
      if (uid === MASTER_APP_ADMIN_UID && (shopData.menu || []).length === 0) continue;

      const userData = userDoc.data();
      const userEmail = (userData.email || '').toLowerCase().trim();
      const whatsappNum = userData.whatsapp || 'N/A';
      const effectiveEmail = (uid.includes('@') && !userEmail) ? uid.toLowerCase().trim() : userEmail;

      if (effectiveEmail && seenEmails.has(effectiveEmail)) continue;
      if (effectiveEmail) seenEmails.add(effectiveEmail);

      const shopSettings = shopData.settings || {};
      const logoUrl = sanitizeLogoUrl(shopSettings.logo) || 'assets/icons/icon.png';
      const userStatus = userData.status || 'active';
      const shopStatus = (shopData.appAdminSettings && shopData.appAdminSettings.shopStatus) || 'active';

      let statusLabel = userStatus.charAt(0).toUpperCase() + userStatus.slice(1);
      let statusClass = userStatus === 'active' ? 'active' : (userStatus === 'pending' ? 'suspended' : 'deactivated');
      if (userStatus === 'active' && shopStatus !== 'active') {
        statusLabel = shopStatus.charAt(0).toUpperCase() + shopStatus.slice(1);
        statusClass = 'suspended';
      }

      const subExpires = userData.subscriptionExpires ? new Date(userData.subscriptionExpires) : null;
      let subText = 'PROMO PLAN';
      let subStyle = 'color: #28a745; font-weight: bold;';
      if (subExpires) {
        const isExpired = subExpires < new Date();
        subText = subExpires.toLocaleDateString() + (isExpired ? ' (EXPIRED)' : '');
        if (isExpired) subStyle = 'color: #dc3545; font-weight: bold;';
        else subStyle = 'font-weight: bold;';
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td class="u-text-center"><img src="${logoUrl}" style="width:32px; height:32px; object-fit:contain; border-radius:4px; border:1px solid var(--border-color);" onerror="this.src='assets/icons/icon.png';"></td>
          <td class="u-bold">${shopSettings.name || 'Unnamed Shop'}</td>
          <td class="u-fs-08">${effectiveEmail || 'No Email'}</td>
          <td class="u-fs-08">${shopSettings.contact || 'N/A'}</td>
          <td class="u-fs-08">${whatsappNum}</td>
          <td class="u-text-center"><span class="shop-card-status ${statusClass}" style="padding: 2px 6px; font-size: 0.7em;">${statusLabel}</span></td>
          <td class="u-fs-08" style="${subStyle}">${subText}</td>
          <td class="u-fs-08">${shopData.lastUpdated ? new Date(shopData.lastUpdated).toLocaleDateString() : 'Never'}</td>
          <td class="u-text-right">
            <div style="display:flex; gap:4px; justify-content:flex-end;">
              <button class="btn btn-info u-fs-08" style="padding:4px 8px; margin:0;" onclick="monitorShop('${uid}', '${(shopSettings.name || 'Unnamed Shop').replace(/'/g, "\\'")}')">Monitor</button>
              ${userStatus === 'pending' ? `<button class="btn btn-success u-fs-08" style="padding:4px 8px; margin:0;" onclick="updateTargetUserStatus('${uid}', 'active'); refreshAppAdminShopsTable();">Approve</button>` : ''}
              <button class="btn btn-danger u-fs-08" style="padding:4px 8px; margin:0;" onclick="deleteShop('${uid}', '${(shopSettings.name || 'Unnamed').replace(/'/g, "\\'")}')">Delete</button>
              <button class="btn btn-success u-fs-08" style="padding:4px 8px; margin:0;" onclick="window.open('https://wa.me/${whatsappNum}', '_blank')" ${whatsappNum === 'N/A' ? 'disabled' : ''}>WhatsApp</button>
            </div>
          </td>
        `;
      rows.push(tr);
    }

    if (currentRefreshId === lastShopsTableRefreshId) {
      tbody.innerHTML = '';
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="u-text-center">No active shops found.</td></tr>';
        return;
      }

      // Show first 20 rows, add "Show More" button if needed
      const rowsPerPage = 20;
      const initialRows = rows.slice(0, rowsPerPage);
      const remainingRows = rows.slice(rowsPerPage);

      initialRows.forEach(row => tbody.appendChild(row));

      if (remainingRows.length > 0) {
        const showMoreRow = document.createElement('tr');
        showMoreRow.innerHTML = `
            <td colspan="8" style="text-align: center; padding: 20px;">
              <button class="btn btn-info" onclick="const tbody = this.closest('tbody'); tbody.querySelectorAll('tr.shop-row-hidden').forEach(r => r.classList.remove('shop-row-hidden')); tbody.querySelectorAll('tr.shop-row-hidden').forEach(r => r.style.display = ''); this.closest('tr').style.display = 'none';" style="padding: 8px 20px;">
                Show ${remainingRows.length} More Shops
              </button>
            </td>
          `;
        tbody.appendChild(showMoreRow);

        // Add hidden class to remaining rows
        remainingRows.forEach(row => {
          row.classList.add('shop-row-hidden');
          row.style.display = 'none';
          tbody.appendChild(row);
        });
      }
    }

  } catch (error) {
    handleFirebaseError(error, "Load Shops Table", "users");
    tbody.innerHTML = '<tr><td colspan="8" class="u-text-center" style="color:red;">Error loading data.</td></tr>';
  }
}

/**
 * Switches the app context to monitor a specific shop
 */
async function monitorShop(shopUid, shopName) {
  if (typeof showAppConfirm === 'function') {
    const resp = await showAppConfirm(`Switch to monitoring mode for "${shopName}"?`, 'Monitoring Mode', 'Continue', 'Cancel');
    if (!resp || !resp.confirmed) return;
  }

  console.log(`[ADMIN] Entering monitoring mode for UID: ${shopUid}`);

  isMonitoringMode = true;

  // 1. Stop current listeners and CLEAR local state to prevent data mixing between shops
  if (unsubscribeSync) unsubscribeSync();
  // IMPORTANT: Reset isInitialLoadComplete so the backgrounding sync doesn't fire with empty state
  // and overwrite the target shop's Firestore data before the real-time listener loads it
  isInitialLoadComplete = false;
  menu = []; activeOrders = {}; transactions = []; staff = []; dishCategories = []; customers = []; units = []; restockHistory = [];

  // 2. Fetch and update local metadata to match the shop we are monitoring
  getDoc(doc(dbFirestore, "users", shopUid)).then(userSnap => {
    if (userSnap.exists()) {
      userMetadata = { ...userSnap.data(), uid: shopUid };
      updateAuthUI(currentUser);
    }
  });

  // Setup real-time sync with the TARGET shop's UID instead of admin's UID
  setupRealTimeSync(shopUid);

  // Show a persistent banner that we are in monitoring mode
  const banner = document.getElementById('selectedShopBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><strong>Monitoring:</strong> ${shopName} (${shopUid.substring(0, 8)})</span>
          <button class="btn btn-danger" onclick="location.reload()" style="margin:0; padding:4px 10px;">Exit Monitor</button>
        </div>
      `;
  }

  const dashboardBtn = document.querySelector('nav button:first-child');
  if (dashboardBtn) {
    showTab('dashboardTab', dashboardBtn);
  }
}

/**
 * Remotely updates the status of a specific shop
 */
async function updateTargetShopStatus(uid, status) {
  if (typeof showAppConfirm === 'function') {
    const resp = await showAppConfirm(`Are you sure you want to set this shop status to ${status.toUpperCase()}?`, 'Update Shop Status', 'Continue', 'Cancel');
    if (!resp || !resp.confirmed) return;
  }

  try {
    // Update the shop_profile configuration for the target user
    const shopRef = doc(dbFirestore, "users", uid, "data", "shop_profile");
    await setDoc(shopRef, {
      appAdminSettings: { shopStatus: status }
    }, { merge: true });

    refreshAppAdminShops(); // Refresh UI to show updated badge
  } catch (error) {
    handleFirebaseError(error, "Update Shop Status", `users/${uid}/data/shop_profile`);
  }
}

/**
 * Sets a user to the Free Plan (No expiry)
 */
async function setFreePlan(uid) {
  if (typeof showAppConfirm === 'function') {
    const resp = await showAppConfirm("Set this shop to Promo Plan? This removes the subscription expiry restriction.", 'Promo Plan', 'Continue', 'Cancel');
    if (!resp || !resp.confirmed) return;
  }
  try {
    await setDoc(doc(dbFirestore, "users", uid), {
      status: 'active',
      subscriptionExpires: null
    }, { merge: true });
    if (typeof showAppAlert === 'function') showAppAlert("Shop set to Promo Plan.");
    else alert("Shop set to Promo Plan.");
    refreshAppAdminShops();
  } catch (error) {
    handleFirebaseError(error, "Set Free Plan", `users/${uid}`);
  }
}

/**
 * Sets a specific subscription expiry date
 */
async function updateTargetSubscriptionDate(uid) {
  const dateInput = document.getElementById(`sub-date-${uid}`);
  const dateVal = dateInput.value;
  if (!dateVal) return alert("Please select a date first.");

  try {
    const expiry = new Date(dateVal).toISOString();
    await setDoc(doc(dbFirestore, "users", uid), { subscriptionExpires: expiry, status: 'active' }, { merge: true });
    alert(`Subscription expiry updated.`);
    refreshAppAdminShops();
  } catch (error) {
    handleFirebaseError(error, "Update Subscription Date", `users/${uid}`);
  }
}

/**
 * Updates the global user status (e.g. approving a pending user)
 */
async function updateTargetUserStatus(uid, status) {
  try {
    await setDoc(doc(dbFirestore, "users", uid), { status }, { merge: true });
    alert(`User status updated to ${status}.`);
    refreshAppAdminShops();
  } catch (error) {
    handleFirebaseError(error, "Update User Status", `users/${uid}`);
  }
}

/**
 * Extends the subscription for a target shop
 */
async function updateTargetSubscription(uid, months) {
  try {
    const userRef = doc(dbFirestore, "users", uid);
    const userSnap = await getDoc(userRef);
    let currentExpiry = (userSnap.exists() && userSnap.data().subscriptionExpires) ? new Date(userSnap.data().subscriptionExpires) : new Date();

    if (currentExpiry < new Date()) currentExpiry = new Date();
    currentExpiry.setMonth(currentExpiry.getMonth() + months);

    await setDoc(userRef, { subscriptionExpires: currentExpiry.toISOString() }, { merge: true });
    alert(`Subscription extended by ${months} month(s). New expiry: ${currentExpiry.toLocaleDateString()}`);
    refreshAppAdminShops();
  } catch (error) {
    handleFirebaseError(error, "Update Subscription", `users/${uid}`);
  }
}

/**
 * Analyzes user and shop status to return display-ready info
 */
function getSubscriptionInfo() {
  const userStatus = userMetadata?.status || 'active';
  const subExpires = userMetadata?.subscriptionExpires ? new Date(userMetadata.subscriptionExpires) : null;
  const isExpired = subExpires && subExpires < new Date();
  const shopStatus = appAdminSettings?.shopStatus || 'active';
  const planType = String(userMetadata?.planType || userMetadata?.subscriptionPlan || userMetadata?.plan || userMetadata?.billingCycle || userMetadata?.subscriptionType || '').trim().toLowerCase();
  const isPromoPlan = planType === 'promo' || planType === 'demo' || planType === 'free' || (!subExpires && !userMetadata?.subscriptionStartedAt && !userMetadata?.subscriptionStartDate && !userMetadata?.startedAt);

  let label = (userStatus === 'pending') ? "PENDING" : ((shopStatus !== 'active') ? shopStatus.toUpperCase() : (isExpired ? "EXPIRED" : (subExpires ? "ACTIVE" : "PROMO PLAN")));
  let color = (userStatus === 'pending' || shopStatus !== 'active' || isExpired) ? "#dc3545" : "#28a745";

  return { label, color, subExpires, isExpired, userStatus, shopStatus, planType, isPromoPlan };
}

function formatSubscriptionCountdown(remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'Expired';

  const totalMs = Math.max(0, remainingMs);
  const days = Math.floor(totalMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((totalMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s remaining`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s remaining`;
  if (minutes > 0) return `${minutes}m ${seconds}s remaining`;
  if (seconds > 0) return `${seconds}s remaining`;
  return `${totalMs}ms remaining`;
}

function renderFooterClock() {
  const clockEl = document.getElementById('footer-live-clock');
  if (!clockEl) return;

  const now = new Date();
  const formattedDate = now.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const formattedTime = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  clockEl.textContent = `${formattedDate} • ${formattedTime}`;
  clockEl.style.color = '#6c757d';
}

function renderSubscriptionFooterInfo() {
  const footerEl = document.getElementById('subscription-footer-status');
  if (!footerEl) return;

  if (currentUserRole === 'appAdmin') {
    footerEl.textContent = '';
    footerEl.style.display = 'none';
    return;
  }

  const subInfo = getSubscriptionInfo();
  const startedAtValue = userMetadata?.subscriptionStartedAt || userMetadata?.subscriptionStartDate || userMetadata?.startedAt || userMetadata?.createdAt || userMetadata?.lastLogin || userMetadata?.activationDate;
  const startedAt = startedAtValue ? new Date(startedAtValue) : null;

  if (subInfo.isPromoPlan || subInfo.label === 'PROMO PLAN') {
    footerEl.textContent = 'Promo Plan';
    footerEl.style.color = '#f59e0b';
    return;
  }

  if (!subInfo.subExpires || !startedAt || !Number.isFinite(startedAt.getTime())) {
    footerEl.textContent = 'Subscription plan active';
    footerEl.style.color = '#6c757d';
    return;
  }

  const remainingMs = subInfo.subExpires.getTime() - Date.now();
  if (remainingMs <= 0) {
    footerEl.textContent = 'Subscription expired';
    footerEl.style.color = '#dc3545';
    return;
  }

  const planLabel = subInfo.planType === 'yearly' ? 'Yearly Plan' : (subInfo.planType === 'monthly' ? 'Monthly Plan' : 'Subscription Plan');
  footerEl.textContent = `${planLabel} • ${formatSubscriptionCountdown(remainingMs)}`;
  footerEl.style.color = subInfo.isExpired ? '#dc3545' : '#28a745';
}

/**
 * Robust wrapper for Firebase errors to provide better debugging info
 */
function handleFirebaseError(error, context = "Firebase Operation", path = "unknown") {
  const errorCode = error.code || 'unknown';
  const errorMessage = error.message || 'An unexpected error occurred';

  console.error(`[${context}] ❌ Error (${errorCode}) on path [${path}]:`, errorMessage);

  if (errorCode === 'permission-denied') {
    console.warn(`[${context}] 🔐 Security Rules violation. Path: ${path}. Check if the user is authenticated and rules allow access to the path.`);
  } else if (errorCode === 'not-found') {
    console.warn(`[${context}] 🔍 The requested document or database instance was not found.`);
  } else if (errorCode === 'unavailable') {
    console.warn(`[${context}] 🔌 Service is currently unavailable. The app will continue in offline mode.`);
  }

  return { code: errorCode, message: errorMessage };
}

/**
 * Debounced cloud sync - fires immediately but only syncs to cloud once per debounce period
 * This prevents excessive Firebase writes while ensuring rapid local updates
 */
async function saveData(syncToCloud = true, options = {}) {
  try {
    menu = normalizeProductCatalog(menu || []);
    transactions = deduplicateTransactions(Array.isArray(transactions) ? transactions : []);

    // Save to local IndexedDB immediately (always, synchronous)
    // Use Promise.allSettled instead of Promise.all to handle individual errors gracefully
    await Promise.allSettled([
      saveState('menu', menu || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('activeOrders', activeOrders || {}, {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('transactions', transactions || [], {
        enqueueSync: false,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('settings', settings || defaultSettings, {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('staff', staff || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('dishCategories', dishCategories || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('customers', customers || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('units', units || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('restockHistory', restockHistory || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('appAdminSettings', appAdminSettings || defaultAppAdminSettings, {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      }),
      saveState('auditTrail', auditTrail || [], {
        enqueueSync: syncToCloud,
        allowEmptyOverwriteFields: options.allowEmptyOverwriteFields || []
      })
    ]);
    if (options.skipEnterpriseMirror !== true) {
      await mirrorEnterpriseRecordsToLocalStores();
    }
    await persistImageCache();
    // Debounce cloud sync to prevent excessive Firebase writes
    const effectiveUid = getEffectiveUid();
    if (syncToCloud && effectiveUid && isInitialLoadComplete && dbFirestore) {
      // If we're online and ready, attempt an immediate flush so new items sync on-spot
      if (navigator.onLine && !isSyncing) {
        try {
          await flushLocalSyncQueue({ force: true, skipStatusUpdate: true });
        } catch (e) {
          console.warn('[SYNC] Immediate flush failed:', e);
        }
      }
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(async () => {
        syncDebounceTimer = null;
        const now = Date.now();
        if (now - lastSyncTime < MIN_SYNC_INTERVAL) return;

        try {
          isDebouncing = true;
          const statusEl = document.getElementById('connectivity-status');
          if (statusEl) statusEl.style.opacity = '0.5';

                  const syncResults = await flushLocalSyncQueue({ force: true, skipStatusUpdate: true });
          const syncSummary = summarizeSyncResults(syncResults);

          lastSyncTime = Date.now();

          if (syncSummary.failed > 0) {
            syncFailureCount += syncSummary.failed;
          } else {
            syncFailureCount = 0;
          }

          if (statusEl) {
            statusEl.style.opacity = '1';
            statusEl.classList.add('sync-pulse');
            setTimeout(() => statusEl.classList.remove('sync-pulse'), 600);
          }

          const syncBtn = document.getElementById('header-sync-status');
          if (syncBtn) {
            syncBtn.setAttribute('data-tooltip', 'Last synced: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          }
          console.log('[SYNC] Queue flush complete:', syncSummary);
        } catch (firestoreError) {
          syncFailureCount++;
          handleFirebaseError(firestoreError, "Firestore Sync", `users/${effectiveUid}/data/shop_profile`);
        } finally {
          isDebouncing = false;
        }
      }, SYNC_DEBOUNCE_DELAY);
    }

    if (syncToCloud && navigator.onLine) {
      scheduleBackgroundSync();
    }
    await updateOnlineStatus().catch(error => {
      console.warn('[SYNC] Could not refresh sync status after save:', error);
    });
  } catch (error) {
    console.error("[SYNC] ❌ Local save failed:", error);
    syncFailureCount++;
    await updateOnlineStatus().catch(error => {
      console.warn('[SYNC] Could not refresh sync status after save failure:', error);
    });
  }
}
function buildSaleItemRecords(transaction = {}) {
  const saleId = transaction.recordId || transaction.id || transaction.date || createEntityId('sales', transaction);
  const items = Array.isArray(transaction.items) ? transaction.items : [];

  return items.map((item, index) => enrichEnterpriseRecord('saleItems', {
    id: `${saleId}-item-${index + 1}`,
    recordId: `${saleId}-item-${index + 1}`,
    saleId,
    productName: item.name || '',
    productId: item.productId || item.recordId || item.id || '',
    qty: Number(item.qty || 0),
    unitPrice: Number(item.price || 0),
    lineTotal: Number(item.qty || 0) * Number(item.price || 0),
    notes: item.notes || '',
    date: transaction.date || new Date().toISOString()
  }));
}

function buildPaymentRecord(transaction = {}) {
  const saleId = transaction.recordId || transaction.id || transaction.date || createEntityId('sales', transaction);
  const amount = Number(transaction.total || 0);

  return enrichEnterpriseRecord('payments', {
    id: `${saleId}-payment-1`,
    recordId: `${saleId}-payment-1`,
    saleId,
    amount,
    method: transaction.paymentMethod || 'Cash',
    status: 'paid',
    date: transaction.date || new Date().toISOString()
  });
}

async function mirrorSaleDetailsLocally(transaction = {}) {
  if (!localRepositoryReady || !localRepository || typeof localRepository.saveEntity !== 'function') return;

  const saleItems = buildSaleItemRecords(transaction);
  const payment = buildPaymentRecord(transaction);

  await Promise.allSettled([
    ...saleItems.map(record => localRepository.saveEntity('saleItems', record, {
      enqueueSync: false,
      preserveVersion: true
    })),
    localRepository.saveEntity('payments', payment, {
      enqueueSync: false,
      preserveVersion: true
    })
  ]);
}

/**
 * Records a single transaction to local storage and Firestore sub-collection
 */
function normalizeTransactionInvoiceNumber(invoiceNumber = '') {
  if (!invoiceNumber || typeof invoiceNumber !== 'string') return '';
  const trimmed = invoiceNumber.trim();
  return trimmed || '';
}

async function cleanupDuplicateTransactionsInCloud(cleanTransactions = []) {
  const effectiveUid = getEffectiveUid();
  if (!effectiveUid || !dbFirestore || !Array.isArray(cleanTransactions)) return;

  const txRef = collection(dbFirestore, 'users', effectiveUid, 'transactions');
  try {
    const snapshot = await getDocs(txRef);
    const cloudTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const transactionGroups = new Map();

    cloudTransactions.forEach(transaction => {
      if (!transaction || typeof transaction !== 'object') return;
      const key = getTransactionDuplicateKey(transaction);
      if (!key) return;
      const bucket = transactionGroups.get(key) || [];
      bucket.push(transaction);
      transactionGroups.set(key, bucket);
    });

    await Promise.allSettled(Array.from(transactionGroups.entries()).filter(([, group]) => group.length > 1).map(([, group]) => {
      const canonical = group.sort((a, b) => {
        const timeA = Number(new Date(a.updatedAt || a.date || 0).getTime());
        const timeB = Number(new Date(b.updatedAt || b.date || 0).getTime());
        if (timeA !== timeB) return timeA - timeB;
        return Number(b.version || 0) - Number(a.version || 0);
      })[group.length - 1];

      if (!canonical) return Promise.resolve();
      return Promise.allSettled(group
        .filter(transactionDoc => String(transactionDoc.id || transactionDoc.recordId || '') !== String(canonical.id || canonical.recordId || ''))
        .map(transactionDoc => {
          const ref = doc(dbFirestore, 'users', effectiveUid, 'transactions', transactionDoc.id);
          return deleteDoc(ref);
        }))
        .catch(error => {
          console.warn('[TX-CLEANUP] Failed to prune duplicate cloud transactions:', error);
        });
    }));
  } catch (error) {
    console.warn('[TX-CLEANUP] Failed to inspect cloud transactions:', error);
  }
}

async function persistDeduplicatedTransactions(sourceTransactions = []) {
  const dedupedTransactions = deduplicateTransactions(Array.isArray(sourceTransactions) ? sourceTransactions : []);
  transactions = dedupedTransactions;
  await saveState('transactions', transactions, { enqueueSync: false });
  await cleanupDuplicateTransactionsInCloud(transactions);
  updateDashboard();
  renderTransactions();
  return dedupedTransactions;
}

async function recordTransaction(transaction) {
  if (!transaction.invoiceNumber) {
    transaction.invoiceNumber = getInvoiceNumber(transaction);
  }
  // 1. Mark as not synced initially and add to local state for immediate UI update
  transaction = enrichEnterpriseRecord('sales', {
    ...transaction,
    synced: false,
    syncStatus: 'pending'
  }, transaction);

  const duplicateIndex = transactions.findIndex(existing => {
    if (!existing || !existing.date) return false;
    const sameId = Boolean(existing.id && transaction.id && existing.id === transaction.id);
    const sameInvoiceNumber = Boolean(
      normalizeTransactionInvoiceNumber(existing.invoiceNumber) &&
      normalizeTransactionInvoiceNumber(transaction.invoiceNumber) &&
      normalizeTransactionInvoiceNumber(existing.invoiceNumber) === normalizeTransactionInvoiceNumber(transaction.invoiceNumber)
    );
    return sameId || sameInvoiceNumber;
  });

  if (duplicateIndex >= 0) {
    transactions[duplicateIndex] = { ...transactions[duplicateIndex], ...transaction };
  } else {
    transactions.unshift(transaction);
  }

  transactions = deduplicateTransactions(transactions);
  appendAuditEvent('sale_completed', {
    total: transaction.total || 0,
    paymentMethod: transaction.paymentMethod || 'Cash',
    itemCount: Array.isArray(transaction.items) ? transaction.items.length : 0
  });
  await persistAuditTrail();

  // Keep local list at reasonable size for performance
  if (transactions.length > 1000) transactions.pop();

  // 2. Save locally to IndexedDB without re-enqueueing the entire transactions list
  await saveState('transactions', transactions, { enqueueSync: false });
  await mirrorSaleDetailsLocally(transaction);
  const saleItems = buildSaleItemRecords(transaction);
  const paymentRecord = buildPaymentRecord(transaction);

  await Promise.allSettled([
    ...saleItems.map(record => enqueueEnterpriseRecordChange('sale_items', record, 'upsert')),
    enqueueEnterpriseRecordChange('payments', paymentRecord, 'upsert')
  ]);

  const effectiveUid = getEffectiveUid();
  if (effectiveUid && dbFirestore) {
    await enqueueLocalSyncAction({
      entityType: 'sales',
      payload: transaction,
      businessId: effectiveUid,
      userId: effectiveUid,
      staffId: currentLoggedInStaffName || currentUser?.uid || 'system',
      updatedBy: currentUser?.uid || effectiveUid,
      deviceId: new URLSearchParams(window.location.search).get('device') || 'browser'
    });
  }

  if (navigator.onLine) {
    scheduleBackgroundSync();
  }

  renderTransactions();
  updateDashboard();

  // 4. Show notification for this transaction on current device immediately (offline & online support)
  if (transaction.date && !notifiedTransactions.has(transaction.date)) {
    notifiedTransactions.add(transaction.date);
    notifyTransaction(transaction, false);
  }
}

/**
 * Pushes transactions created while offline to the cloud sub-collection
 */
async function syncOfflineTransactions() {
  if (!navigator.onLine) return;
  if (!currentUser || !dbFirestore || !localRepositoryReady) return;
  await flushLocalSyncQueue();
  renderTransactions();
}

/**
 * Loads the latest transactions from the cloud collection
 */
async function loadTransactionsFromCloud(uid, startDate = null, endDate = null) {
  if (!dbFirestore) {
    console.warn("[TX_LOAD] Firestore not initialized, skipping cloud transaction load");
    return;
  }
  try {
    let txRef = collection(dbFirestore, "users", uid, "transactions");
    let q;

    if (startDate || endDate) {
      // Note: Range queries with OrderBy require a composite index in Firestore.
      // If you see an error in the console, click the provided link to create the index.
      const constraints = [orderBy("date", "desc")];
      if (startDate) constraints.push(where("date", ">=", startDate));
      if (endDate) constraints.push(where("date", "<=", endDate + "T23:59:59Z"));
      q = query(txRef, ...constraints);
    } else {
      // Increased limit from 200 to 1000 to ensure "last week" sales appear in Dashboard and Reports for busy shops
      q = query(txRef, orderBy("date", "desc"), limit(1000));
    }

    const snap = await getDocs(q);
    const cloudTransactions = [];
    snap.forEach(doc => {
      const data = doc.data();
      data.synced = true;
      cloudTransactions.push(data);
    });

    console.log("[TX_LOAD] Cloud query returned:", cloudTransactions.length, "transactions. Local had:", Array.isArray(transactions) ? transactions.length : 0);

    // Always process the result, even if empty, to ensure UI stays consistent
    if (cloudTransactions.length > 0 || (Array.isArray(transactions) && transactions.length > 0)) {
      // Merge cloud results with existing local transactions to build a complete local archive
      // We use the date ISO string as a unique identifier for deduplication
      // 1. Add current local transactions (preserving unsynced ones)
      const mergedTransactions = cloudTransactions.length > 0
        ? mergeTransactionsPreservingDuplicates(transactions, cloudTransactions.map(t => ({ ...t, synced: true })))
        : transactions;

      // 2. Keep a healthy local archive for offline reports
      transactions = deduplicateTransactions(mergedTransactions.slice(0, 1000));

      console.log("[TX_LOAD] After merge/dedup:", transactions.length, "transactions in memory");

      await saveState('transactions', transactions, { enqueueSync: false });
      renderTransactions();
      updateDashboard();
    } else {
      console.warn("[TX_LOAD] ⚠️ No transactions found in cloud or local storage");
      // Still render empty state to show dashboard
      if (typeof renderTransactions === 'function') renderTransactions();
      if (typeof updateDashboard === 'function') updateDashboard();
    }
  } catch (e) {
    console.error("[TX_LOAD] Error loading transactions from cloud:", e.code, e.message);
    // Still attempt to render what we have locally
    if (typeof renderTransactions === 'function') renderTransactions();
    if (typeof updateDashboard === 'function') updateDashboard();
  }
}

async function getPendingSyncSummary() {
  let queue = Array.isArray(pendingSyncQueue) ? pendingSyncQueue : [];

  try {
    if (localRepositoryReady && localRepository && typeof localRepository.getSyncQueue === 'function') {
      queue = await localRepository.getSyncQueue();
      pendingSyncQueue = queue;
    }
  } catch (error) {
    console.warn('[SYNC] Could not read local sync queue:', error);
  }

  const now = Date.now();

  const unsyncedTransactions = Array.isArray(transactions)
    ? transactions.filter(tx => tx && tx.synced !== true).length
    : 0;

  const retryItems = queue.filter(item =>
    item && (item.syncStatus === 'retry' || item.syncStatus === 'failed')
  );

  const retryNowCount = retryItems.filter(item => {
    const retryAt = item.nextRetryAt ? new Date(item.nextRetryAt).getTime() : 0;
    return !retryAt || !Number.isFinite(retryAt) || retryAt <= now;
  }).length;

  const retryLaterItems = retryItems.filter(item => {
    const retryAt = item.nextRetryAt ? new Date(item.nextRetryAt).getTime() : 0;
    return retryAt && Number.isFinite(retryAt) && retryAt > now;
  });

  const nextRetryAt = retryLaterItems
    .map(item => new Date(item.nextRetryAt).getTime())
    .filter(time => Number.isFinite(time))
    .sort((a, b) => a - b)[0] || null;

  const retryLaterCount = retryLaterItems.length;
  const pendingCount = calculatePendingSyncCount(queue, unsyncedTransactions);

  return {
    queue,
    pendingCount,
    retryCount: retryItems.length,
    retryNowCount,
    retryLaterCount,
    nextRetryAt,
    unsyncedTransactions
  };
}
async function renderSyncHealthPanel() {
  const summaryEl = document.getElementById('syncHealthSummary');
  const detailsEl = document.getElementById('syncHealthDetails');
  if (!summaryEl || !detailsEl) return;

  try {
    const summary = await getPendingSyncSummary();
    const queue = Array.isArray(summary.queue) ? summary.queue : [];
    const conflicts = Array.isArray(auditTrail)
      ? auditTrail.filter(event => event && event.type === 'sync_conflict_ignored').slice(-5).reverse()
      : [];

    summaryEl.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:8px;">
        <div><strong>${navigator.onLine ? 'Online' : 'Offline'}</strong><br><span>Connection</span></div>
        <div><strong>${summary.pendingCount}</strong><br><span>Pending</span></div>
        <div><strong>${summary.retryCount}</strong><br><span>Retry Items</span></div>
        <div><strong>${summary.unsyncedTransactions}</strong><br><span>Offline Sales</span></div>
      </div>
    `;

    const recentQueue = queue.slice(-6).reverse();
    const queueHtml = recentQueue.length
      ? recentQueue.map(item => `
          <div style="padding:6px 0; border-top:1px solid var(--border-color);">
            <strong>${item.entityType || 'sync item'}</strong>
            <span>${item.syncStatus || 'pending'}</span>
            ${item.lastError ? `<div style="color:#dc3545;">${item.lastError}</div>` : ''}
            ${item.nextRetryAt ? `<div>Retry: ${new Date(item.nextRetryAt).toLocaleString()}</div>` : ''}
          </div>
        `).join('')
      : '<div>No queued sync items.</div>';

    const conflictHtml = conflicts.length
      ? conflicts.map(event => `
          <div style="padding:6px 0; border-top:1px solid var(--border-color);">
            <strong>${event.details?.entityType || 'record'}</strong>
            <span>${event.details?.recordId || ''}</span>
            <div>Older incoming record ignored.</div>
          </div>
        `).join('')
      : '<div>No recent sync conflicts.</div>';

    detailsEl.innerHTML = `
      <div style="margin-top:10px;"><strong>Recent Queue</strong>${queueHtml}</div>
      <div style="margin-top:10px;"><strong>Recent Conflicts</strong>${conflictHtml}</div>
    `;
  } catch (error) {
    summaryEl.textContent = 'Could not read sync health.';
    detailsEl.textContent = error.message || String(error);
  }
}

function renderSyncStatus({ state, label, title, background, showBadge = true }) {
  const statusEl = document.getElementById('connectivity-status');
  const syncBadgeEl = document.getElementById('sync-badge');
  const syncBtn = document.getElementById('header-sync-status');

  if (statusEl) {
    const isSyncVisual = /syncing/i.test(String(title || '')) || state === '🔄' || isSyncing === true;
    if (isSyncVisual) {
      statusEl.innerHTML = '🟢';
      statusEl.title = title;
      statusEl.classList.add('sync-pulse');
    } else {
      statusEl.classList.remove('sync-pulse');
      statusEl.textContent = state;
      statusEl.title = title;
    }
  }

  if (syncBtn) {
    syncBtn.title = title;
    syncBtn.setAttribute('data-tooltip', title);
  }

  if (syncBadgeEl) {
    syncBadgeEl.textContent = label;
    syncBadgeEl.style.display = showBadge ? 'inline-flex' : 'none';
    syncBadgeEl.style.background = background;
  }
}

async function syncNow() {
  if (!currentUser) return alert("Please login to sync data to the cloud.");

  const statusEl = document.getElementById('connectivity-status');
  const syncBtn = document.getElementById('header-sync-status');

  if (statusEl) {
    statusEl.innerHTML = '<span class="spinner" style="width:14px; height:14px; border-width:2px; margin:0;"></span>';
  }
  if (syncBtn) syncBtn.disabled = true;

  try {
    if (!navigator.onLine) {
      await updateOnlineStatus();
      return alert("You are offline. Your changes are saved locally and will sync when internet returns.");
    }

    await saveData();
    const syncResults = await flushLocalSyncQueue({ force: true });
    const syncSummary = summarizeSyncResults(syncResults);

    if (syncSummary.failed > 0) {
      syncFailureCount += syncSummary.failed;
      alert(`${syncSummary.failed} sync item(s) could not upload. They will retry automatically.`);
    } else {
      syncFailureCount = 0;
    }
  } catch (e) {
    syncFailureCount++;
    alert("Sync failed: " + e.message);
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    await updateOnlineStatus();
  }
}

async function updateOnlineStatus() {
  const statusEl = document.getElementById('connectivity-status');
  if (!statusEl) return;

  if (navigator.onLine && !isSyncing) {
    await flushLocalSyncQueue({ force: true, skipStatusUpdate: true }).catch(error => {
      console.warn('[SYNC] Forced online queue flush failed:', error);
    });
  }

  const { pendingCount, retryCount, retryNowCount, retryLaterCount, nextRetryAt } = await getPendingSyncSummary();
  renderSyncHealthPanel().catch(console.warn);

  if (!navigator.onLine) {
    renderSyncStatus({
      state: '🔴',
      label: pendingCount > 0 ? `${pendingCount} Pending` : 'Offline',
      title: pendingCount > 0
        ? `Offline • ${pendingCount} change(s) saved locally and waiting to sync`
        : 'Offline • local mode',
      background: '#6b7280',
      showBadge: true
    });
    return;
  }

  if (isSyncing) {
    renderSyncStatus({
      state: '🟢',
      label: '',
      title: 'Online • syncing to cloud...',
      background: '#16a34a',
      showBadge: false
    });
    return;
  }

  if (pendingCount > 0) {
    renderSyncStatus({
      state: '🔄',
      label: '',
      title: `Online • syncing ${pendingCount} item(s) to cloud...`,
      background: '#f59e0b',
      showBadge: false
    });
    return;
  }

  renderSyncStatus({
    state: '🟢',
    label: '',
    title: 'Online & synced',
    background: '#16a34a',
    showBadge: false
  });
}

function setAppShellLocked(isLocked) {
  const layout = document.querySelector('.app-layout');
  const header = document.querySelector('header');

  if (layout) {
    layout.style.visibility = isLocked ? 'hidden' : 'visible';
    layout.style.pointerEvents = isLocked ? 'none' : '';
  }

  if (header) {
    header.style.visibility = isLocked ? 'hidden' : 'visible';
    header.style.pointerEvents = isLocked ? 'none' : '';
  }
}

function showLoggedOutScreen() {
  setAppShellLocked(true);
  updateAuthUI(null);
  showLoginOverlay();
}

function updateAuthUI(user) {
  // Remove existing auth container if any
  const existingAuth = document.getElementById('auth-header-container');
  if (existingAuth) existingAuth.remove();

  const authContainer = document.createElement('div');
  authContainer.id = 'auth-header-container';
  authContainer.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 0.8em; margin-left: 6px; flex-wrap: nowrap; overflow: hidden;';

  const subInfo = getSubscriptionInfo();
  const statusBadge = `<div class="header-status-badge" style="background: ${subInfo.color}; color: white; padding: 1px 6px; border-radius: 999px; font-size: 0.62em; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2); white-space: nowrap;">${subInfo.label}</div>`;

  if (user) {
    authContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; min-width: 0;">
          <div class="header-status-badge" style="background: ${subInfo.color}; color: white; padding: 1px 6px; border-radius: 999px; font-size: 0.62em; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2); white-space: nowrap;">${subInfo.label}</div>
          <img src="${user.photoURL || 'https://placehold.co/30'}" style="width: 28px; height: 28px; border-radius: 50%; border: 2px solid white; flex-shrink: 0;">
        </div>
      `;

    const nav = document.querySelector('nav');

    // App admin navigation is handled inside the app admin section itself.
    if (isAppAdminRole() && nav && !document.getElementById('nav-admin-settings')) {
      const settingsBtn = document.createElement('button');
      settingsBtn.id = 'nav-admin-settings';
      settingsBtn.onclick = () => { showTab('appAdminTab', settingsBtn); switchAppAdminView('settings'); };
      settingsBtn.innerHTML = `<span>⚙️</span><span>Admin Settings</span>`;

      const logoutBtn = document.getElementById('nav-logout-btn');
      if (logoutBtn) {
        nav.insertBefore(settingsBtn, logoutBtn);
      } else {
        nav.appendChild(settingsBtn);
      }
    }

    if (nav && !document.getElementById('nav-logout-btn')) {
      const logoutBtn = document.createElement('button');
      logoutBtn.id = 'nav-logout-btn';
      logoutBtn.setAttribute('onclick', 'logout()');
      logoutBtn.innerHTML = `<span>✕</span><span>Logout</span>`;
      nav.appendChild(logoutBtn);
    }

    // Check if user has completed the second stage (PIN)
    if (isPinVerified) {
      setAppShellLocked(false);
      const overlay = document.getElementById('login-overlay');
      if (overlay) overlay.style.display = 'none';
      const lockBtn = document.getElementById('nav-lock-btn');
      if (lockBtn) lockBtn.style.display = 'inline-block';
      applyRolePermissions();
    } else {
      setAppShellLocked(true);
      showLoginOverlay();
      const lockBtn = document.getElementById('nav-lock-btn');
      if (lockBtn) lockBtn.style.display = 'none';
      checkShopStatus();
    }
  } else {
    const navLogoutBtn = document.getElementById('nav-logout-btn');
    if (navLogoutBtn) navLogoutBtn.remove();

    authContainer.innerHTML = `
        <button onclick="login()" class="btn" style="margin: 0; background: white; color: var(--primary); font-size: 0.8em; padding: 5px 12px; display: flex; align-items: center; gap: 8px; border-radius: 4px; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 16px; height: 16px;">
          Login with Google
        </button>
      `;
    // Ensure login overlay is visible
    showLoginOverlay();
    const lockBtn = document.getElementById('nav-lock-btn');
    if (lockBtn) lockBtn.style.display = 'none';
  }
  const header = document.querySelector('header');
  if (header) {
    const headerActions = document.querySelector('.header-actions');
    if (headerActions) {
      const themeButton = document.getElementById('theme-toggle-header');
      if (themeButton) {
        headerActions.insertBefore(authContainer, themeButton);
      } else {
        headerActions.appendChild(authContainer);
      }
    } else if (document.getElementById('header-sync-status')) {
      header.insertBefore(authContainer, document.getElementById('header-sync-status'));
    } else {
      header.appendChild(authContainer);
    }
  }
}

function renderAdminPaymentMethodsChart(paymentMethodsTotals) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('adminPaymentMethodsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const entries = Object.entries(paymentMethodsTotals || {});
  const labels = entries.map(([k]) => k);
  const data = entries.map(([, v]) => v);

  if (adminPaymentMethodsChartInstance) adminPaymentMethodsChartInstance.destroy();

  adminPaymentMethodsChartInstance = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: ['#ff6b35','#3d5a80','#7dcdb8','#f7c59f','#98c1d9'] }] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      plugins: {
        title: { display: true, text: 'Payment Methods', font: { size: 14 } },
        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, font: { size: 12 } } },
        tooltip: { enabled: true }
      },
      elements: { arc: { borderColor: '#ffffff', borderWidth: 1 } },
      animation: { duration: 500 }
    }
  });
}

function renderAdminShopsStatusChart(statusCounts) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('adminShopsStatusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const entries = Object.entries(statusCounts || {});
  const labels = entries.map(([k]) => k);
  const data = entries.map(([, v]) => v);

  if (adminShopsStatusChartInstance) adminShopsStatusChartInstance.destroy();

  adminShopsStatusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: ['#3d5a80','#ff6b35','#f7c59f','#7dcdb8'] }] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      cutout: '40%',
      plugins: {
        title: { display: true, text: 'Shops by Status', font: { size: 14 } },
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: { enabled: true }
      },
      elements: { arc: { borderColor: '#ffffff', borderWidth: 1 } },
      animation: { duration: 500 }
    }
  });
}

function lockApp() {
  isPinVerified = false;
  clearPinSession();
  currentUserRole = null;
  currentUserPermissions = [];
  currentLoggedInStaffName = '';
  const statusOverlay = document.getElementById('shop-status-overlay');
  if (statusOverlay) {
    statusOverlay.style.display = 'none';
  }

  showLoginOverlay();
  const lockBtn = document.getElementById('nav-lock-btn');
  if (lockBtn) lockBtn.style.display = 'none';
}

async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  const btn = document.querySelector('#login-overlay button');
  const originalContent = btn ? btn.innerHTML : 'Login with Google';
  if (btn) btn.innerHTML = '<span class="spinner"></span> Signing in...';

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed:", error);
    await showAppAlert("Login failed: " + error.message, "Login Failed");
    if (btn) btn.innerHTML = originalContent;
    if (typeof showLoggedOutScreen === 'function') showLoggedOutScreen();
  }
}

async function loginWithEmail() {
  const email = document.getElementById('authEmail')?.value?.trim();
  const password = document.getElementById('authPassword')?.value?.trim();
  if (!email || !password) return alert("Please enter email and password.");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error('Email login failed:', error);
    const authError = getAuthErrorMessage(error);
    const isCredentialFailure = error?.code === 'auth/invalid-credential' || error?.code === 'auth/user-not-found' || error?.code === 'auth/wrong-password';
    const detail = isCredentialFailure
      ? `${authError.message}\n\nIf you already use Google for this account, click “Login with Google” instead. Otherwise, switch to Register to create a password-based account.`
      : authError.message;
    await showAppAlert(detail, authError.title);
    if (isCredentialFailure && typeof showLoginOverlay === 'function') {
      showLoginOverlay('register');
    }
    if (typeof showLoggedOutScreen === 'function') showLoggedOutScreen();
  }
}

async function registerWithEmail() {
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const nameInput = document.getElementById('authName');
  const whatsappInput = document.getElementById('authWhatsApp');
  const confirmInput = document.getElementById('authConfirmPassword');

  const email = emailInput?.value?.trim();
  const password = passwordInput?.value?.trim();
  const name = nameInput?.value?.trim();
  const whatsapp = whatsappInput?.value?.trim();
  const confirmPassword = confirmInput?.value?.trim();

  if (!email || !password) return alert("Please enter email and password.");
  if (nameInput && !name) return alert("Please enter your name.");
  if (whatsappInput && !whatsapp) return alert("Please enter your WhatsApp number starting with a country code.");
  if (whatsapp && !whatsapp.startsWith('+')) return alert("WhatsApp number must start with a country code (e.g., +256)."); //
  const phoneNumber = whatsapp.substring(1); // Remove the '+'
  if (phoneNumber.length < 7 || phoneNumber.length > 15) return alert("WhatsApp number (excluding country code) must be between 7 and 15 digits long.");
  if (confirmInput && password !== confirmPassword) return alert("Passwords do not match.");

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(password)) {
    return alert("Password must be at least 8 characters long, and include at least one uppercase letter, one lowercase letter, one number, and one special character.");
  }

  try {
    if (isAppAdminRestrictedIdentity({
      email,
      uid: auth.currentUser?.uid || '',
      configuredAdminEmails: getConfiguredAppAdminEmails(),
      masterAdminUid: MASTER_APP_ADMIN_UID
    })) {
      return alert("App administrator accounts cannot create or own shops.");
    }

    if (auth.currentUser) {
      // User is already signed in (e.g. Google), link email/pass so they can use either
      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(auth.currentUser, credential);
      // Update name if provided and not already set
      if (name && !auth.currentUser.displayName) {
        await updateProfile(auth.currentUser, { displayName: name });
      }
      alert("Email login successfully added to your account! You can now log in with either Google or this password.");
    } else {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(userCredential.user, { displayName: name });
      }

      // Save root user metadata using their UID as document ID
      await setDoc(doc(dbFirestore, "users", userCredential.user.uid), {
        whatsapp: whatsapp || null,
        name: name || null,
        email: email,
        status: 'pending',
        createdAt: new Date().toISOString()
      }, { merge: true });

      // Initialize the tenant's private shop profile under /users/{uid}/data/shop_profile
      await setDoc(doc(dbFirestore, "users", userCredential.user.uid, "data", "shop_profile"), {
        settings: { name: name || 'My Business' },
        menu: [],
        transactions: [],
        lastUpdated: new Date().toISOString()
      }, { merge: true });

      // Run tenant initialization locally (IndexedDB, caches)
      try { await setupTenantShopParameters(userCredential.user.uid); } catch (e) { console.warn('Tenant init warning', e); }

      alert("Registration successful! You are now logged in.");
    }
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      alert("This email is already registered. If you previously used Google, try logging in with Google first, then add a password.");
    } else {
      alert("Registration failed: " + error.message);
    }
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('authEmail').value || await showAppPrompt("Please enter your email address:", "Forgot Password", "Email");
  if (!email) return;

  try {
    await sendPasswordResetEmail(auth, email);
    await showAppAlert("Password reset email sent! Please check your inbox.", "Password Reset Sent");
  } catch (error) {
    alert("Error: " + error.message);
  }
}

let activeAuthAction = null;

function openAuthModal(action) {
  if (!currentUser) return alert("You must be logged in.");
  activeAuthAction = action;

  const modal = document.getElementById('authActionModal');
  const title = document.getElementById('authModalTitle');
  const desc = document.getElementById('authModalDescription');
  const curPass = document.getElementById('currentPasswordField');
  const newPass = document.getElementById('newPasswordFields');
  const submitBtn = document.getElementById('authModalSubmitBtn');

  // Reset fields
  document.getElementById('authCurrentPassword').value = '';
  document.getElementById('authNewPassword').value = '';
  document.getElementById('authConfirmNewPassword').value = '';

  const isEmailUser = currentUser.providerData.some(p => p.providerId === 'password');

  if (action === 'changePassword') {
    title.textContent = "Change Password";
    desc.textContent = "Enter your current password and a new secure password.";
    curPass.style.display = 'block';
    newPass.style.display = 'block';
  } else if (action === 'linkPassword') {
    title.textContent = "Create Email Login";
    desc.textContent = "Set a password to allow signing in with your email address in addition to Google.";
    curPass.style.display = 'none';
    newPass.style.display = 'block';
  } else if (action === 'deleteAccount') {
    title.textContent = "Delete Account";
    desc.textContent = "WARNING: This will permanently delete your account and all shop data. Please enter your password to confirm.";
    curPass.style.display = isEmailUser ? 'block' : 'none';
    newPass.style.display = 'none';
    if (!isEmailUser) desc.textContent = "WARNING: This will permanently delete your account and all shop data. Confirm with the button below.";
  }

  modal.style.display = 'flex';
}

function closeAuthModal() {
  document.getElementById('authActionModal').style.display = 'none';
  activeAuthAction = null;
}

let activeAppPopupResolver = null;
let activeAppPopupKeydown = null;

function closeAppPopup(result = { confirmed: false, value: null }) {
  const modal = document.getElementById('appPopupModal');
  const confirmBtn = document.getElementById('appPopupConfirm');
  const cancelBtn = document.getElementById('appPopupCancel');
  const inputWrapper = document.getElementById('appPopupInputWrapper');

  modal.style.display = 'none';
  document.body.style.overflow = '';

  confirmBtn.onclick = null;
  cancelBtn.onclick = null;
  modal.onclick = null;

  if (activeAppPopupKeydown) {
    document.removeEventListener('keydown', activeAppPopupKeydown);
    activeAppPopupKeydown = null;
  }

  if (activeAppPopupResolver) {
    activeAppPopupResolver(result);
    activeAppPopupResolver = null;
  }

  if (inputWrapper) {
    const inputEl = document.getElementById('appPopupInput');
    inputEl.value = '';
  }
}

function showAppPopup({ title = 'Confirm', message = '', confirmText = 'Confirm', cancelText = 'Cancel', showCancel = true, input = null, allowOutsideClose = true, icon = null, danger = false }) {
  const modal = document.getElementById('appPopupModal');
  const card = modal.querySelector('.app-popup-card');
  const titleEl = document.getElementById('appPopupTitle');
  const messageEl = document.getElementById('appPopupMessage');
  const inputWrapper = document.getElementById('appPopupInputWrapper');
  const inputEl = document.getElementById('appPopupInput');
  const confirmBtn = document.getElementById('appPopupConfirm');
  const cancelBtn = document.getElementById('appPopupCancel');
  const iconWrap = document.getElementById('appPopupIconWrap');
  const iconEl = document.getElementById('appPopupIcon');

  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  cancelBtn.style.display = showCancel ? 'inline-flex' : 'none';

  // Icon support
  if (icon && iconWrap && iconEl) {
    iconEl.textContent = icon;
    iconWrap.style.display = 'flex';
  } else if (iconWrap) {
    iconWrap.style.display = 'none';
  }

  // Danger variant
  if (card) {
    card.classList.toggle('danger', !!danger);
    if (danger) {
      confirmBtn.style.background = '#dc3545';
    } else {
      confirmBtn.style.background = '';
    }
  }

  if (input && input.enabled) {
    inputWrapper.style.display = 'block';
    inputEl.value = input.value || '';
    inputEl.type = input.type || 'text';
    inputEl.placeholder = input.placeholder || '';
    if (input.maxlength) inputEl.maxLength = input.maxlength;
    else inputEl.removeAttribute('maxlength');
    inputEl.autocomplete = input.autocomplete || 'off';
    setTimeout(() => inputEl.focus(), 50);
  } else {
    inputWrapper.style.display = 'none';
    inputEl.value = '';
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  return new Promise(resolve => {
    if (activeAppPopupResolver) {
      activeAppPopupResolver({ confirmed: false, value: null });
    }
    activeAppPopupResolver = resolve;

    const closePopup = (result) => {
      closeAppPopup(result);
    };

    const onConfirm = () => closePopup({ confirmed: true, value: inputWrapper.style.display === 'block' ? inputEl.value.trim() : null });
    const onCancel = () => closePopup({ confirmed: false, value: inputWrapper.style.display === 'block' ? inputEl.value.trim() : null });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') onConfirm();
    };

    confirmBtn.onclick = onConfirm;
    cancelBtn.onclick = onCancel;
    modal.onclick = (event) => {
      if (event.target === modal && allowOutsideClose) onCancel();
    };

    activeAppPopupKeydown = onKeyDown;
    document.addEventListener('keydown', onKeyDown);
  });
}

function showAppConfirm(message, title = 'Confirm', confirmText = 'Yes', cancelText = 'Cancel') {
  return showAppPopup({ title, message, confirmText, cancelText, showCancel: true, input: null });
}

function showAppPrompt(message, title = 'Enter value', placeholder = '', defaultValue = '') {
  return showAppPopup({
    title,
    message,
    confirmText: 'Submit',
    cancelText: 'Cancel',
    showCancel: true,
    input: { enabled: true, placeholder, value: defaultValue, type: 'text', maxlength: 1024 }
  }).then(result => result.confirmed ? result.value : null);
}

function showAppAlert(message, title = 'Notice') {
  return showAppPopup({ title, message, confirmText: 'OK', cancelText: 'Cancel', showCancel: false, input: null });
}

const nativeAlert = window.alert;
window.alert = function (message, title = 'Notice') {
  if (typeof showAppAlert === 'function') {
    void showAppAlert(message, title);
    return;
  }
  return nativeAlert.call(window, message);
};

async function submitAuthAction() {
  const curPassValue = document.getElementById('authCurrentPassword').value;
  const newPassValue = document.getElementById('authNewPassword').value;
  const confirmPassValue = document.getElementById('authConfirmNewPassword').value;

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  const isEmailUser = currentUser.providerData.some(p => p.providerId === 'password');

  const submitBtn = document.getElementById('authModalSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  try {
    if (activeAuthAction === 'changePassword' || (activeAuthAction === 'deleteAccount' && isEmailUser)) {
      if (!curPassValue) throw new Error("Please enter your current password.");
      const credential = EmailAuthProvider.credential(currentUser.email, curPassValue);
      await reauthenticateWithCredential(currentUser, credential);
    }

    if (activeAuthAction === 'changePassword' || activeAuthAction === 'linkPassword') {
      if (!passwordRegex.test(newPassValue)) throw new Error("New password must be at least 8 characters long, and include uppercase, lowercase, numbers, and symbols.");
      if (newPassValue !== confirmPassValue) throw new Error("New passwords do not match.");

      if (activeAuthAction === 'changePassword') {
        await updatePassword(currentUser, newPassValue);
        alert("Password updated successfully!");
      } else {
        const credential = EmailAuthProvider.credential(currentUser.email, newPassValue);
        await linkWithCredential(currentUser, credential);
        alert("Email login successfully added! You can now use either Google or this password.");
      }
    } else if (activeAuthAction === 'deleteAccount') {
      const confirmed = await showAppConfirm("FINAL WARNING: All your data will be lost. Are you absolutely sure?", 'Delete Account', 'Delete', 'Cancel');
      if (confirmed?.confirmed) {
        await deleteUser(currentUser);
        await showAppAlert("Account deleted.", 'Account Deleted');
        location.reload();
        return;
      }
    }

    closeAuthModal();
    loadSettings(); // Refresh UI
  } catch (error) {
    alert("Error: " + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm";
  }
}

// Expose these for the UI
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.submitAuthAction = submitAuthAction;
window.toggleCashPaymentFields = toggleCashPaymentFields;
window.onPaymentCustomerChange = onPaymentCustomerChange;
window.processBill = processBill;
window.finalizePayment = finalizePayment;
window.updateOrderCustomer = updateOrderCustomer;
window.toggleCustomerAdjustmentPanel = toggleCustomerAdjustmentPanel;
window.recordCustomerAdjustment = recordCustomerAdjustment;
window.showCustomerAdjustmentReceipt = showCustomerAdjustmentReceipt;
window.previewOrder = previewOrder;
window.createCustomerDebtInvoice = createCustomerDebtInvoice;
window.showInvoiceAdjustmentPrompt = showInvoiceAdjustmentPrompt;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;

async function handleChangePassword() {
  const isEmailUser = currentUser?.providerData.some(p => p.providerId === 'password');
  if (isEmailUser) {
    openAuthModal('changePassword');
  } else {
    alert("This account doesn't have a password. Use the 'Create Password' button instead.");
  }
}
async function logout() {
  isLoggingOut = true;
  isInitialLoadComplete = false;
  const shouldLogout = await showAppConfirm("Are you sure you want to log out?", "Logout", "Logout", "Cancel");
  if (!shouldLogout) return;

  try {
    appendAuditEvent('logout', { message: 'User logged out' });
    await persistAuditTrail();
    await saveData(false, { skipEnterpriseMirror: true });
  } catch (error) {
    console.warn('Logout save warning:', error);
  }

  sessionStorage.removeItem('currentUserRole');
  sessionStorage.removeItem('currentUserPermissions');
  sessionStorage.removeItem('isPinVerified');
  sessionStorage.removeItem('currentLoggedInStaffName');
  sessionStorage.removeItem('currentUserUid');
  clearPinSession();

  currentUser = null;
  userMetadata = null;
  currentUserRole = null;
  currentUserPermissions = [];
  isPinVerified = false;
  currentLoggedInStaffName = '';
  menu = [];
  activeOrders = {};
  transactions = [];
  staff = [];
  dishCategories = [];
  customers = [];
  units = [];
  restockHistory = [];
  settings = { ...defaultSettings };
  auditTrail = [];

  try {
    if (unsubscribeSync) {
      unsubscribeSync();
      unsubscribeSync = null;
    }

    if (unsubscribeTransactionsSync) {
      unsubscribeTransactionsSync();
      unsubscribeTransactionsSync = null;
    }

    if (localRepository) {
      await localRepository.close();
      localRepository = null;
    }

    repositoryService = null;
    cloudRepositoryService = null;
    localRepositoryReady = false;

    if (db) {
      db.close();
      db = null;
    }
  } catch (error) {
    console.warn('Logout cleanup warning:', error);
  }

  try {
    await signOut(auth);
  } catch (error) {
    console.warn('Firebase sign out warning:', error);
  }

  showLoggedOutScreen();
}

function updateItemUnit(itemIndex, newUnit) {
  if (menu[itemIndex]) {
    menu[itemIndex].unit = newUnit;
    saveData();
  }
}

async function refreshApp() {
  try {
    await saveData();
    location.reload();
  } catch (error) {
    console.error("Failed to save data before refresh:", error);
    const proceed = await showAppConfirm("Could not save data before refreshing. You may lose unsaved changes. Do you still want to refresh?", "Refresh App", "Continue", "Cancel");
    if (proceed) {
      location.reload();
    }
  }
}

function getCurrencySymbol() {
  return settings?.currency || '$';
}

function updateCurrencyDisplay() {
  const symbol = getCurrencySymbol();
  document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = symbol);
}

// ===== Tabs =====
function showTab(tabId, btn) {
  const hasFullAccess = isFullAccessRole();
  if (!hasFullAccess && !currentUserPermissions.includes(tabId)) {
    return showAppAlert("Access Denied: You do not have permission to open this section.", 'Access Denied');
  }

  document.querySelectorAll('section').forEach(sec => sec.classList.remove('active'));
  const activeSection = document.querySelector(`#${tabId}`);
  activeSection.classList.add('active');

  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  toggleNav(false); // Close nav after selection

  // Dynamically update navigation visibility based on role and active tab
  applyRolePermissions();

  // Special rendering logic for tabs
  switch (tabId) {
    case 'dashboardTab':
      initializeDashboardFilters();
      updateDashboard();
      break;
    case 'transactionsTab':
      renderTransactions();
      break;
    case 'menuTab':
      renderMenu();
      break;
    case 'addDishTab':
      renderDishesTable();
      break;
    case 'categoryTab':
      renderCategoryList();
      break;
    case 'unitTab':
      renderUnitList();
      break;
    case 'staffTab':
      renderStaffList();
      break;
    case 'customerTab':
      renderCustomerList();
      renderInvoices();
      break;
    case 'invoicesTab':
      renderInvoices();
      break;
    case 'settingsTab':
      loadSettings();
      renderSyncHealthPanel().catch(console.warn);
      break;
    case 'stockTab':
      renderInventoryReport(); // For the low stock report
      renderStockListTable(); // For the main stock table
      renderUnitList();
      renderRestockHistoryTable(); // For the main stock table
      break;
    case 'reportsTab':
      populateReportFilters();
      renderReport();
      break;
    case 'appAdminTab':
      initAppAdminDashboardLayout();
      // Default to dashboard if no specific admin button is active
      const activeBtn = document.querySelector('nav button.active');
      if (activeBtn && activeBtn.id === 'nav-admin-shops') switchAppAdminView('shops');
      else if (activeBtn && activeBtn.id === 'nav-admin-subscriptions') switchAppAdminView('subscriptions');
      else if (activeBtn && activeBtn.id === 'nav-admin-shops-list') switchAppAdminView('shops-table');
      else if (activeBtn && activeBtn.id === 'nav-admin-settings') switchAppAdminView('settings');
      else switchAppAdminView('dashboard');
      break;
  }
}

// ===== Navigation Toggle =====
function toggleNav(forceState) {
  const nav = document.querySelector('nav');
  if (typeof forceState === 'boolean') {
    nav.classList.toggle('open', forceState);
  } else {
    nav.classList.toggle('open');
  }
}

// ===== Menu =====
function renderMenu() {
  const container = document.getElementById('menuCategories');
  container.innerHTML = '';

  menu = normalizeProductCatalog(Array.isArray(menu) ? menu : []);
  const sellableMenu = getCanonicalProductCatalog(Array.isArray(menu) ? menu : [], { includeOnlySellable: true });
  const searchTerm = document.getElementById('menuSearch')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('categoryFilter')?.value || '';

  // Filter for the search term AND ensure the item is a sellable dish (has a recipe).
  // Also filter out items that don't have a category.
  const filteredMenu = sellableMenu.filter(dish => {
    const matchesSearch = dish && dish.category && (dish.name.toLowerCase().includes(searchTerm) || (dish.barcode && dish.barcode.toLowerCase().includes(searchTerm)));
    const isSellable = dish && ((dish.recipe && dish.recipe.length > 0) || (parseFloat(dish.price) > 0));
    const matchesCategory = categoryFilter === '' || (dish && dish.category === categoryFilter);
    return matchesSearch && matchesCategory && isSellable;
  });

  const categories = [...new Set(filteredMenu.map(d => d.category || "Uncategorized"))];

  categories.forEach(cat => {
    const catDiv = document.createElement('div');
    if (cat !== "Uncategorized") {
      catDiv.innerHTML = `<h4>${cat}</h4>`;
    }
    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    filteredMenu
      .filter(d => (d.category || "Uncategorized") === cat)
      .forEach((dish, i) => {
        const item = document.createElement('div');
        const currentOrder = activeOrders[CART_ID] || { items: [] };

        // Calculate available stock by subtracting what is already in all open carts
        const totalInCarts = Object.values(activeOrders)
          .flatMap(order => order.items || [])
          .filter(item => item.name === dish.name)
          .reduce((sum, item) => sum + item.qty, 0);

        const quantity = currentOrder.items.find(o => o.name === dish.name && !o.notes)?.qty || 0;
        const totalStock = calculateDishStock(dish, true);
        const availableStock = Math.max(0, totalStock - totalInCarts);
        const isOutOfStock = totalStock <= 0 || availableStock <= 0;

        let itemClasses = 'menu-item';
        if (totalInCarts > 0) itemClasses += ' active';
        if (isOutOfStock) itemClasses += ' out-of-stock';

        item.className = itemClasses;
        item.setAttribute('data-product-name', dish.name); // Added for surgical updates
        item.onclick = (e) => { // Allow adding item by clicking the card
          if (isOutOfStock) return alert("Item is out of stock.");
          if (e.target.closest('.item-controls')) return;
          addToOrder(CART_ID, dish.name);
        };

        // Use the dish image directly - do NOT append cache-busters to Firebase Storage
        // URLs because Storage URLs are HMAC-signed and extra params break them
        let displayImage = isValidMenuImage(dish.image) ? dish.image : getCachedDishImage(dish.name) || PLACEHOLDER_IMAGE;
        if (!isValidMenuImage(dish.image) && getCachedDishImage(dish.name)) {
          dish.image = getCachedDishImage(dish.name);
        }
        cacheDishImage(dish.name, dish.image);

        item.innerHTML = `
              <img src="${displayImage}" crossorigin="anonymous" alt="" onerror="this.src='https://placehold.co/100';">
              <div class="menu-item-body">
                <div class="menu-item-header">
                  <h4>${dish.name}</h4>
                  <p><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(dish.price)}</p>
                </div>
                <p class="stock-status ${isOutOfStock ? 'out-of-stock' : 'in-stock'}">Available: ${availableStock}</p>
                <div class="item-controls">
                  <button onclick="decreaseQty('${CART_ID}', '${dish.name}')" ${quantity === 0 ? 'disabled' : ''}>-</button>
                  <span class="qty-display">${quantity}</span>
                  <button onclick="addToOrder('${CART_ID}', '${dish.name}')" ${isOutOfStock ? 'disabled' : ''}>+</button>
                </div>
              </div>`;
        grid.appendChild(item);
        // Add runtime diagnostic for image loading failures
        try {
          const cardImg = item.querySelector('img');
          if (cardImg) {
            cardImg.crossOrigin = 'anonymous';
            cardImg.onerror = function () {
              console.warn('[IMG_LOAD_FAIL] ', dish.name, '->', cardImg.src);
              cardImg.src = 'https://placehold.co/100';
            };
          }
        } catch (e) { console.warn('Failed to attach img diagnostics', e); }
      });
    catDiv.appendChild(grid);
    container.appendChild(catDiv);
  });

  // Initial orders sync
  updateOrders(CART_ID, false);
}

/**
 * Lightly updates the existing menu cards without re-rendering the whole grid.
 * This prevents "shaking" and image reloads when adding/removing items from cart.
 */
function isValidMenuImage(image) {
  return typeof image === 'string' && image.trim() !== '' && image !== PLACEHOLDER_IMAGE;
}

function cacheDishImage(name, image) {
  if (name && isValidMenuImage(image)) {
    lastKnownDishImages[name] = image;
    persistImageCache().catch(() => { });
  }
}

function getCachedDishImage(name) {
  return lastKnownDishImages[name] || null;
}

function updateMenuUI() {
  const currentOrder = activeOrders[CART_ID] || { items: [] };
  const cards = document.querySelectorAll('.menu-item[data-product-name]');
  const localMenu = Array.isArray(menu) ? menu : [];

  cards.forEach(card => {
    const name = card.getAttribute('data-product-name');
    const dish = localMenu.find(d => d && d.name === name);
    if (!dish) return;

    // Surgically update the image if it changed. Do not overwrite existing images with placeholders.
    const img = card.querySelector('img');
    const expectedImg = isValidMenuImage(dish.image) ? dish.image : null;
    if (img && expectedImg && img.getAttribute('src') !== expectedImg) {
      try {
        img.crossOrigin = 'anonymous';
        img.onerror = function () { console.warn('[IMG_LOAD_FAIL]', name, '->', img.src); img.src = PLACEHOLDER_IMAGE; };
      } catch (e) { /* ignore */ }
      img.src = expectedImg;
      cacheDishImage(name, expectedImg);
      console.log('[IMG_UPDATE]', name, '->', expectedImg);
    }
    if (img && !isValidMenuImage(dish.image) && img.getAttribute('src') === PLACEHOLDER_IMAGE && !card.dataset.imgDebugged) {
      console.warn('[IMG_DEBUG] missing menu image for', name, 'menu.image=', dish.image, 'cached=', getCachedDishImage(name), 'card.src=', img.src);
      card.dataset.imgDebugged = '1';
    }

    // Surgically update the price if it changed
    const priceEl = card.querySelector('.menu-item-header p');
    const expectedPriceHtml = `<span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(dish.price)}`;
    const currentPriceText = priceEl ? priceEl.textContent.trim() : '';
    const expectedPriceText = `${settings.currency || '$'}${formatCurrency(dish.price)}`;
    if (priceEl && currentPriceText !== expectedPriceText) {
      priceEl.innerHTML = expectedPriceHtml;
    }

    const totalInCarts = Object.values(activeOrders)
      .flatMap(order => order.items || [])
      .filter(item => item.name === name)
      .reduce((sum, item) => sum + item.qty, 0);

    const quantity = currentOrder.items.find(o => o.name === name && !o.notes)?.qty || 0;
    const totalStock = calculateDishStock(dish, true);
    const availableStock = Math.max(0, totalStock - totalInCarts);
    const isOutOfStock = availableStock <= 0;

    card.classList.toggle('active', totalInCarts > 0);
    card.classList.toggle('out-of-stock', isOutOfStock);

    const stockEl = card.querySelector('.stock-status');
    if (stockEl) {
      stockEl.textContent = `Available: ${availableStock}`;
      stockEl.className = `stock-status ${isOutOfStock ? 'out-of-stock' : 'in-stock'}`;
    }

    const qtyEl = card.querySelector('.qty-display');
    if (qtyEl) qtyEl.textContent = quantity;
    // Synchronize button disabled states so they update without a refresh
    const minusBtn = card.querySelector('.item-controls button:first-child');
    if (minusBtn) minusBtn.disabled = (quantity === 0);

    const plusBtn = card.querySelector('.item-controls button:last-child');
    if (plusBtn) plusBtn.disabled = isOutOfStock;
  });
}

async function addDish(buttonElement) {
  const name = document.getElementById('dishName').value.trim();
  const barcode = document.getElementById('dishBarcode').value.trim();
  const category = document.getElementById('dishCategory').value;
  const imageInput = document.getElementById('dishImage');

  if (!name) {
    return alert("Please enter a valid name.");
  }

  if (!category) {
    return alert("Please select a category for the dish.");
  }

  if (buttonElement) {
    buttonElement.disabled = true;
    buttonElement.textContent = 'Processing...';
  }

  const dishIndexInput = document.getElementById('dishIndex').value;
  const isUpdate = dishIndexInput !== '';
  const existingDish = isUpdate ? menu[parseInt(dishIndexInput, 10)] : null;
  const oldName = existingDish ? existingDish.name : null;

  let totalRecipeCost = 0;
  const recipe = Array.from(document.querySelectorAll('#recipeItemsContainer .recipe-item')).map(itemDiv => {
    totalRecipeCost += parseFloat(itemDiv.dataset.cost) || 0;
    return {
      itemName: itemDiv.dataset.itemName,
      quantity: parseFloat(itemDiv.dataset.quantity)
    };
  });

  const costPrice = totalRecipeCost;
  const price = parseFloat(document.getElementById('dishSellingPrice').value) || 0;

  try {
    let image = document.getElementById('dishImageBase64').value || null;
    const dishIndex = document.getElementById('dishIndex').value;

    // If image is local Base64, upload to Fire Storage
    if (typeof image === 'string' && image.startsWith('data:image')) {
      image = await uploadImage(image, `dishes/${Date.now()}.jpg`);
    }

    if (dishIndex !== '') {
      // It's an update
      const index = parseInt(dishIndex, 10);
      const oldName = menu[index].name;
      const oldImage = menu[index].image;

      if (oldImage && oldImage !== image && image.startsWith('http')) {
        clearImageFromCache(oldImage);
      }

      // Preserve existing fields not managed by this form (like physical stock and units)
      const imageToSave = isValidMenuImage(image) ? image : menu[index].image;
      let dishData = enrichEnterpriseRecord('products', {
        ...menu[index],
        name, barcode, category, recipe, costPrice, price, image: imageToSave
      }, menu[index]);

      menu[index] = dishData;
      enqueueEnterpriseRecordChange('products', dishData, 'upsert').catch(console.warn);


      // Propagate name change to other product recipes if this dish is used as a sub-component
      if (oldName && oldName !== name) {
        menu.forEach(d => {
          if (d.recipe) {
            d.recipe.forEach(c => { if (c.itemName === oldName) c.itemName = name; });
          }
        });
      }

      // Update active orders immediately to sync name, price, and details
      Object.keys(activeOrders).forEach(cartId => {
        if (activeOrders[cartId].items) {
          activeOrders[cartId].items.forEach(item => {
            if (item.name === oldName) {
              item.name = name;
              item.price = price;
              item.costPrice = costPrice;
              item.image = isValidMenuImage(image) ? image : item.image;
            }
          });
        }
      });

    } else {
      // It's a new dish
      const existingMatchIndex = getProductCatalogMatchIndex(name, barcode);
      const dishData = enrichEnterpriseRecord('products', {
        name,
        barcode,
        category,
        recipe,
        costPrice,
        price,
        image: isValidMenuImage(image) ? image : undefined
      });

      if (existingMatchIndex >= 0) {
        const existingItem = menu[existingMatchIndex];
        const mergedDish = mergeProductRecord(existingItem || {}, dishData);
        menu[existingMatchIndex] = mergedDish;
        enqueueEnterpriseRecordChange('products', mergedDish, 'upsert').catch(console.warn);
      } else {
        // Clear form only for new dishes
        document.getElementById('dishName').value = '';
        document.getElementById('dishBarcode').value = '';
        imageInput.value = ''; // Reset file input
        menu.push(dishData);
        enqueueEnterpriseRecordChange('products', dishData, 'upsert').catch(console.warn);
      }
    }

    // Force update all orders to sync new prices/details
    Object.keys(activeOrders).forEach(cartId => updateOrders(cartId));

    renderMenu();
    renderDishesTable(); // Update the dishes list
    updateDashboard();
    saveData(); // Ensure changes are saved
    toggleAddDishForm(false); // Hide form on save
  } catch (error) {
    console.error("Error adding dish:", error);
    alert("Failed to save dish: " + error.message);
  } finally {
    if (buttonElement) {
      buttonElement.disabled = false;
      const dishIndex = document.getElementById('dishIndex').value;
      buttonElement.textContent = dishIndex !== '' ? 'Update' : 'Save'; // Restore original text
    }
  }
}

function generateRandomBarcode() {
  // Redirect to the smart generation logic instead of random numbers
  generateAutoBarcode(true);
}

function editDish(index) {

  const dish = menu[index];
  document.getElementById('dishIndex').value = index;
  document.getElementById('dishName').value = dish.name;
  document.getElementById('dishBarcode').value = dish.barcode || '';
  document.getElementById('dishCategory').value = dish.category;

  document.getElementById('dishImageBase64').value = isValidMenuImage(dish.image) ? dish.image : ''; // Store current image
  document.getElementById('dishImagePreview').src = isValidMenuImage(dish.image) ? dish.image : PLACEHOLDER_IMAGE; // Show current image in preview
  document.getElementById('dishSellingPrice').value = (dish.price || 0);

  // Show the form first to ensure all elements are visible and ready.
  toggleAddDishForm(true);
  document.getElementById('recipeItemsContainer').innerHTML = '';

  // Now that the form is visible and dropdowns are populated, set the category.
  document.getElementById('dishCategory').value = dish.category;

  // Populate recipe builder
  const recipeContainer = document.getElementById('recipeItemsContainer');
  if (dish.recipe) {
    dish.recipe.forEach(recipeComponent => {
      addRecipeItem(recipeComponent.itemName, recipeComponent.quantity);
    });
  }
  updateRecipeTotals();

  // If the edit button was clicked from the settings tab, switch to the dishes tab
  const settingsTab = document.getElementById('settingsTab');
  if (settingsTab.classList.contains('active')) {
    showTab('addDishTab', document.querySelector('nav button[onclick*="addDishTab"]'));
  }
}

function addRecipeItem(selectedItem, quantity) {
  const ingredient = menu.find(item => item.name === selectedItem);
  if (!ingredient) return;

  const currentStock = calculateDishStock(ingredient, true);
  if (currentStock <= 0) {
    alert(`"${ingredient.name}" is out of stock. Please add this item to your stock before using it in a recipe.`);
    return;
  }

  const unitCost = calculateDishCost(ingredient);

  const container = document.getElementById('recipeItemsContainer');
  const itemDiv = document.createElement('div');
  itemDiv.className = 'recipe-item';
  itemDiv.dataset.itemName = selectedItem;
  itemDiv.dataset.quantity = quantity;
  itemDiv.dataset.cost = unitCost * quantity;

  const removeBtn = document.createElement('button');
  removeBtn.innerHTML = '&times;';
  removeBtn.onclick = () => {
    itemDiv.remove();
    updateRecipeTotals();
  };

  itemDiv.innerHTML = `<span class="u-flex-grow-1">${quantity} x ${selectedItem}</span>
                         <span><span class="currency-symbol">${getCurrencySymbol()}</span>${formatCurrency(unitCost * quantity)}</span>`;
  itemDiv.appendChild(removeBtn);
  container.appendChild(itemDiv);
}

function addNewRecipeItemFromForm() {
  const select = document.getElementById('newRecipeItemSelect');
  const qtyInput = document.getElementById('newRecipeItemQty');
  const itemName = select.value;
  const quantity = parseFloat(qtyInput.value);

  if (itemName && !isNaN(quantity) && quantity > 0) {
    addRecipeItem(itemName, quantity);
    updateRecipeTotals();
  }
}

function updateRecipeItemUnit() {
  const select = document.getElementById('newRecipeItemSelect');
  const unitInput = document.getElementById('newRecipeItemUnit');
  const selectedIngredientName = select.value;
  const ingredient = menu.find(item => item.name === selectedIngredientName);
  unitInput.value = ingredient ? (ingredient.unit || 'N/A') : '';
}

function updateRecipeTotals() {
  const recipeItems = document.querySelectorAll('#recipeItemsContainer .recipe-item');
  let totalCost = 0;
  recipeItems.forEach(item => {
    totalCost += parseFloat(item.dataset.cost) || 0;
  });

  document.getElementById('dishCostPrice').value = formatCurrency(totalCost);

  const sellingPrice = parseFloat(document.getElementById('dishSellingPrice').value) || 0;
  const profitValue = sellingPrice - totalCost;
  const profitMargin = sellingPrice > 0 ? (profitValue / sellingPrice) * 100 : 0;

  document.getElementById('dishProfitValue').textContent = formatCurrency(profitValue); // Currency, so formatCurrency is fine
  document.getElementById('dishProfitMargin').textContent = profitMargin.toLocaleString(undefined, { maximumFractionDigits: 1 }); // Percentage, max 1 decimal
}

function calculateDishCost(dish, visited = new Set()) {
  if (!dish) return 0;
  if (visited.has(dish.name)) return parseFloat(dish.costPrice) || 0;
  visited.add(dish.name);

  if (!dish.recipe || dish.recipe.length === 0) {
    return parseFloat(dish.costPrice) || 0;
  }

  return dish.recipe.reduce((total, component) => {
    const componentItem = menu.find(d => d.name === component.itemName);
    const unitCost = componentItem ? calculateDishCost(componentItem, new Set(visited)) : 0;
    return total + (unitCost * component.quantity);
  }, 0);
}

function populateRecipeIngredientSelect() {
  const select = document.getElementById('newRecipeItemSelect');
  const ingredients = menu.filter(item => !item.recipe && item.stock > 0); // Only show raw ingredients with stock
  select.innerHTML = ingredients.map(item => `<option value="${item.name}">${item.name} (Stock: ${Number(item.stock).toFixed(1)})</option>`).join('');
}


// Helper to convert file to Base64 with resizing
const toBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = event => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = () => {
      const elem = document.createElement('canvas');
      const maxWidth = 800; // Resize to max 800px to save space and memory
      const maxHeight = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }
      elem.width = width;
      elem.height = height;
      const ctx = elem.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(elem.toDataURL('image/jpeg', 0.7)); // Compress to JPEG 70%
    };
    img.onerror = error => reject(new Error("Failed to process image data."));
  };
  reader.onerror = error => reject(new Error("File reading failed. Please check app permissions."));
});

function sanitizeLogoUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.includes('${')) return null; // Prevent template placeholder leakage
  if (/^(data:|https?:|\/|\.\/|\.\.)/i.test(trimmed)) return trimmed;
  return null;
}

function previewDishImage(input) {
  const preview = document.getElementById('dishImagePreview');
  const hiddenInput = document.getElementById('dishImageBase64');
  if (input.files && input.files[0]) {
    // Use the robust toBase64 function for preview as well
    toBase64(input.files[0]).then(base64 => {
      preview.src = base64;
      hiddenInput.value = base64; // Save base64 immediately to avoid re-reading file
    }).catch(e => {
      console.error(e);
      alert("Could not preview image: " + e.message);
      input.value = ''; // Clear input
      preview.src = 'https://placehold.co/100';
    });
  } else {
    preview.src = 'https://placehold.co/100';
  }
}
function toggleAddDishForm(show) {
  const formContainer = document.getElementById('addDishFormContainer');
  const toggleButton = document.querySelector('#addDishTab h3 button');
  if (show) {
    formContainer.style.display = 'block';
    document.getElementById('recipeItemsContainer').innerHTML = ''; // Clear existing recipe items for a fresh start
    populateRecipeIngredientSelect();
    updateRecipeItemUnit();
    populateCategoryDropdown();
    populateStockNameList();
    toggleButton.style.display = 'none';
  } else {
    document.getElementById('dishIndex').value = ''; // Clear index on hide
    formContainer.style.display = 'none';
    toggleButton.style.display = 'inline-block';
    document.getElementById('recipeItemsContainer').innerHTML = ''; // Clear recipe on close
    document.getElementById('dishName').value = '';
    document.getElementById('dishBarcode').value = '';
    document.getElementById('dishImagePreview').src = 'https://placehold.co/100';
    document.getElementById('dishImageBase64').value = '';
    document.getElementById('dishSellingPrice').value = '';
  }
}

function populateStockNameList() {
  const datalist = document.getElementById('stockNameList');
  if (!datalist) return;
  datalist.innerHTML = '';
  const stockItems = menu.filter(item => item.stock !== undefined);
  stockItems.forEach(item => {
    const option = document.createElement('option');
    option.value = item.name;
    datalist.appendChild(option);
  });
}

function formatCurrency(number) {
  const num = parseFloat(number) || 0;
  // Using toLocaleString to automatically add thousand separators and limit to 1 decimal place
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

// ===== Bill Splitting (New Implementation) =====
let splitState = { unassigned: [], bills: [] };

function openBillSplitModal() {
  const currentOrder = activeOrders[CART_ID];
  if (!currentOrder || currentOrder.items.length === 0) {
    return alert("No active order to split.");
  }
  document.getElementById('splitBillTableId').textContent = "Current Order";

  // Initialize split state from the current order
  splitState.unassigned = JSON.parse(JSON.stringify(currentOrder.items)); // Deep copy
  splitState.bills = [];

  renderSplitBillUI();
  document.getElementById('billSplitModal').style.display = 'flex';
}

function closeSplitBillModal() {
  document.getElementById('billSplitModal').style.display = 'none';
  // Clear state to avoid issues on next open
  splitState = { unassigned: [], bills: [] };
}

function renderSplitBillUI() {
  const unassignedContainer = document.getElementById('unassignedItems');
  const splitBillsContainer = document.getElementById('splitBillsContainer');
  unassignedContainer.innerHTML = '';
  splitBillsContainer.innerHTML = '';

  // Render unassigned items
  splitState.unassigned.forEach((item, index) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'split-item';
    itemEl.innerHTML = `<span>${item.qty}x ${item.name}</span><span><span class="currency-symbol">${getCurrencySymbol()}</span>${formatCurrency(item.price * item.qty)}</span>`;
    itemEl.onclick = () => moveItemToFirstBill(index);
    unassignedContainer.appendChild(itemEl);
  });

  // Render split bills
  splitState.bills.forEach((bill, billIndex) => {
    const billBox = document.createElement('div');
    billBox.className = 'split-bill-box';
    let billTotal = 0;

    let itemsHtml = bill.items.map((item, itemIndex) => {
      billTotal += item.price * item.qty;
      return `<div class="split-item" onclick="moveItemToUnassigned(${billIndex}, ${itemIndex})">
                  <span>${item.qty}x ${item.name}</span>
                  <span><span class="currency-symbol">${getCurrencySymbol()}</span>${formatCurrency(item.price * item.qty)}</span>
                </div>`;
    }).join('');

    billBox.innerHTML = `
        <h5 style="margin-top: 0; display: flex; justify-content: space-between;">
          <span>Person ${billIndex + 1}</span>
          <button class="icon-btn" onclick="removeSplitBill(${billIndex})" title="Remove Bill" style="font-size: 14px;">✖</button>
        </h5>
        <div style="display: flex; flex-direction: column; gap: 8px; flex-grow: 1;">${itemsHtml}</div>
        <div class="total" style="margin-top: 10px;">Total: <span class="currency-symbol">${getCurrencySymbol()}</span>${formatCurrency(billTotal)}</div>
      `;
    splitBillsContainer.appendChild(billBox);
  });

  document.getElementById('processSplitBtn').disabled = splitState.unassigned.length > 0 || splitState.bills.length === 0;
  updateCurrencyDisplay();
}

function addSplitBill() {
  splitState.bills.push({ items: [] });
  renderSplitBillUI();
}

function removeSplitBill(billIndex) {
  const bill = splitState.bills[billIndex];
  // Move all items from this bill back to unassigned
  splitState.unassigned.push(...bill.items);
  splitState.bills.splice(billIndex, 1);
  renderSplitBillUI();
}

function moveItemToFirstBill(itemIndex) {
  if (splitState.bills.length === 0) {
    addSplitBill(); // Auto-create the first bill if none exist
  }
  const item = splitState.unassigned.splice(itemIndex, 1)[0];
  splitState.bills[0].items.push(item);
  renderSplitBillUI();
}

function moveItemToUnassigned(billIndex, itemIndex) {
  const item = splitState.bills[billIndex].items.splice(itemIndex, 1)[0];
  splitState.unassigned.push(item);
  renderSplitBillUI();
}

async function processSplitPayments() {
  if (splitState.unassigned.length > 0) {
    return alert("Please assign all items before processing payments.");
  }

  const serverName = getCurrentServerName();
  closeSplitBillModal();

  for (let i = 0; i < splitState.bills.length; i++) {
    const bill = splitState.bills[i];
    const billTotal = calculateTransactionTotals(bill.items).total;

    // Use a promise to wait for each payment to be confirmed
    const paymentConfirmed = await new Promise(resolve => {
      document.getElementById('paymentTotalDue').textContent = formatCurrency(billTotal);
      document.getElementById('paymentModal').style.display = 'flex';
      document.querySelector('#paymentModal h3').textContent = `Payment for Person ${i + 1} / ${splitState.bills.length}`;
      toggleCashPaymentFields();
      calculateChange();

      document.getElementById('confirmPaymentBtn').onclick = () => resolve(true);
      document.querySelector('#paymentModal button[onclick*="Cancel"]').onclick = () => resolve(false);
    });

    if (paymentConfirmed) {
      const paymentMethod = document.getElementById('paymentMethod').value;
      const transaction = { date: new Date().toISOString(), customerName: serverName, tableNo: 'Shop', items: bill.items, total: billTotal, paymentMethod: paymentMethod };
      await recordTransaction(transaction); // Use individual record helper
      bill.items.forEach(item => deductStock(item.name, item.qty));
      document.getElementById('paymentModal').style.display = 'none';
    } else {
      await showAppAlert("Payment cancelled. Remaining split bills will not be processed.", "Payment Cancelled");
      await saveData(); // Save any payments that were processed
      return; // Exit the loop
    }
  }

  // All payments processed, clear the original order
  delete activeOrders[CART_ID];
  await saveData();
  renderMenu();
  updateDashboard();

  // Calculate total of all split payments processed successfully
  const totalProcessed = splitState.bills.reduce((sum, bill) => sum + calculateTransactionTotals(bill.items).total, 0);
  const summaryTransaction = {
    date: new Date().toISOString(),
    customerName: serverName,
    tableNo: 'Shop (Split)',
    items: splitState.bills.flatMap(b => b.items),
    total: totalProcessed,
    paymentMethod: 'Split Payments'
  };
  showSaleSuccessCelebration(summaryTransaction, 0);
}

// ===== Orders =====
async function addToOrder(cartId, name, notes = null) {
  if (!activeOrders[cartId]) {
    activeOrders[cartId] = { items: [], server: '' };
  }

  const dish = menu.find(d => d.name === name);
  if (!dish) {
    await showAppAlert("Item not found.", "Error");
    return;
  }

  // Check current availability across all open carts
  const totalStock = calculateDishStock(dish, true);
  const totalInCarts = Object.values(activeOrders)
    .flatMap(order => order.items || [])
    .filter(item => item.name === name)
    .reduce((sum, item) => sum + item.qty, 0);

  if (totalInCarts + 1 > totalStock) {
    await showAppAlert(`Cannot add more "${name}". Only ${totalStock} units available in stock, and ${totalInCarts} are already in carts.`, "Out of Stock");
    return;
  }

  // If notes are being added, we always create a new item.
  if (notes !== null) {
    const note = await showAppPrompt(`Add special requests for ${name}:`, "Special Request", "Enter special requests...");
    if (note !== null) { // prompt not cancelled
      // Add as a new line item with a unique ID
      activeOrders[cartId].items.push({ ...dish, qty: 1, notes: note, id: Date.now() });
      updateOrders(cartId);
      updateMenuUI();
      playQtyChangeSound(true);
    }
    return;
  }

  const existing = activeOrders[cartId].items.find(o => o.name === name && !o.notes);
  if (existing) existing.qty++;
  else activeOrders[cartId].items.push({ ...dish, qty: 1 });

  updateOrders(cartId);
  updateMenuUI(); // Surgically update the UI instead of full render
  playQtyChangeSound(true);
}

function decreaseQty(cartId, name, id = null) {
  if (!activeOrders[cartId]) return;

  const orderItem = id ? activeOrders[cartId].items.find(o => o.id === id) : activeOrders[cartId].items.find(o => o.name === name && !o.notes);
  if (!orderItem) return;

  if (orderItem.qty > 1) {
    orderItem.qty--;
  } else {
    const itemIndex = activeOrders[cartId].items.findIndex(o => (id ? o.id === id : (o.name === name && !o.notes)));
    if (itemIndex > -1) activeOrders[cartId].items.splice(itemIndex, 1);
  }
  updateOrders(cartId);
  updateMenuUI(); // Surgically update the UI instead of full render
  playQtyChangeSound(false);
}

// ===== Tables =====
function updateOrders(cartId, shouldSave = true) {
  const currentOrder = activeOrders[cartId] || { items: [] };

  // Sync prices with current menu to ensure accuracy
  if (currentOrder.items && currentOrder.items.length > 0) {
    currentOrder.items.forEach(orderItem => {
      const dish = menu.find(d => d.name === orderItem.name);
      if (dish) {
        orderItem.price = parseFloat(dish.price) || 0;
        orderItem.costPrice = parseFloat(dish.costPrice) || 0;
      }
    });
  }

  const totals = calculateTransactionTotals(currentOrder.items);
  document.getElementById('menuTotal').textContent = formatCurrency(totals.total);

  // Update Preview and Checkout buttons to icons
  const previewBtn = document.querySelector('button[onclick*="previewOrder()"]');
  if (previewBtn) {
    previewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/></svg>`;
    previewBtn.removeAttribute('title');
  }
  const checkoutBtn = document.querySelector('button[onclick*="processBill()"]');
  if (checkoutBtn) {
    checkoutBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v1h14V4a1 1 0 0 0-1-1H2zm13 4H1v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7z"/><path d="M2 10a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1z"/></svg>`;
    checkoutBtn.removeAttribute('title');
  }
  const clearBtn = document.querySelector('button[onclick*="clearCurrentOrder()"]');
  if (clearBtn) {
    clearBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>`;
    clearBtn.removeAttribute('title');
  }

  if (shouldSave) {
    saveData();
    updateDashboard(); // Add this line to update dashboard cards in real-time
  }
}

async function clearCurrentOrder() {
  const currentOrder = activeOrders[CART_ID];
  if (!currentOrder || currentOrder.items.length === 0) {
    return showAppAlert("There is no active order to clear.", "Nothing to Clear");
  }
  const itemCount = currentOrder.items.reduce((sum, i) => sum + i.qty, 0);
  const result = await showAppPopup({
    title: 'Clear Order?',
    message: `You have ${itemCount} item${itemCount !== 1 ? 's' : ''} in your current order.\n\nThis action cannot be undone.`,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    showCancel: true,
    allowOutsideClose: true,
    icon: '🗑️',
    danger: true
  });
  if (result.confirmed) {
    delete activeOrders[CART_ID];
    updateOrders(CART_ID);
    updateMenuUI();
  }
}

function setPaymentProcessingState(isProcessing, message = '', tone = 'info') {
  const confirmBtn = document.getElementById('confirmPaymentBtn');
  const statusEl = document.getElementById('paymentStatusMessage');
  if (confirmBtn) {
    confirmBtn.disabled = isProcessing;
    if (isProcessing) {
      const originalText = confirmBtn.dataset.originalText || confirmBtn.textContent;
      confirmBtn.dataset.originalText = originalText;
      confirmBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></span> Processing...';
    } else {
      confirmBtn.innerHTML = confirmBtn.dataset.originalText || 'Confirm Payment';
    }
  }
  if (statusEl) {
    if (message) {
      statusEl.textContent = message;
      statusEl.style.display = 'block';
      statusEl.style.background = tone === 'success' ? '#e8f8ee' : tone === 'error' ? '#fde8e8' : '#f4f7fb';
      statusEl.style.color = tone === 'success' ? '#166534' : tone === 'error' ? '#b91c1c' : '#334155';
    } else {
      statusEl.textContent = '';
      statusEl.style.display = 'none';
    }
  }
}

function processBill() { // This now opens the payment modal
  const currentOrder = activeOrders[CART_ID];
  if (!currentOrder || currentOrder.items.length === 0) {
    return alert("Cannot checkout an empty order.");
  }
  const totals = calculateTransactionTotals(currentOrder.items);

  document.getElementById('paymentSubtotal').textContent = formatCurrency(totals.subtotal);
  document.getElementById('paymentTax').textContent = formatCurrency(totals.tax);
  document.getElementById('paymentDiscountDisplay').textContent = "0.00";

  const totalDueEl = document.getElementById('paymentTotalDue');
  totalDueEl.textContent = formatCurrency(totals.total);
  totalDueEl.dataset.originalTotal = totals.total;
  totalDueEl.dataset.currentTotal = totals.total;

  document.getElementById('discountInput').value = '';
  document.getElementById('amountTendered').value = '';
  document.getElementById('changeDue').textContent = '0.00';

  // Pre-populate customer selection in payment modal from the Shop tab dropdown
  const orderCustomerSelect = document.getElementById('orderCustomerSelect');
  const paymentCustomerSelect = document.getElementById('paymentCustomerSelect');
  if (orderCustomerSelect && paymentCustomerSelect) {
    paymentCustomerSelect.value = orderCustomerSelect.value;
  }

  document.getElementById('splitPaymentContainer').style.display = 'none'; // Hide split view
  document.getElementById('paymentDetails').style.display = 'block'; // Show single payment view
  document.getElementById('confirmPaymentBtn').onclick = () => handleConfirmPaymentClick(); // Set correct handler
  document.getElementById('paymentModal').style.display = 'flex';
  
  // Call onPaymentCustomerChange to update balance display, Amount Paid default, etc.
  onPaymentCustomerChange();

  setPaymentProcessingState(false, 'Review the total and confirm payment.', 'info');
  toggleCashPaymentFields(); // Initialize view based on default selection
  calculateChange(); // Initialize change calculation
}

async function handleConfirmPaymentClick() {
  const paymentSelect = document.getElementById('paymentCustomerSelect');
  const isCustomerSelected = paymentSelect && paymentSelect.value !== '';
  const tenderedInput = document.getElementById('amountTendered');
  const amountTendered = parseFloat(tenderedInput?.value) || 0;
  const currentOrder = activeOrders[CART_ID];
  const totals = currentOrder && Array.isArray(currentOrder.items) ? calculateTransactionTotals(currentOrder.items) : { total: 0 };

  const discountInput = parseFloat(document.getElementById('discountInput').value) || 0;
  let discountAmount = discountInput;
  if (discountAmount > totals.total) discountAmount = totals.total;
  if (discountAmount < 0) discountAmount = 0;
  const finalTotal = totals.total - discountAmount;

  const canConfirm = isCustomerSelected || (tenderedInput && tenderedInput.value !== '' && amountTendered >= finalTotal);
  if (!canConfirm) {
    await showAppAlert(`Amount is low. Select a customer for credit or enter at least ${formatCurrency(finalTotal)}.`, 'Amount Below Total');
    return;
  }

  await finalizePayment();
}

function updatePaymentTotals() {
  const totalDueEl = document.getElementById('paymentTotalDue');
  const originalTotal = parseFloat(totalDueEl.dataset.originalTotal) || 0;
  const discountInput = parseFloat(document.getElementById('discountInput').value) || 0;

  let discountAmount = discountInput;

  if (discountAmount > originalTotal) discountAmount = originalTotal;
  if (discountAmount < 0) discountAmount = 0;

  document.getElementById('paymentDiscountDisplay').textContent = formatCurrency(discountAmount);

  const newTotal = originalTotal - discountAmount;
  totalDueEl.textContent = formatCurrency(newTotal);
  totalDueEl.dataset.currentTotal = newTotal;

  const paymentSelect = document.getElementById('paymentCustomerSelect');
  const isCustomerSelected = paymentSelect && paymentSelect.value !== '';
  const remainingBalanceEl = document.getElementById('paymentRemainingBalanceVal');
  const remainingBalanceRow = document.getElementById('paymentRemainingBalanceRow');
  const confirmBtn = document.getElementById('confirmPaymentBtn');
  const tenderedInput = document.getElementById('amountTendered');
  const amountTendered = parseFloat(tenderedInput?.value) || 0;
  const currencySymbol = getCurrencySymbol();
  const isValidTendered = amountTendered >= newTotal && tenderedInput && tenderedInput.value !== '';
  const canConfirm = isCustomerSelected || isValidTendered;

  if (isCustomerSelected) {
    const customer = customers[parseInt(paymentSelect.value, 10)];
    if (customer) {
      const currentBalance = parseFloat(customer.balance) || 0;
      const balanceChange = amountTendered - newTotal;
      const newBalance = currentBalance + balanceChange;
      const remainingBalance = Math.max(0, newTotal - amountTendered);

      if (remainingBalanceRow) remainingBalanceRow.style.display = 'flex';
      if (remainingBalanceEl) remainingBalanceEl.innerHTML = `<span style="${remainingBalance > 0 ? 'color:#dc3545' : 'color:#28a745'}; font-weight:bold;">${remainingBalance > 0 ? '-' : ''}${currencySymbol}${formatCurrency(remainingBalance)}</span>`;

      const labelEl = document.getElementById('paymentNewBalanceLabel');
      const valEl = document.getElementById('paymentNewBalanceVal');
      const newBalanceRow = document.getElementById('paymentNewBalanceRow');
      if (newBalanceRow) newBalanceRow.style.display = 'flex';
      if (labelEl && valEl) {
        if (newBalance < 0) {
          labelEl.textContent = 'New Balance (Debt):';
          valEl.innerHTML = `<span style="color:#dc3545; font-weight:bold;">-${currencySymbol}${formatCurrency(Math.abs(newBalance))}</span>`;
        } else if (newBalance > 0) {
          labelEl.textContent = 'New Balance (Credit):';
          valEl.innerHTML = `<span style="color:#28a745; font-weight:bold;">${currencySymbol}${formatCurrency(newBalance)}</span>`;
        } else {
          labelEl.textContent = 'New Account Balance:';
          valEl.innerHTML = `No Balance (${currencySymbol}0)`;
        }
      }
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = canConfirm ? '1' : '0.5';
        confirmBtn.style.cursor = canConfirm ? 'pointer' : 'not-allowed';
      }
    }
  } else {
    const newBalanceRow = document.getElementById('paymentNewBalanceRow');
    if (newBalanceRow) newBalanceRow.style.display = 'none';
    if (remainingBalanceRow) remainingBalanceRow.style.display = 'flex';
    if (remainingBalanceEl) remainingBalanceEl.innerHTML = `<span style="${amountTendered >= newTotal ? 'color:#28a745' : 'color:#dc3545'}; font-weight:bold;">${currencySymbol}${formatCurrency(Math.max(0, newTotal - amountTendered))}</span>`;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = canConfirm ? '1' : '0.5';
      confirmBtn.style.cursor = canConfirm ? 'pointer' : 'not-allowed';
    }
  }

  calculateChange();
}

function toggleCashPaymentFields() {
  const paymentMethod = document.getElementById('paymentMethod').value;
  const cashFields = document.getElementById('cashPaymentFields');
  cashFields.style.display = (paymentMethod === 'Cash') ? 'block' : 'none';
}

function calculateChange() {
  const totalDueEl = document.getElementById('paymentTotalDue');
  const totalDue = totalDueEl.dataset.currentTotal ? parseFloat(totalDueEl.dataset.currentTotal) : (parseFloat(totalDueEl.textContent.replace(/,/g, '')) || 0);
  
  const paymentSelect = document.getElementById('paymentCustomerSelect');
  const isCustomerSelected = paymentSelect && paymentSelect.value !== '';
  
  let targetAmount = totalDue;
  if (isCustomerSelected) {
    targetAmount = parseFloat(document.getElementById('amountTendered').value) || 0;
  }
  
  const amountTendered = parseFloat(document.getElementById('amountTendered').value) || 0;
  const change = amountTendered - targetAmount;
  document.getElementById('changeDue').textContent = change > 0 ? formatCurrency(change) : '0.00';
}

async function finalizePayment(isSplit = false) {
  const currentOrder = activeOrders[CART_ID];
  if (!currentOrder || !Array.isArray(currentOrder.items) || currentOrder.items.length === 0) {
    await showAppAlert("There is no active order to complete.", "Nothing to Pay");
    return;
  }

  const paymentMethod = document.getElementById('paymentMethod').value;
  const amountTendered = parseFloat(document.getElementById('amountTendered').value);
  const totals = calculateTransactionTotals(currentOrder.items);
  const paymentSelect = document.getElementById('paymentCustomerSelect');
  const isCustomerSelected = paymentSelect && paymentSelect.value !== '';

  const discountInput = parseFloat(document.getElementById('discountInput').value) || 0;
  let discountAmount = discountInput;

  if (discountAmount > totals.total) discountAmount = totals.total;
  if (discountAmount < 0) discountAmount = 0;
  const finalTotal = totals.total - discountAmount;

  const customerIndex = isCustomerSelected ? parseInt(paymentSelect.value, 10) : -1;
  const customer = isCustomerSelected ? customers[customerIndex] : null;

  let amountPaid = finalTotal;
  if (isNaN(amountTendered) || amountTendered < 0) {
    await showAppAlert("Please enter a valid amount tendered.", "Invalid Amount");
    return;
  }

  if (!isCustomerSelected && amountTendered < finalTotal) {
    await showAppAlert(`Amount tendered is below the total. Please enter at least ${formatCurrency(finalTotal)} or select a customer account to continue.`, "Amount Below Total");
    return;
  }

  amountPaid = amountTendered;

  if (paymentMethod === 'Cash' && amountTendered < finalTotal && !isCustomerSelected) {
    await showAppAlert(`Amount tendered is below the total. Please enter at least ${formatCurrency(finalTotal)} or select a customer account to continue.`, "Amount Below Total");
    return;
  }

  setPaymentProcessingState(true, navigator.onLine ? 'Processing payment…' : 'Offline mode: saving your sale locally and syncing it when the connection returns.', navigator.onLine ? 'info' : 'success');

  try {
    currentOrder.items.forEach(orderItem => {
      const dish = menu.find(d => d.name === orderItem.name);
      if (dish && dish.name) {
        deductStock(dish.name, orderItem.qty);
      }
    });

    const balanceChange = isCustomerSelected ? (amountPaid - finalTotal) : 0;

    const transaction = {
      date: new Date().toISOString(),
      customerName: getCurrentServerName(), // This is the staff name for compatibility
      tableNo: 'Shop',
      items: [...currentOrder.items],
      total: finalTotal,
      subtotal: totals.subtotal,
      tax: totals.tax,
      paymentMethod: paymentMethod,
      discount: { value: discountInput, type: 'fixed', amount: discountAmount },
      
      // Integrate customer debt/credit details:
      customerId: customer ? customer.id || customer.recordId : null,
      customerNameReal: customer ? customer.name : 'Walk-in Customer',
      amountPaid: amountPaid,
      balanceChange: balanceChange
    };

    if (isSplit) {
      setPaymentProcessingState(false, 'Split payment prepared.', 'success');
      return transaction;
    }

    // 1. Update customer balance in local state and db
    if (customer) {
      const currentBalance = parseFloat(customer.balance) || 0;
      customer.balance = currentBalance + balanceChange;
      customer.totalSales = (parseFloat(customer.totalSales) || 0) + finalTotal;
      customer.subtotalSales = (parseFloat(customer.subtotalSales) || 0) + totals.subtotal;
      customer.totalPaid = (parseFloat(customer.totalPaid) || 0) + amountPaid;
      customer.lastTransactionDate = transaction.date;

      enqueueEnterpriseRecordChange('customers', customer, 'upsert').catch(console.warn);
    }

    await recordTransaction(transaction);
    const changeDue = amountTendered - amountPaid;
    delete activeOrders[CART_ID];
    await saveData();
    renderMenu();
    
    // Reset order customer selection dropdown
    const orderSelect = document.getElementById('orderCustomerSelect');
    if (orderSelect) orderSelect.value = '';

    document.getElementById('paymentModal').style.display = 'none';
    setPaymentProcessingState(false);
    showSaleSuccessCelebration(transaction, changeDue > 0 ? changeDue : 0);
  } catch (error) {
    console.error('[PAYMENT] Checkout failed:', error);
    setPaymentProcessingState(false, 'Payment could not be completed. Please try again.', 'error');
    await showAppAlert("We could not complete the sale. The order is still available and you can try again.", "Payment Issue");
  }
}

// Helper to calculate subtotal, tax, and total
function calculateTransactionTotals(items) {
  const subtotal = items.reduce((sum, o) => sum + (o.qty * o.price), 0);
  const taxRate = settings.taxRate || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

function calculateOrderTotal(items) {
  return calculateTransactionTotals(items).total;
}

function hasCircularDependency(targetName, recipe, visited = new Set()) {
  if (!recipe || !Array.isArray(recipe)) return false;
  for (const component of recipe) {
    if (component.itemName === targetName) return true;
    if (visited.has(component.itemName)) continue;

    visited.add(component.itemName);
    const componentDish = menu.find(d => d.name === component.itemName);
    if (componentDish && componentDish.recipe) {
      if (hasCircularDependency(targetName, componentDish.recipe, new Set(visited))) return true;
    }
  }
  return false;
}

function calculateDishStock(dish, isForDisplay = false, visited = new Set()) {
  if (!dish) return 0;

  // Detect circular dependencies to prevent stack overflow
  if (visited.has(dish.name)) {
    // Break cycle: Return physical stock if it's a direct self-reference or loop
    return dish.stock !== undefined ? (parseFloat(dish.stock) || 0) : 0;
  }
  visited.add(dish.name);

  // Base case: If the item has no recipe, it's a primary ingredient. Return its own stock.
  if (!dish.recipe || dish.recipe.length === 0) {
    return dish.stock !== undefined ? dish.stock : (isForDisplay ? 0 : Infinity);
  }

  let maxPossibleServings = Infinity;

  // Recursive case: Calculate stock based on the stock of its components.
  for (const component of dish.recipe) {
    const componentDish = menu.find(d => d.name === component.itemName);
    if (!componentDish) return 0; // A component of the recipe doesn't exist.

    // Recursively calculate the stock of the component dish.
    const componentStock = calculateDishStock(componentDish, isForDisplay, new Set(visited));

    const possibleServings = Math.floor(componentStock / component.quantity);
    if (possibleServings < maxPossibleServings) {
      maxPossibleServings = possibleServings;
    }
  }

  return maxPossibleServings === Infinity ? 0 : maxPossibleServings;
}

function deductStock(itemName, quantity, visited = new Set()) {
  if (!itemName || quantity <= 0) return;

  if (visited.has(itemName)) {
    const dish = menu.find(d => d.name === itemName);
    if (dish && dish.stock !== undefined) {
      dish.stock = Math.max(0, (parseFloat(dish.stock) || 0) - quantity);
    }
    return;
  }
  visited.add(itemName);

  const dish = menu.find(d => d.name === itemName);
  if (!dish) return;

  if (!dish.recipe || dish.recipe.length === 0) {
    if (dish.stock !== undefined) {
      dish.stock = Math.max(0, (parseFloat(dish.stock) || 0) - quantity);
      const threshold = (settings.lowStockThreshold !== undefined && settings.lowStockThreshold !== null) ? settings.lowStockThreshold : 10;
      if (dish.stock <= threshold) {
        sendLowStockNotification(dish.name, dish.stock);
      }
    }
  } else {
    dish.recipe.forEach(component => deductStock(component.itemName, component.quantity * quantity, new Set(visited)));
  }
}
// ===== Dishes Table =====
function renderDishesTable() {
  const tbody = document.getElementById('dishesTableBody');
  tbody.innerHTML = '';
  menu = normalizeProductCatalog(Array.isArray(menu) ? menu : []);
  const productsForTable = getCanonicalProductCatalog(Array.isArray(menu) ? menu : [], { includeOnlySellable: true });
  // Show items that either have a recipe OR have a selling price and category (sellable stock items)
  productsForTable.forEach((dish, rowIndex) => {
    const i = menu.indexOf(dish); // Get the original index for edit/delete functions
    const stock = calculateDishStock(dish);
    const costPrice = calculateDishCost(dish);
    const sellingPrice = dish.price || 0;
    const profitValue = sellingPrice - costPrice;

    // Add cache-buster for consistency in the products table
    let displayImage = dish.image || "https://placehold.co/100";
    if (displayImage.startsWith('http') && navigator.onLine) {
      displayImage += (displayImage.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
    }

    const tr = document.createElement('tr');
    tr.dataset.menuIndex = i;
    tr.innerHTML = `<td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('dishesTableBody','selectAllProducts'); updateDeleteMarkedButtonVisibility('dishesTableBody','deleteMarkedProductsBtn')"></td>
        <td>${rowIndex + 1}</td>
        <td><img src="${displayImage}" crossorigin="anonymous" alt="" onerror="this.removeAttribute('crossorigin'); this.src='https://placehold.co/100';"></td>
        <td>${dish.name}</td> 
        <td class="u-text-right u-nowrap"><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(costPrice)}</td>
        <td class="u-text-right u-nowrap"><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(sellingPrice)}</td>
        <td class="u-text-right u-nowrap"><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(profitValue)}</td>
        <td class="u-text-right">
          <button class="icon-btn" title="Print Label" onclick="printDishLabel(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/><path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 0v2H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1v-2a2 2 0 0 0-2-2H5z"/></svg></button>
          <button class="icon-btn" title="Edit Dish" onclick="editDish(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V12h2.293l6.5-6.5-.207-.207z"/></svg></button>
          <button class="icon-btn" title="Delete Dish" onclick="deleteItem(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>
        </td>`;
    tbody.appendChild(tr);
  });
}

// Adjust dishes table header
(function () {
  const headerRow = document.querySelector('#addDishTab table thead tr');
  if (headerRow) {
    // Header is now directly in HTML, this is no longer needed.
  }
})();

async function deleteMarkedProducts() {
  const body = document.getElementById('dishesTableBody');
  if (!body) return;

  const selectedRows = Array.from(body.querySelectorAll('.table-row-select:checked'))
    .map(checkbox => checkbox.closest('tr'))
    .filter(Boolean);

  if (selectedRows.length === 0) return;

  const confirmed = await showAppConfirm(
    `Delete ${selectedRows.length} selected product${selectedRows.length === 1 ? '' : 's'}?`,
    'Delete Marked Products',
    'Delete',
    'Cancel'
  );
  if (!confirmed || !confirmed.confirmed) return;

  const indicesToDelete = selectedRows
    .map(row => Number(row.dataset.menuIndex))
    .filter(index => Number.isFinite(index))
    .sort((a, b) => b - a);

  indicesToDelete.forEach(index => {
    const item = menu[index];
    if (!item) return;
    enqueueEnterpriseRecordChange('products', item, 'delete').catch(console.warn);
    menu.splice(index, 1);
  });

  saveData();

  try { renderStockListTable(); } catch (e) { console.error('Error updating stock:', e); }
  try { renderDishesTable(); } catch (e) { console.error('Error updating dishes:', e); }
  try { renderInventoryReport(); } catch (e) { console.error('Error updating inventory:', e); }
  try { updateDashboard(); } catch (e) { console.error('Error updating dashboard:', e); }
  updateDeleteMarkedButtonVisibility('dishesTableBody', 'deleteMarkedProductsBtn');
}

async function deleteItem(i) {
  const index = Number(i); // Ensure index is a number
  const item = menu[index];
  if (!item) return;

  if (typeof showAppConfirm === 'function') {
    const resp = await showAppConfirm(`Are you sure you want to delete ${item.name}?`, 'Delete Item', 'Delete', 'Cancel');
    if (!resp || !resp.confirmed) return;
  }
  enqueueEnterpriseRecordChange('products', item, 'delete').catch(console.warn);

  menu.splice(index, 1);
  saveData(); // Persist the deletion

  // Safely update all views with error handling to prevent one failure from stopping the rest
  // Update UI components immediately
  try { renderStockListTable(); } catch (e) { console.error("Error updating stock:", e); }
  try { renderDishesTable(); } catch (e) { console.error("Error updating dishes:", e); }
  try { renderInventoryReport(); } catch (e) { console.error("Error updating inventory:", e); }
  try { updateDashboard(); } catch (e) { console.error("Error updating dashboard:", e); }

}

// ===== Receipt =====
window.openA4InvoicePreview = function openA4InvoicePreview(transactionData = null) {
  const previewWindow = window.open('', '_blank', 'width=1100,height=1400,scrollbars=yes,resizable=yes');
  if (!previewWindow) {
    return (typeof showAppAlert === 'function') ? showAppAlert('Please allow pop-ups to preview the A4 invoice.') : alert('Please allow pop-ups to preview the A4 invoice.');
  }

  const source = transactionData || {};
  const invoiceNumber = normalizeInvoiceNumber(source.invoiceNumber || source.invoiceNo || getInvoiceNumber(source)) || 'INV-UNKNOWN';
  const invoiceDate = source.date ? new Date(source.date).toLocaleString() : new Date().toLocaleString();
  const customerName = source.customerName || source.customer?.name || 'Walk-in Customer';
  const customerPhone = source.customerPhone || source.customer?.phone || '';
  const customerAddress = source.customerAddress || source.customer?.address || '';
  const paymentMethod = source.paymentMethod || source.payment?.method || 'Cash';
  const paymentStatus = source.paymentStatus || source.payment?.status || source.status || 'PAID';
  const cashier = source.cashier || source.staffName || source.servedBy || 'Admin';
  const note = source.note || 'Please keep this invoice for warranty and return purposes.';
  const currencySymbol = getCurrencySymbol();
  const storeName = settings?.name || 'YO SHOP';
  const storeAddress = settings?.address || 'Smart POS & Inventory System';
  const logoUrl = sanitizeLogoUrl(settings?.logo);
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Store Logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" style="width:70px;height:70px;object-fit:contain;border-radius:50%;"><div class="logo-circle" style="display:none;">${(storeName || 'Y').charAt(0).toUpperCase()}</div>`
    : `<div class="logo-circle">${(storeName || 'Y').charAt(0).toUpperCase()}</div>`;

  const rawItems = Array.isArray(source.items) ? source.items : [];
  let subtotal = 0;
  const itemsHtml = rawItems.length > 0 ? rawItems.map((item, index) => {
    const name = item?.name || item?.productName || item?.itemName || 'Item';
    const qty = Number(item?.qty || item?.quantity || 1);
    const price = Number(item?.price || item?.unitPrice || item?.cost || 0);
    const total = qty * price;
    subtotal += total;
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${name}</td>
        <td>${qty}</td>
        <td>${currencySymbol}${formatCurrency(price)}</td>
        <td>${currencySymbol}${formatCurrency(total)}</td>
      </tr>`;
  }).join('') : `
      <tr>
        <td colspan="5" style="text-align:center; color:#64748b;">No items available</td>
      </tr>`;

  const taxAmount = Number(source.taxAmount ?? source.tax ?? source.vatAmount ?? source.vat ?? 0);
  const grandTotal = subtotal + taxAmount;
  const subtotalText = `${currencySymbol}${formatCurrency(subtotal)}`;
  const taxText = `${currencySymbol}${formatCurrency(taxAmount)}`;
  const grandText = `${currencySymbol}${formatCurrency(grandTotal)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${storeName} Invoice</title>
  <style>
    :root { --primary:#2563eb; --secondary:#10b981; --light:#f8fafc; --border:#dbe4ee; --text:#334155; }
    * { box-sizing:border-box; margin:0; padding:0; font-family:'Segoe UI', Arial, sans-serif; }
    body { background:#edf2f7; padding:30px; color:var(--text); }
    .invoice { width:210mm; min-height:297mm; background:white; margin:auto; border-radius:14px; overflow:hidden; box-shadow:0 15px 35px rgba(0,0,0,.15); }
    .header { background:linear-gradient(135deg,#2563eb,#1d4ed8,#10b981); color:white; padding:30px; display:flex; justify-content:space-between; align-items:center; }
    .logo { display:flex; align-items:center; gap:15px; }
    .logo-circle { width:70px; height:70px; background:white; color:#2563eb; border-radius:50%; display:flex; justify-content:center; align-items:center; font-size:34px; font-weight:bold; }
    .logo h1 { font-size:30px; }
    .logo p { opacity:.9; }
    .invoice-title { text-align:right; }
    .invoice-title h2 { font-size:38px; }
    .content { padding:30px; }
    .cards { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:25px; }
    .card { background:#f8fafc; border-left:5px solid var(--primary); padding:18px; border-radius:10px; }
    .card h3 { color:var(--primary); margin-bottom:10px; }
    .badge { display:inline-block; padding:6px 14px; background:#10b981; color:white; border-radius:30px; font-size:13px; font-weight:bold; }
    table { width:100%; border-collapse:collapse; margin-top:20px; }
    thead { background:var(--primary); color:white; }
    th { padding:14px; }
    td { padding:13px; border-bottom:1px solid #eee; }
    tbody tr:nth-child(even) { background:#f8fafc; }
    .summary { margin-top:30px; width:360px; margin-left:auto; }
    .summary td { padding:12px; border:none; }
    .grand { background:linear-gradient(135deg,#10b981,#059669); color:white; font-size:22px; font-weight:bold; border-radius:8px; }
    .footer { margin-top:40px; text-align:center; }
    .note { margin-top:20px; padding:18px; background:#eff6ff; border-left:5px solid var(--primary); border-radius:8px; color:#555; }
    .actions { display:flex; justify-content:center; gap:12px; margin:25px auto; }
    .preview-controls { position:sticky; top:0; z-index:100; display:flex; gap:10px; padding:12px; justify-content:center; width:100%; background:rgba(255,255,255,0.95); border-bottom:1px solid #ddd; backdrop-filter:blur(6px); }
    #preview-zoom-wrapper { transform-origin: top center; width:100%; display:flex; justify-content:center; }
    .preview-inner { width:210mm; }
    button { padding:14px 40px; font-size:18px; background:linear-gradient(135deg,#2563eb,#10b981); border:none; border-radius:8px; color:white; cursor:pointer; }
    button:hover { transform:scale(1.03); }
    /* Button variants (match app styles) */
    .btn { display:inline-block; padding:10px 16px; color:#fff; border:none; border-radius:6px; cursor:pointer; }
    .btn-primary-blue { background-color: #007bff; }
    .btn-info { background-color: #17a2b8; }
    .btn-secondary { background-color: #6c757d; }
    .u-fs-08 { font-size: 0.85rem; }
    @media print { body { background:white; padding:0; } .actions, .preview-controls { display:none; } .invoice { width:100%; box-shadow:none; border-radius:0; } @page { size:A4; margin:10mm; } }
  </style>
  <script>
    function changeA4Zoom(delta) {
      window.a4ZoomLevel = Math.max(0.4, Math.min(2.0, (window.a4ZoomLevel || 1) + delta));
      const wrapper = document.getElementById('preview-zoom-wrapper');
      const display = document.getElementById('a4-zoom-percentage');
      if (wrapper) {
        wrapper.style.transform = 'scale(' + window.a4ZoomLevel + ')';
        if (display) display.textContent = Math.round(window.a4ZoomLevel * 100) + '%';
        const extraHeight = wrapper.offsetHeight * (window.a4ZoomLevel - 1);
        wrapper.style.marginBottom = (extraHeight > 0 ? extraHeight + 40 : 20) + 'px';
      }
    }
    window.a4ZoomLevel = 1;
  </script>
</head>
<body>
  <div class="preview-controls">
    <button class="btn btn-secondary" onclick="changeA4Zoom(-0.1)" style="width:42px; height:42px; border-radius:50%; font-size:1.4em;">-</button>
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:90px;">
      <span style="font-size:0.7em; text-transform:uppercase; color:#666; font-weight:bold;">Zoom</span>
      <span id="a4-zoom-percentage" style="font-weight:bold; color:var(--primary);">100%</span>
    </div>
    <button class="btn btn-secondary" onclick="changeA4Zoom(0.1)" style="width:42px; height:42px; border-radius:50%; font-size:1.4em;">+</button>
    <button class="btn btn-info u-fs-08" onclick="changeA4Zoom(1 - (window.a4ZoomLevel||1))" style="margin-left:12px; border-radius:20px; padding:0 12px;">Reset</button>
    <div style="flex:1"></div>
      <div style="display:flex; gap:8px;">
      <button class="btn btn-primary-blue u-fs-08" onclick="window.print()">🖨 Print</button>
      <button class="btn btn-secondary u-fs-08" onclick="window.close()">Close</button>
    </div>
  </div>
  <div id="preview-zoom-wrapper">
    <div class="preview-inner">
      <div class="invoice">
        <div class="header">
          <div class="logo">
            ${logoHtml}
            <div>
              <h1>${storeName.toUpperCase()}</h1>
              <p>${storeAddress}</p>
            </div>
          </div>
          <div class="invoice-title">
            <h2>INVOICE</h2>
            <div><b>${invoiceNumber}</b></div>
            <div>${invoiceDate}</div>
          </div>
        </div>
        <div class="content">
          <div class="cards">
            <div class="card">
              <h3>Customer</h3>
              <p>${customerName}</p>
              <p>${customerPhone || ''}</p>
              <p>${customerAddress || ''}</p>
            </div>
            <div class="card">
              <h3>Payment</h3>
              <p>Method: <b>${paymentMethod}</b></p>
              <p>Status: <span class="badge">${paymentStatus}</span></p>
              <p>Cashier: <b>${cashier}</b></p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div class="summary">
            <table>
              <tr><td>Subtotal</td><td align="right">${subtotalText}</td></tr>
              <tr><td>VAT</td><td align="right">${taxText}</td></tr>
              <tr class="grand"><td>Total</td><td align="right">${grandText}</td></tr>
            </table>
          </div>
          <div class="footer">
            <p><b>Thank you for shopping with ${storeName} ❤️</b></p>
          </div>
          <div class="note">${note}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  previewWindow.document.open();
  previewWindow.document.write(html);
  previewWindow.document.close();
  previewWindow.focus();
}

function previewOrder(transactionData = null) {
  const receiptModal = document.getElementById('receiptModal');
  let currentTransaction;
  console.log('previewOrder called with:', transactionData);

  // Handle lookup by index if a numeric index is passed, or use the object directly
  if (typeof transactionData === 'number' || (typeof transactionData === 'string' && transactionData !== '' && !isNaN(transactionData))) {
    const idx = parseInt(transactionData, 10);
    const source = (typeof transactions !== 'undefined') ? transactions : (window.transactions || []);
    if (source && source[idx]) {
      transactionData = source[idx];
    } else {
      transactionData = null;
    }
  }

  if (transactionData) {
    currentTransaction = transactionData;
    // Store the historical transaction data on the modal itself for the print function to use
    receiptModal._transactionData = transactionData;
  } else {
    const currentOrder = activeOrders[CART_ID];
    if (!currentOrder || currentOrder.items.length === 0) {
      return (typeof showAppAlert === 'function') ? showAppAlert("No active order to preview.") : alert("No active order to preview.");
    } else {
      const totals = calculateTransactionTotals(currentOrder.items);
      currentTransaction = {
        date: new Date().toLocaleString(),
        customerName: getCurrentServerName(),
        tableNo: 'Shop',
        items: [...currentOrder.items],
        total: totals.total,
        subtotal: totals.subtotal,
        tax: totals.tax
      };
      // Clear any previously stored historical transaction
      receiptModal._transactionData = null;
    }
  }

  // Populate the content and then display the modal
  populateReceiptContent(currentTransaction);
  document.getElementById('receiptModal').style.display = 'flex';

  updateCurrencyDisplay();
}

async function downloadCurrentReceiptAsPDF() {
  if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    if (typeof showAppAlert === 'function') showAppAlert("PDF generation libraries are not loaded. Please check your internet connection.");
    else alert("PDF generation libraries are not loaded. Please check your internet connection.");
    return;
  }
  const receiptContentEl = document.getElementById('receiptContent');
  const { jsPDF } = window.jspdf;

  try {
    const canvas = await html2canvas(receiptContentEl, {
      scale: 2, // Increase scale for better quality
      useCORS: true // Important for external images
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`invoice-${Date.now()}.pdf`);

  } catch (error) {
    console.error("Error generating PDF:", error);
    if (typeof showAppAlert === 'function') showAppAlert("Could not generate PDF. There might be an issue with the receipt content.");
    else alert("Could not generate PDF. There might be an issue with the receipt content.");
  }
}

async function shareReceipt() {
  const receiptContentEl = document.getElementById('receiptContent');
  if (typeof html2canvas === 'undefined') {
    if (typeof showAppAlert === 'function') showAppAlert("Library not loaded. Please check internet connection.");
    else alert("Library not loaded. Please check internet connection.");
    return;
  }
  try {
    const canvas = await html2canvas(receiptContentEl, { scale: 2, useCORS: true });
    canvas.toBlob(async (blob) => {
      const file = new File([blob], "invoice.png", { type: "image/png" });
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Invoice',
            text: 'Here is your invoice from YoShop.',
            files: [file]
          });
        } catch (err) {
          console.error('Share failed:', err);
        }
      } else {
        if (typeof showAppAlert === 'function') showAppAlert("Sharing is not supported on this device/browser. You can save as PDF instead.");
        else alert("Sharing is not supported on this device/browser. You can save as PDF instead.");
      }
    });
  } catch (error) {
    console.error("Error sharing receipt:", error);
    alert("Could not generate receipt image for sharing.");
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (printerDevice) {
    updatePrinterStatus(true, printerDevice.productName || 'Connected Device');
  }
});

/**
 * Helper to generate a Barcode DataURL for receipts using JsBarcode
 */
function getBarcodeDataUrl(code) {
  if (typeof JsBarcode === 'undefined') return '';
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, code, { format: "CODE128", width: 2, height: 40, displayValue: false, margin: 0 });
    return canvas.toDataURL("image/png");
  } catch (e) { return ''; }
}

function normalizeInvoiceNumber(invoiceNumber) {
  if (!invoiceNumber || typeof invoiceNumber !== 'string') return invoiceNumber;
  const trimmed = invoiceNumber.trim();
  if (/^INV-\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  const oldDashMatch = /^INV-(\d{2})(\d{2})-(\d{4})$/.exec(trimmed);
  if (oldDashMatch) return `INV-${oldDashMatch[1]}/${oldDashMatch[2]}/${oldDashMatch[3]}`;
  const dashDateMatch = /^INV-(\d{2})\/(\d{2})-(\d{4})$/.exec(trimmed);
  if (dashDateMatch) return `INV-${dashDateMatch[1]}/${dashDateMatch[2]}/${dashDateMatch[3]}`;
  return trimmed;
}

function parseInvoiceSequence(invoiceNumber) {
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  const match = /^INV-\d{2}\/\d{2}\/(\d{4})$/.exec(normalized);
  return match ? Number(match[1]) : null;
}

function getInvoiceNumber(transaction = null) {
  if (transaction?.invoiceNumber) return normalizeInvoiceNumber(transaction.invoiceNumber);

  const dateValue = transaction?.date ? new Date(transaction.date) : new Date();
  const dd = String(dateValue.getDate()).padStart(2, '0');
  const mm = String(dateValue.getMonth() + 1).padStart(2, '0');
  const datePart = `${dd}/${mm}`; // DD/MM without year
  const storageKey = `yoshop_invoice_counter_${dd}${mm}`;

  try {
    const storedValue = parseInt(localStorage.getItem(storageKey) || '0', 10);
    const existingSerials = Array.isArray(transactions)
      ? transactions
          .map(tx => tx?.invoiceNumber ? parseInvoiceSequence(tx.invoiceNumber) : null)
          .filter(num => Number.isFinite(num) && num > 0)
      : [];
    const highestSerial = existingSerials.length ? Math.max(...existingSerials) : 0;
    let nextNumber = 1;

    if (highestSerial > 0) {
      nextNumber = Math.max(highestSerial, Number.isFinite(storedValue) ? storedValue : 0) + 1;
    } else if (Number.isFinite(storedValue) && storedValue > 0) {
      nextNumber = 1;
    }

    localStorage.setItem(storageKey, String(nextNumber));
    const invoiceNumber = `INV-${datePart}/${String(nextNumber).padStart(4, '0')}`;
    if (transaction && typeof transaction === 'object') transaction.invoiceNumber = invoiceNumber;
    return invoiceNumber;
  } catch (error) {
    const fallbackNumber = `INV-${datePart}/${String(Date.now()).slice(-4)}`;
    if (transaction && typeof transaction === 'object') transaction.invoiceNumber = fallbackNumber;
    return fallbackNumber;
  }
}

async function printReceipt() {
  // If a device is connected, the user might want to use that instead.
  if (printerDevice) {
    if (showAppConfirm) {
      const confirmed = await showAppConfirm("A thermal printer is connected. Do you want to print directly to the device instead of the browser's print dialog?", 'Print Options', 'Print to Device', 'Browser Print');
      if (confirmed?.confirmed) {
        return directPrint();
      }
    }
  }
  const receiptModal = document.getElementById('receiptModal');
  let printTransaction = receiptModal._transactionData; // Check for a historical transaction first

  if (!printTransaction) {
    // If no historical transaction is being viewed, get the active order
    const currentOrder = activeOrders[CART_ID];
    if (!currentOrder || currentOrder.items.length === 0) return alert("No active order to print.");
    const totals = calculateTransactionTotals(currentOrder.items);
    printTransaction = {
      date: new Date().toLocaleString(),
      customerName: getCurrentServerName(),
      tableNo: 'Shop',
      items: [...currentOrder.items],
      total: totals.total,
      subtotal: totals.subtotal,
      tax: totals.tax
    };
  }

  const { date, customerName, tableNo, items, total } = printTransaction;
  const transactionId = new Date(date).getTime();
  const invoiceNumber = getInvoiceNumber(printTransaction);

  const currencySymbol = getCurrencySymbol();
  const logoUrl = sanitizeLogoUrl(settings.logo);
  const logoHtml = logoUrl ? `<img src="${logoUrl}" onerror="this.src='assets/icons/icon.png';" style="width:50px; height:50px; object-fit:contain;">` : '🧾';
  const barcodeImgUrl = getBarcodeDataUrl(transactionId.toString());
  const barcodeHtml = barcodeImgUrl ? `<div style="text-align:center; margin: 15px 0;"><img src="${barcodeImgUrl}" style="width: 80%; max-height: 50px;"></div>` : '';

  const itemsHtml = items.map(o => {
    const notesHtml = o.notes ? `<br><small style="font-style: italic;">- ${o.notes}</small>` : '';
    return `<div class="item-row"><div class="col-name">${o.name} ${notesHtml}</div><div class="col-qty">${o.qty}x</div><div class="col-price">${currencySymbol}${formatCurrency(o.price)}</div><div class="col-total">${currencySymbol}${formatCurrency(o.qty * o.price)}</div></div>`;
  }).join('');

  const receiptHtml = `
      <div class="receipt-header">
        <div class="logo">${logoHtml}</div>
        <h3>${settings.name || 'My Business'}</h3>
        <p>${settings.address || '123 Business Avenue, Suite 100'}</p>
      </div>
      <div class="receipt-details">
        <div><span>Invoice No:</span> <span>${invoiceNumber}</span></div>
        <div><span>Transaction ID:</span> <span>${transactionId}</span></div>
        <div><span>Date:</span> <span>${new Date(date).toLocaleDateString()}</span></div>
        <div><span>Time:</span> <span>${new Date(date).toLocaleTimeString()}</span></div>
      </div>
      <div class="receipt-items">
        <div class="table-header"><div class="col-name">Item</div><div class="col-qty">Qty</div><div class="col-price">Price</div><div class="col-total">Total</div></div>
        ${itemsHtml}
      </div>
      <div class="receipt-summary">
        <div class="summary-line total"><span>TOTAL</span> <span>${currencySymbol}${formatCurrency(total)}</span></div>
      </div>
      <div class="receipt-footer"><p>THANK YOU FOR YOUR PATRONAGE!</p>${barcodeHtml}<p class="promo">Get 10% off on your next visit!</p><p style="font-size:0.7em; margin-top:10px; opacity:0.6;">Power by YoShop POS</p></div>`;

  const printWindow = window.open('', 'Print Invoice', 'width=420,height=600,scrollbars=yes');
  const printHtml = `<html><head><title>Print Invoice</title><style>body { margin: 0; padding: 10px; background: #f0f0f0; } .receipt-paper { font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; padding: 30px 20px; max-width: 400px; margin: auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); } .receipt-header { text-align: center; margin-bottom: 15px; } .receipt-header h2 { margin: 0; font-size: 1.4em; text-transform: uppercase; } .receipt-header p { margin: 2px 0; font-size: 0.8em; } .receipt-details { font-size: 0.8em; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 10px 0; margin: 15px 0; } .receipt-details div { display: flex; justify-content: space-between; } .receipt-items .table-header { display: flex; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 5px; margin-bottom: 8px; font-size: 0.8em; } .receipt-items .item-row { display: flex; margin-bottom: 5px; font-size: 0.8em; } .receipt-items .col-name { width: 50%; } .receipt-items .col-qty { width: 10%; text-align: left; } .receipt-items .col-price { width: 20%; text-align: right; } .receipt-items .col-total { width: 20%; text-align: right; } .receipt-summary { border-top: 1px dashed #000; padding-top: 10px; margin-top: 15px; font-size: 0.9em; } .summary-line { display: flex; justify-content: space-between; margin-bottom: 5px; } .summary-line.total { font-weight: bold; font-size: 1.4em; border-top: 1px double #000; padding-top: 5px; } .receipt-footer { text-align: center; margin-top: 25px; font-size: 0.8em; } .receipt-footer .promo { margin-top: 15px; font-weight: bold; border: 1px dashed #000; padding: 5px; display: inline-block; }</style></head><body><div class="receipt-paper">${receiptHtml}</div></body></html>`;
  printWindow.document.write(printHtml);
  printWindow.document.close();
  printWindow.focus(); // Focus on the new window
  printWindow.print(); // Trigger the print dialog
}

// ===== Scanner Functions =====
let keepReadingSerial = false;
let serialDataBuffer = '';

async function connectUSBScanner() {
  // Try Web Serial API for USB scanners in Serial Mode
  if ("serial" in navigator) {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });

      keepReadingSerial = true;
      readSerialLoop(port);

      document.getElementById('scannerConnectionStatus').textContent = 'Connected (Serial)';
      document.getElementById('scannerConnectionStatus').style.color = '#28a745';
      if (typeof showAppAlert === 'function') showAppAlert("Connected to Serial Scanner.");
      else alert("Connected to Serial Scanner.");
    } catch (error) {
      console.error('Serial connection failed:', error);
      if (typeof showAppAlert === 'function') showAppAlert('Failed to connect to serial scanner: ' + error.message);
      else alert('Failed to connect to serial scanner: ' + error.message);
    }
  } else {
    if (typeof showAppAlert === 'function') showAppAlert("Web Serial API not supported. If your scanner is in HID mode, it works automatically.");
    else alert("Web Serial API not supported. If your scanner is in HID mode, it works automatically.");
  }
}

async function readSerialLoop(port) {
  while (port.readable && keepReadingSerial) {
    const reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        serialDataBuffer += text;

        if (serialDataBuffer.includes('\n') || serialDataBuffer.includes('\r')) {
          const parts = serialDataBuffer.split(/[\r\n]+/);
          serialDataBuffer = parts.pop(); // Keep incomplete part

          for (const code of parts) {
            if (code.trim()) processSerialInput(code.trim());
          }
        }
      }
    } catch (error) {
      console.error('Serial read error:', error);
    } finally {
      reader.releaseLock();
    }
  }
}

function processSerialInput(code) {
  const activeElement = document.activeElement;
  const isInput = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') && !activeElement.readOnly && !activeElement.disabled;

  if (isInput && activeElement.id !== 'scannerTestInput') {
    // Inject into active field
    const start = activeElement.selectionStart || activeElement.value.length;
    const end = activeElement.selectionEnd || activeElement.value.length;
    activeElement.value = activeElement.value.substring(0, start) + code + activeElement.value.substring(end);
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // Use general app logic (add to order, search, etc.)
    handleBarcodeScan(code);
  }
}

async function connectBluetoothScanner() {
  if (!("bluetooth" in navigator)) {
    return (typeof showAppAlert === 'function') ? showAppAlert("Web Bluetooth is not supported in your browser.") : alert("Web Bluetooth is not supported in your browser.");
  }
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    if (device.gatt) {
      await device.gatt.connect();
      document.getElementById('scannerConnectionStatus').textContent = `Connected: ${device.name}`;
      document.getElementById('scannerConnectionStatus').style.color = '#28a745';
    }
  } catch (error) {
    console.error('Bluetooth Scanner connection failed:', error);
  }
}

// ===== Printer Functions =====

async function connectUSBPrinter() {
  if (!("usb" in navigator)) {
    return alert(
      "WebUSB API is not supported in your browser. Please use a recent version of Chrome or Edge."
    );
  }

  try {
    const device = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }] }); // 7 is the class code for printers
    await device.open();
    await device.selectConfiguration(1);
    const iface = device.configuration.interfaces.find(i => i.interfaceClass === 7);
    await device.claimInterface(iface.interfaceNumber);

    printerDevice = device;
    printerType = 'USB';
    updatePrinterStatus(true, device.productName);
    if (typeof showAppAlert === 'function') showAppAlert(`Connected to USB printer: ${device.productName}`);
    else alert(`Connected to USB printer: ${device.productName}`);
  } catch (error) {
    console.error('USB connection failed:', error);
    if (typeof showAppAlert === 'function') showAppAlert('Failed to connect to USB printer. Make sure it is connected and you have granted permission.');
    else alert('Failed to connect to USB printer. Make sure it is connected and you have granted permission.');
  }
}

async function connectBluetoothPrinter() {
  if (!("bluetooth" in navigator)) {
    return (typeof showAppAlert === 'function') ? showAppAlert("Web Bluetooth is not supported in your browser. This feature works best in Chrome on Android, Windows, and macOS. It is NOT supported on iPhone or iPad.") : alert("Web Bluetooth is not supported in your browser. This feature works best in Chrome on Android, Windows, and macOS. It is NOT supported on iPhone or iPad.");
  }

  try {
    // Use acceptAllDevices to allow the user to select from any nearby BLE device.
    // We can still suggest common services to help the browser prioritize.
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb"], // Serial Port Profile
    });

    const server = await device.gatt.connect();
    printerDevice = server;
    printerType = 'BLUETOOTH';
    updatePrinterStatus(true, device.name);
    if (typeof showAppAlert === 'function') showAppAlert(`Connected to Bluetooth printer: ${device.name}`);
    else alert(`Connected to Bluetooth printer: ${device.name}`);
  } catch (error) {
    console.error('Bluetooth connection failed:', error);
    if (typeof showAppAlert === 'function') showAppAlert("Failed to connect. Make sure the printer is on, discoverable (often a blinking blue light), and you grant permission. Note: This feature is not supported on iPhones/iPads.");
    else alert("Failed to connect. Make sure the printer is on, discoverable (often a blinking blue light), and you grant permission. Note: This feature is not supported on iPhones/iPads.");
  }
}

function disconnectPrinter() {
  if (printerDevice && printerType === 'BLUETOOTH') {
    printerDevice.disconnect();
  }
  // For WebUSB, closing is more complex and often just releasing the interface is enough.
  // For simplicity, we'll just nullify the device.
  printerDevice = null;
  printerType = null;
  updatePrinterStatus(false);
  alert('Printer disconnected.');
}

function updatePrinterStatus(isConnected, deviceName = '') {
  const statusEl = document.getElementById('printerStatus');
  const testBtn = document.getElementById('testPrintBtn');
  const disconnectBtn = document.getElementById('disconnectPrinterBtn');
  const directPrintBtn = document.getElementById('directPrintBtn');
  const headerPrinterIcon = document.getElementById('header-printer-status');

  if (isConnected) {
    statusEl.textContent = `Connected to ${deviceName}`;
    statusEl.style.color = '#28a745';
    testBtn.style.display = 'inline-block';
    disconnectBtn.style.display = 'inline-block';
    headerPrinterIcon.style.display = 'inline-block';
    if (directPrintBtn) directPrintBtn.style.display = 'inline-block';
  } else {
    statusEl.textContent = 'Not Connected';
    statusEl.style.color = 'inherit';
    testBtn.style.display = 'none';
    disconnectBtn.style.display = 'none';
    headerPrinterIcon.style.display = 'none';
    if (directPrintBtn) directPrintBtn.style.display = 'none';
  }
}

async function sendDataToPrinter(data) {
  if (!printerDevice) return alert('No printer connected.');

  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data + '\n\n\n'); // Add newlines to feed paper

  try {
    if (printerType === 'USB') {
      const iface = printerDevice.configuration.interfaces.find(i => i.interfaceClass === 7);
      const endpoint = iface.alternate.endpoints.find(e => e.direction === 'out');
      await printerDevice.transferOut(endpoint.endpointNumber, encodedData);

    } else if (printerType === 'BLUETOOTH') {
      // Dynamically find a writable characteristic
      const services = await printerDevice.getPrimaryServices();
      let writableCharacteristic = null;

      for (const service of services) {
        const characteristics = await service.getCharacteristics();
        // Find the first characteristic that is writable
        const found = characteristics.find(
          (c) => c.properties.write || c.properties.writeWithoutResponse
        );
        if (found) {
          writableCharacteristic = found;
          break; // Stop searching once we find one
        }
      }

      if (writableCharacteristic) {
        // Split data into chunks if it's too large for a single write
        const maxChunkSize = writableCharacteristic.service.device.gatt.mtu - 3;
        for (let i = 0; i < encodedData.length; i += maxChunkSize) {
          const chunk = encodedData.subarray(i, i + maxChunkSize);
          await writableCharacteristic.writeValueWithoutResponse(chunk);
        }
      } else {
        throw new Error("No writable characteristic found on the Bluetooth device. This printer may not be compatible.");
      }
    }
  } catch (error) {
    console.error('Failed to print:', error);
    alert('Error sending data to printer. It may have been disconnected or is not compatible. ' + error.message);
    disconnectPrinter();
  }
}

function testPrint() {
  const testMessage =
    '*** Printer Test ***\n' +
    'Connection Successful!\n' +
    `App: ${settings.name || 'YoShop'}\n` +
    `Date: ${new Date().toLocaleString()}\n`;
  sendDataToPrinter(testMessage);
}

function directPrint() {
  const receiptContentEl = document.getElementById('receiptContent');
  // Use innerText to get a plain text representation of the receipt
  const plainTextReceipt = receiptContentEl.innerText;
  sendDataToPrinter(plainTextReceipt);
}

// ===== Transactions =====
function renderTransactions() {
  const startDate = document.getElementById('transactionStartDate')?.value;
  const endDate = document.getElementById('transactionEndDate')?.value;

  const normalizedTransactions = deduplicateTransactions(Array.isArray(transactions) ? transactions : []);
  if (Array.isArray(transactions) && normalizedTransactions.length !== transactions.length) {
    transactions = normalizedTransactions;
    saveState('transactions', transactions, { enqueueSync: false }).catch(() => {});
  }

  let filteredTransactions = normalizedTransactions;

  if (startDate || endDate) {
    filteredTransactions = normalizedTransactions.filter(t => {
      const tDate = t.date.split('T')[0];
      if (startDate && tDate < startDate) return false;
      if (endDate && tDate > endDate) return false;
      return true;
    });
  }

  const sourceArray = (startDate || endDate) ? filteredTransactions : normalizedTransactions;
  console.log('renderTransactions called — transactions length:', Array.isArray(normalizedTransactions) ? normalizedTransactions.length : typeof normalizedTransactions, 'sourceArray length:', Array.isArray(sourceArray) ? sourceArray.length : typeof sourceArray, 'startDate:', startDate, 'endDate:', endDate);

  const tableRows = sourceArray.map((t, i) => {
    const txIndex = normalizedTransactions.indexOf(t);
    const tr = document.createElement('tr');
    tr.className = `u-cursor-pointer${(t.duplicateCount || 0) > 0 ? ' duplicate-sale-row' : ''}`;

    // "Click anywhere" preview logic for the entire row
    tr.onclick = (e) => {
      if (!e.target.closest('button') && !e.target.closest('.icon-btn') && !e.target.closest('input')) {
        previewOrder(t);
      }
    };

    const iconReopen = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>`;
    const iconDownload = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L6.354 8.146a.5.5 0 1 0-.708.708l2 2z"/></svg>`;
    const iconDelete = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>`;

    tr.innerHTML = `
        <td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('transactionHistoryBody','selectAllSales')"></td>
        <td>${i + 1}</td>
        <td class="u-fs-08 u-nowrap">${new Date(t.date).toLocaleString()}${(t.duplicateCount || 0) > 0 ? ' <span class="duplicate-sale-badge">Duplicate</span>' : ''}</td>
        <td class="u-text-right u-fs-08 u-nowrap"><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(t.total)}</td>
        <td class="u-text-right">
          <button class="btn u-fs-08 row-preview-btn" data-tx-index="${txIndex}" style="display: inline-block; padding: 6px 8px; margin: 0 2px; background: #17a2b8;"> 
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: middle; color: #fff;"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8z"></path><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="#fff"></path></svg>
          </button>
          <button class="icon-btn" title="Re-Open Bill" onclick="reopenTransaction(${txIndex})">${iconReopen}</button>
          <button class="icon-btn" title="Download PDF" onclick="downloadBillAsPDF(${txIndex})">${iconDownload}</button>
          <button class="icon-btn" title="Delete Bill" onclick="deleteTransaction(${txIndex})">${iconDelete}</button>
        </td>
      `;

    // Attach the preview handler directly to the button
    const previewBtn = tr.querySelector('.row-preview-btn');
    if (previewBtn) {
      previewBtn.onclick = (e) => {
        e.stopPropagation(); // Stop row click from firing
        const attr = previewBtn.getAttribute('data-tx-index');
        console.log('previewBtn clicked — data-tx-index:', attr, 'tx object exists?', !!t);
        if (attr !== null && attr !== '' && !isNaN(attr)) {
          const idx = parseInt(attr, 10);
          const tx = (Array.isArray(transactions) && transactions[idx]) ? transactions[idx] : t;
          console.log('previewBtn resolved tx index ->', idx, 'tx found?', !!tx);
          previewOrder(tx);
        } else {
          previewOrder(t);
        }
      };
    }

    return tr;
  });

  const tbody = document.getElementById('transactionHistoryBody');
  tbody.innerHTML = ''; // Clear existing rows

  if (tableRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="u-text-center">No transactions found.</td></tr>';
    return;
  }

  // Show first 50 transactions, add "Show More" button if needed
  const txnPerPage = 50;
  const initialRows = tableRows.slice(0, txnPerPage);
  const remainingRows = tableRows.slice(txnPerPage);

  initialRows.forEach(row => tbody.appendChild(row));

  if (remainingRows.length > 0) {
    const showMoreRow = document.createElement('tr');
    // Use an IIFE in the onclick to safely reveal hidden rows regardless of class removal order
    showMoreRow.innerHTML = `
        <td colspan="3" style="text-align: center; padding: 20px;">
          <button class="btn btn-info" onclick="(function(btn){ const tbody = btn.closest('tbody'); const hidden = Array.from(tbody.querySelectorAll('tr.txn-row-hidden')); hidden.forEach(r => { r.classList.remove('txn-row-hidden'); r.style.display = ''; }); btn.closest('tr').style.display = 'none'; })(this);" style="padding: 8px 20px;">
            Show ${remainingRows.length} More Transactions
          </button>
        </td>
      `;
    tbody.appendChild(showMoreRow);

    // Add hidden class to remaining rows and keep them appended after the show-more row
    remainingRows.forEach(row => {
      row.classList.add('txn-row-hidden');
      row.style.display = 'none';
      tbody.appendChild(row);
    });
  }
}

/**
 * Triggers a cloud search for transactions within the specified date range
 */
async function searchTransactionsByRange() {
  const start = document.getElementById('transactionStartDate')?.value;
  const end = document.getElementById('transactionEndDate')?.value;
  if (!start && !end) return alert("Please select a date range.");
  const effectiveUid = getEffectiveUid();
  if (effectiveUid) await loadTransactionsFromCloud(effectiveUid, start, end);
}

async function downloadBillAsPDF(transactionIndex) {
  const transaction = transactions[transactionIndex];
  const receiptModal = document.getElementById('receiptModal');
  const originalDisplayStyle = receiptModal.style.display;

  // Temporarily make the modal visible but position it off-screen
  // so html2canvas can render it.
  receiptModal.style.position = 'absolute';
  receiptModal.style.left = '-9999px';
  receiptModal.style.display = 'flex';

  // 1. Populate the hidden receipt content with the data from the selected transaction.
  populateReceiptContent(transaction);
  // 2. Call the existing function that handles saving the currently loaded receipt.
  // This reuses the code and ensures identical functionality.
  await downloadCurrentReceiptAsPDF();

  // 3. Restore the modal's original state.
  receiptModal.style.display = originalDisplayStyle;
  receiptModal.style.position = 'fixed';
  receiptModal.style.left = '0';
}

/**
 * Populates the content of the receipt modal without displaying it.
 * This is a helper for PDF generation.
 */
function populateReceiptContent(transaction) {
  const { date, customerName, tableNo, items, total, subtotal, tax, discount, receiptType, paymentMethod, note, amountPaid } = transaction;
  const transactionId = new Date(date).getTime();
  const invoiceNumber = getInvoiceNumber(transaction);
  const currencySymbol = getCurrencySymbol();

  // Fallback for old transactions that might not have subtotal/tax saved
  const displaySubtotal = subtotal !== undefined ? subtotal : total; // If no tax info, assume total is subtotal
  const displayTax = tax !== undefined ? tax : 0;
  let logoUrl = sanitizeLogoUrl(settings.logo);

  const barcodeImgUrl = getBarcodeDataUrl(transactionId.toString());
  const barcodeHtml = barcodeImgUrl ? `<div style="text-align:center; margin: 20px 0;"><img src="${barcodeImgUrl}" style="width: 85%; max-height: 60px;"></div>` : '';

  const itemsHtml = items.map(o => {
    const notesHtml = o.notes ? `<br><small style="font-style: italic;">- ${o.notes}</small>` : '';
    return `
          <div class="item-row">
            <div class="col-name">${o.name} ${notesHtml}</div>
            <div class="col-qty">${o.qty}x</div>
            <div class="col-price"><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(o.price)}</div>
            <div class="col-total"><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(o.qty * o.price)}</div>
          </div>`;
  }).join('');

  let discountHtml = '';
  if (discount && discount.amount > 0) {
    const label = 'Discount';
    discountHtml = `<div class="summary-line"><span>${label}</span> <span>-<span class="currency-symbol">${currencySymbol}</span>${formatCurrency(discount.amount)}</span></div>`;
  }

  const taxHtml = (displayTax > 0)
    ? `<div class="summary-line"><span>Tax (${settings.taxRate}%)</span> <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(displayTax)}</span></div>`
    : '';

  // Add cache-buster for robust CORS handling in receipts
  let finalLogoUrl = logoUrl;
  if (finalLogoUrl && finalLogoUrl.startsWith('http') && navigator.onLine) {
    finalLogoUrl += (finalLogoUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
  }

  const logoHtml = finalLogoUrl ? `<img src="${finalLogoUrl}" crossorigin="anonymous" onerror="this.removeAttribute('crossorigin'); this.src='assets/icons/icon.png';" style="width:50px; height:50px; object-fit:contain;">` : '🧾';

  const isAdjustmentReceipt = receiptType === 'customerAdjustment';
  const isDebtReceipt = receiptType === 'customerDebtInvoice';
  const titleText = isAdjustmentReceipt ? 'CUSTOMER PAYMENT INVOICE' : isDebtReceipt ? 'CUSTOMER DEBT INVOICE' : 'TRANSACTION INVOICE';
  const customerLine = customerName ? `<div class="summary-line"><span>Customer</span> <span>${customerName}</span></div>` : '';
  const customerContactLine = (transaction.customerContact || transaction.contact) ? `<div class="summary-line"><span>Contact</span> <span>${transaction.customerContact || transaction.contact}</span></div>` : '';
  const customerAddressLine = (transaction.customerAddress || transaction.address) ? `<div class="summary-line"><span>Address</span> <span>${transaction.customerAddress || transaction.address}</span></div>` : '';
  const methodLine = paymentMethod ? `<div class="summary-line"><span>Method</span> <span>${paymentMethod}</span></div>` : '';
  const noteLine = note ? `<div class="summary-line"><span>Note</span> <span>${note}</span></div>` : '';
  const paidLine = amountPaid !== undefined ? `<div class="summary-line"><span>Amount Paid</span> <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(amountPaid)}</span></div>` : '';
  // show all adjustments (if any) for debt receipts or adjustments
  const adjustmentsArr = Array.isArray(transaction.adjustments) && transaction.adjustments.length
    ? transaction.adjustments
    : (transaction.lastAdjustment ? [transaction.lastAdjustment] : []);
  const adjustedLines = adjustmentsArr.map(adj => {
    const methodLabel = adj.method ? String(adj.method) : 'On Account';
    const adjAmount = parseFloat(adj.amount) || 0;
    const adjDate = adj.date ? new Date(adj.date).toLocaleDateString() : '';
    return `<div class="summary-line"><span>Adjusted (${methodLabel})</span> <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(adjAmount)} <small style="opacity:0.8;">${adjDate}</small></span></div>`;
  }).join('');
  const totalAmountLine = (isAdjustmentReceipt || isDebtReceipt) && transaction.totalAmount !== undefined
    ? `<div class="summary-line"><span>Total Amount</span> <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(transaction.totalAmount)}</span></div>`
    : '';
  const paidAmountLine = (isAdjustmentReceipt || isDebtReceipt) && transaction.amountPaid !== undefined
    ? `<div class="summary-line"><span>Paid Amount</span> <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(transaction.amountPaid)}</span></div>`
    : '';
  const balanceLine = (isAdjustmentReceipt || isDebtReceipt) && transaction.balance !== undefined
    ? `<div class="summary-line"><span>Balance</span> <span style="color:#dc3545; font-weight:bold;"><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(transaction.balance)}</span></div>`
    : '';
  const receiptHtml = `
        <div>
          <div class="receipt-header">
          <div class="logo">${logoHtml}</div>
          <h3>${settings.name || 'My Business'}</h3>
          <p>${settings.address || '123 Business Avenue, Suite 100'}</p>
        </div>
        <div class="receipt-details">
          <div><span>Invoice Type:</span> <span>${isAdjustmentReceipt ? 'Customer Adjustment' : 'Transaction'}</span></div>
          <div><span>Invoice No:</span> <span>${invoiceNumber}</span></div>
          <div><span>Transaction ID:</span> <span>${transactionId}</span></div>
          <div><span>Date:</span> <span>${new Date(date).toLocaleDateString()}</span></div>
          <div><span>Time:</span> <span>${new Date(date).toLocaleTimeString()}</span></div>
        </div>
        <div class="receipt-items">
          <div class="table-header"><div class="col-name">Item</div><div class="col-qty">Qty</div><div class="col-price">Price</div><div class="col-total">Total</div></div>
          ${itemsHtml}
        </div>
        <div class="receipt-summary">
          <div class="summary-line"><span>Subtotal</span> <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(displaySubtotal)}</span></div>
          ${customerLine}
          ${customerContactLine}
          ${customerAddressLine}
          ${methodLine}
          ${noteLine}
          ${totalAmountLine}
          ${paidLine}
          ${adjustedLines}
          ${balanceLine}
          ${taxHtml}
          ${discountHtml}
          <div class="summary-line total" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <span>TOTAL</span>
            <span style="display:flex; align-items:center; gap:10px; justify-content:flex-end;">
              ${ transaction.balance !== undefined && parseFloat(transaction.balance) === 0 ? `<span style="display:inline-flex; align-items:center; justify-content:center; padding:6px 12px; border-radius:14px; border:2px dashed rgba(40,167,69,0.55); color:#28a745; font-weight:700; font-size:0.78rem; letter-spacing:0.08em; background:rgba(40,167,69,0.06); text-transform: uppercase; box-shadow: inset 0 0 0 1px rgba(40,167,69,0.18);">INVOICE PAID FULLY</span>` : '' }
              <span><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(total)}</span>
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:0.82rem; opacity:0.78; letter-spacing:0.03em;">
            <span style="font-weight:700;">INVOICE</span>
            <span>${invoiceNumber} • ${new Date(date).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="receipt-footer"><p style="font-weight: bold; margin-bottom: 10px;">${titleText}</p>${barcodeHtml}<p class="promo">Get 10% off on your next visit!</p><p style="font-size:0.75em; margin-top:15px; opacity:0.5;">Power by YoShop POS</p></div>
        </div>`;
  document.getElementById('receiptContent').innerHTML = receiptHtml;
}

async function deleteTransaction(index) {
  const pin = await showAppPrompt("Enter Admin PIN to delete transaction:", "Admin PIN Required", "Admin PIN");
  const adminPin = settings.ShopAdminPIN || settings.managerPIN;
  if (!adminPin || pin !== adminPin) {
    await showAppAlert("Incorrect PIN. Access denied.", "Access Denied");
    return;
  }

  const confirmed = await showAppConfirm(`Are you sure you want to permanently delete this transaction? This action cannot be undone.`, "Delete Transaction", "Delete", "Cancel");
  if (!confirmed) return;

  const txToDelete = transactions[index];
  transactions.splice(index, 1);

  // Delete from Cloud Sub-collection
  const effectiveUid = getEffectiveUid();
  if (effectiveUid && dbFirestore) {
    const txRef = collection(dbFirestore, "users", effectiveUid, "transactions");
    const q = query(txRef, where("date", "==", txToDelete.date), where("total", "==", txToDelete.total));
    getDocs(q).then(snap => {
      snap.forEach(async (doc) => {
        await deleteDoc(doc.ref);
      });
    }).catch(e => console.error("Cloud delete failed:", e));
  }

  saveData();
  renderTransactions();
  updateDashboard();
  await showAppAlert("Transaction deleted.", "Deleted");
}
async function reopenTransaction(index) {
  const transactionToEdit = transactions[index];

  if (activeOrders[CART_ID] && activeOrders[CART_ID].items.length > 0) {
    await showAppAlert(`Cannot re-open this bill because the cart is currently occupied. Please clear the cart first.`, "Action Blocked");
    return;
  }

  const confirmed = await showAppConfirm(`This will move the transaction back to the active cart and delete the original bill record. Do you want to continue?`, "Reopen Transaction", "Continue", "Cancel");
  if (!confirmed) return;

  // Restore the order
  activeOrders[CART_ID] = {
    items: transactionToEdit.items,
    server: transactionToEdit.customerName
  };

  // Delete the old transaction
  transactions.splice(index, 1);
  saveData();
  updateDashboard();
  await showAppAlert(`Sale has been re-opened for editing.`, "Reopened");
  // Navigate user to the restored order
  showTab('menuTab', document.querySelector('nav button[onclick*="menuTab"]'));
}

// ===== Reports =====

// ===== Reports =====
function populateReportFilters() {
  const staffSelect = document.getElementById('reportStaffFilter');
  if (!staffSelect) return;

  // Always reset filters to "All" and default to Item Sales when opening the tab
  const dateInput = document.getElementById('reportDate');
  if (dateInput) dateInput.value = '';
  const reportTypeSelect = document.getElementById('reportType');
  if (reportTypeSelect) reportTypeSelect.value = 'itemSales';

  staffSelect.innerHTML = '<option value="">All Staff</option>';
  staff.filter(s => s.isActive !== false).forEach(member => {
    staffSelect.innerHTML += `<option value="${member.name}">${member.name}</option>`;
  });
  staffSelect.value = '';

  const catDropdown = document.getElementById('reportCategoryDropdown');
  if (catDropdown) {
    catDropdown.innerHTML = [...dishCategories, 'Uncategorized'].map(cat => `
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer; color:var(--text); font-size:0.9em;">
          <input type="checkbox" value="${cat}" checked onchange="renderReport()"> ${cat}
        </label>
      `).join('');
  }
}

function renderReport() {
  const reportType = document.getElementById('reportType').value;
  const outputContainer = document.getElementById('reportOutput');
  outputContainer.innerHTML = ''; // Clear previous report
  outputContainer.style.position = 'relative'; // Ensure relative positioning for watermark overlay

  const reportDate = document.getElementById('reportDate').value;
  const staffFilter = document.getElementById('reportStaffFilter').value;
  const showCards = document.getElementById('showReportCards')?.checked ?? true;
  const showCharts = document.getElementById('showReportCharts')?.checked ?? true;
  let postRender = null;
  const now = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  let filteredTransactions = transactions.filter(t => {
    if (reportDate) {
      const transactionDateStr = new Date(t.date).toISOString().split('T')[0];
      if (transactionDateStr !== reportDate) return false;
    }
    if (staffFilter && t.customerName !== staffFilter) return false;

    return true;
  });

  const selectedCategories = Array.from(document.querySelectorAll('#reportCategoryDropdown input:checked')).map(cb => cb.value);
  const hasCategoryFilter = selectedCategories.length > 0 && selectedCategories.length < (dishCategories.length + 1);

  if (hasCategoryFilter) {
    filteredTransactions = filteredTransactions.map(t => {
      const filteredItems = (t.items || []).filter(item => {
        const dish = menu.find(d => d.name === item.name);
        const cat = dish ? dish.category : 'Uncategorized';
        return selectedCategories.includes(cat);
      });

      if (filteredItems.length === 0) return null;

      const revenueForCats = filteredItems.reduce((sum, i) => sum + (i.qty * (i.price || 0)), 0);
      return { ...t, items: filteredItems, total: revenueForCats };
    }).filter(t => t !== null);
  }

  // Strict cache-buster and CORS handling for the logo
  let logoUrl = sanitizeLogoUrl(settings.logo);
  // Only add cache-buster if online to avoid breaking offline reports if URL is in cache
  if (logoUrl && logoUrl.startsWith('http') && navigator.onLine) {
    logoUrl += (logoUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
  }

  const brandingHeader = `
      <div class="report-branding-header" style="display: flex; align-items: center; gap: 20px; margin-bottom: 20px; border-bottom: 2px solid var(--primary); padding-bottom: 15px;">
        <img src="${logoUrl || 'assets/icons/icon.png'}" crossorigin="anonymous" onerror="this.removeAttribute('crossorigin'); this.src='assets/icons/icon.png';" style="width: 60px; height: 60px; object-fit: contain; border-radius: 8px; background: white; padding: 2px; border: 1px solid var(--border-color);" alt="Logo">
        <div style="flex-grow: 1;">
          <h2 style="margin: 0; color: var(--primary);">${settings.name || 'YoShop'}</h2>
          <p style="margin: 2px 0; font-size: 0.85em; opacity: 0.8;">${settings.address || ''}</p>
        </div>
        <div style="text-align: right; font-size: 0.75em; opacity: 0.6;">
          <p style="margin: 0; font-weight: bold; color: var(--primary);">OFFICIAL REPORT</p>
          <p style="margin: 2px 0 0 0;">Generated: ${now}</p>
        </div>
      </div>
    `;

  const watermarkHtml = `<div class="report-watermark" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 100px; color: rgba(150, 150, 150, 0.05); font-weight: bold; pointer-events: none; z-index: 0; white-space: nowrap; text-transform: uppercase;">CONFIDENTIAL</div>`;

  if (filteredTransactions.length === 0) {
    outputContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: #888;">No data available for the selected filters.</p>';
    return;
  }
  let reportHtml = '';

  if (reportType === 'salesSummary') {
    const totalRevenue = filteredTransactions.reduce((sum, t) => sum + (t.total || 0), 0);
    const totalBills = filteredTransactions.length;

    let totalCost = 0;
    const staffPerformance = {};
    const monthlyRevenueData = {};

    let totalPaid = 0;
    let totalDebtAdded = 0;
    let totalCreditAdded = 0;

    filteredTransactions.forEach(t => {
      const sName = t.customerName || 'Unknown';
      staffPerformance[sName] = (staffPerformance[sName] || 0) + (t.total || 0);

      if (t.date) {
        const month = t.date.substring(0, 7); // YYYY-MM
        monthlyRevenueData[month] = (monthlyRevenueData[month] || 0) + (t.total || 0);
      }

      // Add payment breakdown
      const amtPaid = t.amountPaid !== undefined ? t.amountPaid : (t.total || 0);
      totalPaid += amtPaid;
      
      const balChange = t.balanceChange || 0;
      if (balChange < 0) {
        totalDebtAdded += Math.abs(balChange);
      } else if (balChange > 0) {
        totalCreditAdded += balChange;
      }

      (t.items || []).forEach(item => {
        const menuDish = menu.find(d => d.name === item.name);
        const itemCost = menuDish ? calculateDishCost(menuDish) : (parseFloat(item.costPrice) || 0);
        totalCost += (itemCost * (item.qty || 0));
      });
    });

    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const avgBill = totalBills > 0 ? totalRevenue / totalBills : 0;

    const topStaffEntry = Object.entries(staffPerformance).sort((a, b) => b[1] - a[1])[0];
    const topStaffInfo = topStaffEntry ? `<p class="u-mt-10 u-bold" style="color: var(--primary); font-size: 0.9em;">🏆 Top Performing Staff: ${topStaffEntry[0]} (${settings.currency || '$'}${formatCurrency(topStaffEntry[1])})</p>` : '';

    const paymentMethods = filteredTransactions.reduce((acc, t) => {
      const method = t.paymentMethod || 'Unknown';
      acc[method] = (acc[method] || 0) + (t.total || 0);
      return acc;
    }, {});

    const cardsHtml = showCards ? `
        <div class="dashboard-grid u-mb-20">
          <div class="dashboard-card" style="border-left: 4px solid #28a745;">
            <h4>Total Sales</h4>
            <p><span class="currency-symbol">$</span>${formatCurrency(totalRevenue)}</p>
          </div>
          <div class="dashboard-card" style="border-left: 4px solid #17a2b8;">
            <h4>Net Profit</h4>
            <p><span class="currency-symbol">$</span>${formatCurrency(totalProfit)}</p>
          </div>
          <div class="dashboard-card" style="border-left: 4px solid #6f42c1;">
            <h4>Margin</h4>
            <p>${profitMargin.toFixed(1)}%</p>
          </div>
          <div class="dashboard-card" style="border-left: 4px solid #ffc107;">
            <h4>Avg. Bill</h4>
            <p><span class="currency-symbol">$</span>${formatCurrency(avgBill)}</p>
          </div>
        </div>` : '';

    const chartsHtml = showCharts ? `
        <div class="chart-wrapper u-mb-20" style="max-width: 100%; height: 300px;">
          <canvas id="staffRevenueChart"></canvas>
        </div>
        <div class="chart-wrapper u-mb-20" style="max-width: 100%; height: 300px;">
          <canvas id="monthlyRevenueChart"></canvas>
        </div>` : '';

    reportHtml = brandingHeader + watermarkHtml + `
        <div class="report-header-info u-mb-20">
          <h4 class="u-m-0">Financial Performance Summary</h4>
          <p class="u-fs-08 u-text-muted">Data Range: ${reportDate || 'All Time'} | ${totalBills} Transactions</p>
          ${topStaffInfo}
        </div>
        ${cardsHtml}
        ${chartsHtml}
        <div class="u-mb-20" style="display: flex; gap: 20px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 280px;">
            <h5>Collected by Payment Method</h5>
            <table id="reportTable">
              <thead>
                <tr><th class="u-text-center">Method</th><th class="u-text-center">Total Revenue</th><th class="u-text-center">% Share</th></tr>
              </thead>
              <tbody>
                ${Object.entries(paymentMethods).map(([method, total]) => `
                  <tr>
                    <td>${method}</td>
                    <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(total)}</td>
                    <td class="u-text-right">${((total / totalRevenue) * 100).toFixed(1)}%</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot>
                <tr class="u-bold">
                  <td>ToTal</td>
                  <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalRevenue)}</td>
                  <td class="u-text-right">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style="flex: 1; min-width: 280px;">
            <h5>Customer Accounts Summary</h5>
            <table>
              <thead>
                <tr><th class="u-text-center">Metric</th><th class="u-text-center">Amount</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Total Sales (Revenue)</td>
                  <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalRevenue)}</td>
                </tr>
                <tr>
                  <td>Total Payments Received</td>
                  <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalPaid)}</td>
                </tr>
                <tr>
                  <td>New Debt Accumulated</td>
                  <td class="u-text-right" style="color: #dc3545; font-weight: bold;"><span class="currency-symbol">$</span>${formatCurrency(totalDebtAdded)}</td>
                </tr>
                <tr>
                  <td>New Credit Accumulated</td>
                  <td class="u-text-right" style="color: #28a745; font-weight: bold;"><span class="currency-symbol">$</span>${formatCurrency(totalCreditAdded)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>`;

    if (showCharts) {
      postRender = () => {
        renderStaffRevenueChart(staffPerformance);
        renderMonthlyRevenueChart(monthlyRevenueData);
      };
    }

  } else if (reportType === 'itemSales') {
    const threshold = (settings.lowStockThreshold !== undefined && settings.lowStockThreshold !== null) ? settings.lowStockThreshold : 10;
    const itemSales = {};

    // Initialize with all sellable products from the menu to show products even with 0 sales
    menu.forEach(dish => {
      const isSellable = (dish.recipe && dish.recipe.length > 0) || (parseFloat(dish.price) > 0 && dish.category);
      if (!isSellable) return;

      const itemCost = calculateDishCost(dish);
      itemSales[dish.name] = {
        qty: 0, revenue: 0, cost: 0,
        bp: itemCost, sp: dish.price || 0,
        inStock: calculateDishStock(dish, true)
      };
    });

    // Accumulate sales data from filtered transactions
    filteredTransactions.flatMap(t => t.items || []).forEach(item => {
      if (!itemSales[item.name]) {
        const menuDish = menu.find(d => d.name === item.name);
        const itemCost = menuDish ? calculateDishCost(menuDish) : (parseFloat(item.costPrice) || 0);
        itemSales[item.name] = {
          qty: 0, revenue: 0, cost: 0,
          bp: itemCost, sp: item.price || 0,
          inStock: menuDish ? calculateDishStock(menuDish, true) : 0
        };
      }
      itemSales[item.name].qty += (item.qty || 0);
      itemSales[item.name].revenue += (item.qty || 0) * (item.price || 0);
      itemSales[item.name].cost += (item.qty || 0) * itemSales[item.name].bp;
    });

    const sortedItems = Object.entries(itemSales).sort(([, a], [, b]) => b.revenue - a.revenue);

    const totalRevenue = Object.values(itemSales).reduce((sum, d) => sum + d.revenue, 0);
    const totalCost = Object.values(itemSales).reduce((sum, d) => sum + d.cost, 0);
    const totalProfitVal = totalRevenue - totalCost;
    const avgMargin = totalRevenue > 0 ? (totalProfitVal / totalRevenue) * 100 : 0;

    let totalSold = 0;
    let totalStock = 0;
    let totalBP = 0;
    let totalSP = 0;
    let grossTotalTP = 0;
    let totalProfit = 0;

    let topProfitItem = { name: 'N/A', val: 0 };
    let topMarginItem = { name: 'N/A', val: 0 };

    const tableBody = sortedItems.map(([name, data], idx) => {
      const itemProfit = data.revenue - data.cost;
      const itemMargin = data.sp > 0 ? ((data.sp - data.bp) / data.sp) * 100 : 0;

      if (itemProfit > topProfitItem.val) { topProfitItem = { name, val: itemProfit }; }
      if (itemMargin > topMarginItem.val) { topMarginItem = { name, val: itemMargin }; }

      totalSold += data.qty;
      totalStock += data.inStock;
      totalBP += data.bp;
      totalSP += data.sp;
      grossTotalTP += data.revenue;
      totalProfit += itemProfit;

      const isLowStock = data.inStock <= threshold;
      const stockStyle = isLowStock ? 'color: #dc3545; font-weight: bold;' : '';

      return `
          <tr>
            <td>${idx + 1}</td>
            <td>${name}</td>
            <td class="u-text-right" style="${stockStyle}">${data.inStock}</td>
            <td class="u-text-right">${data.qty}</td>
            <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(data.bp)}</td>
            <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(data.sp)}</td>
            <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(data.revenue)}</td>
            <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(itemProfit)}</td>
          </tr>`;
    }).join('');

    if (showCharts) {
      postRender = () => {
        const marginData = sortedItems.map(([name, data]) => ({
          name,
          margin: data.sp > 0 ? ((data.sp - data.bp) / data.sp) * 100 : 0
        })).sort((a, b) => b.margin - a.margin).slice(0, 10);
        renderReportProfitChart(marginData);
      };
    }

    const cardsHtml = showCards ? `
        <div class="dashboard-grid u-mb-20">
          <div class="dashboard-card" style="border-left: 4px solid #28a745;">
            <h4>Total Profit</h4>
            <p><span class="currency-symbol">$</span>${formatCurrency(totalProfitVal)}</p>
          </div>
          <div class="dashboard-card" style="border-left: 4px solid #6f42c1;">
            <h4>Avg. Margin</h4>
            <p>${avgMargin.toFixed(1)}%</p>
          </div>
          <div class="dashboard-card" style="border-left: 4px solid #17a2b8;">
            <h4>Top Earner</h4>
            <p style="font-size: 0.75em; color: var(--text);">${topProfitItem.name}</p>
          </div>
          <div class="dashboard-card" style="border-left: 4px solid #ffc107;">
            <h4>Highest Margin</h4>
            <p style="font-size: 0.75em; color: var(--text);">${topMarginItem.name} (${topMarginItem.val.toFixed(1)}%)</p>
          </div>
        </div>` : '';

    const chartsHtml = showCharts ? `
        <div class="chart-wrapper u-mb-20" style="max-width: 100%; height: 350px;">
          <canvas id="reportProfitChart"></canvas>
        </div>` : '';

    reportHtml = brandingHeader + watermarkHtml + `
        <div class="report-header-info u-mb-20">
          <h4 class="u-m-0">Product Sales vs Inventory</h4>
          <p class="u-fs-08 u-text-muted">Tracking quantities sold against remaining stock levels</p>
        </div>
        ${cardsHtml}
        ${chartsHtml}
        <table id="reportTable">
          <thead>
            <tr>
              <th class="u-text-center">S/N</th>
              <th class="u-text-center">ITEM</th>
              <th class="u-text-center">STOCK</th>
              <th class="u-text-center">SOLD</th>
              <th class="u-text-center">Buying Price</th>
              <th class="u-text-center">Selling Price</th>
              <th class="u-text-center">Total Price</th>
              <th class="u-text-center">PROFIT</th>
            </tr>
          </thead>
          <tbody>${tableBody}</tbody>
          <tfoot>
            <tr class="u-bold">
              <td colspan="2">ToTal</td>
              <td class="u-text-right">${totalStock}</td>
              <td class="u-text-right">${totalSold}</td>
              <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalBP)}</td>
              <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalSP)}</td>
              <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(grossTotalTP)}</td>
              <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalProfit)}</td>
            </tr>
          </tfoot>
        </table>`;

  } else if (reportType === 'categorySales') {
    let totalQty = 0;
    let totalRev = 0;
    let totalProfit = 0;

    const categorySales = filteredTransactions.flatMap(t => t.items || []).reduce((acc, item) => {
      const dish = menu.find(d => d.name === item.name);
      const category = dish ? dish.category : 'Uncategorized';
      if (!acc[category]) acc[category] = { qty: 0, revenue: 0, cost: 0 };
      const menuDish = menu.find(d => d.name === item.name);
      const itemCost = menuDish ? calculateDishCost(menuDish) : (parseFloat(item.costPrice) || 0);
      acc[category].qty += (item.qty || 0);
      acc[category].revenue += (item.qty || 0) * (item.price || 0);
      acc[category].cost += (item.qty || 0) * itemCost;
      return acc;
    }, {});

    const sortedCategories = Object.entries(categorySales).sort(([, a], [, b]) => b.revenue - a.revenue);

    const tableBody = sortedCategories.map(([name, data]) => {
      const profit = data.revenue - data.cost;
      const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
      totalQty += data.qty;
      totalRev += data.revenue;
      totalProfit += profit;
      return `
          <tr>
            <td>${name}</td>
            <td class="u-text-right">${data.qty}</td>
            <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(data.revenue)}</td>
            <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(profit)}</td>
            <td class="u-text-right">${margin.toFixed(1)}%</td>
          </tr>`;
    }).join('');

    const totalMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;

    reportHtml = brandingHeader + watermarkHtml + `
        <div class="report-header-info u-mb-20">
          <h4 class="u-m-0">Category Sales & Profitability</h4>
          <p class="u-fs-08 u-text-muted">Performance breakdown per category</p>
        </div>
        <table id="reportTable">
          <thead>
            <tr>
              <th class="u-text-center">Category</th>
              <th class="u-text-center">Units</th>
              <th class="u-text-center">Revenue</th>
              <th class="u-text-center">Profit</th>
              <th class="u-text-center">Margin</th>
            </tr>
          </thead>
          <tbody>${tableBody}</tbody>
          <tfoot>
            <tr class="u-bold">
              <td>ToTal</td>
              <td class="u-text-right">${totalQty}</td>
              <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalRev)}</td>
              <td class="u-text-right"><span class="currency-symbol">$</span>${formatCurrency(totalProfit)}</td>
              <td class="u-text-right">${totalMargin.toFixed(1)}%</td>
            </tr>
          </tfoot>
        </table>`;
  }

  outputContainer.innerHTML = reportHtml;
  updateCurrencyDisplay();
  if (postRender) postRender();
}

function openReportPreview() {
  const original = document.getElementById('reportOutput');
  if (!original || original.innerHTML.trim() === '' || original.innerText.includes('No data available')) {
    return alert("Please generate a report first.");
  }
  const previewContent = document.getElementById("reportPreviewContent");
  previewContent.innerHTML = "";

  // Add Interactive Zoom Controls
  const controls = document.createElement('div');
  controls.className = 'zoom-controls';
  controls.style.cssText = 'position:sticky; top:0; z-index:100; display:flex; gap:10px; padding:15px; justify-content:center; width:100%; background:rgba(255,255,255,0.9); border-bottom:1px solid #ddd; backdrop-filter:blur(5px);';
  controls.innerHTML = `
      <button class="btn btn-secondary" onclick="changeReportZoom(-0.1)" style="margin:0; width:45px; height:45px; border-radius:50%; font-size:1.5em; font-weight:bold;">-</button>
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:80px;">
        <span style="font-size:0.7em; text-transform:uppercase; color:#666; font-weight:bold;">Zoom</span>
        <span id="zoom-percentage" style="font-weight:bold; color:var(--primary);">100%</span>
      </div>
      <button class="btn btn-secondary" onclick="changeReportZoom(0.1)" style="margin:0; width:45px; height:45px; border-radius:50%; font-size:1.5em; font-weight:bold;">+</button>
      <button class="btn btn-info u-fs-08" onclick="changeReportZoom(1 - reportZoomLevel)" style="margin:0; margin-left:15px; border-radius:20px; padding:0 15px;">Reset</button>
    `;
  previewContent.appendChild(controls);

  const zoomWrapper = document.createElement('div');
  zoomWrapper.id = 'preview-zoom-wrapper';

  // Deep clone the report
  const clone = original.cloneNode(true);
  clone.style.width = '100%';

  // Canvas contents (Charts) are not copied by cloneNode. We must copy them manually.
  const originalCanvases = original.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  originalCanvases.forEach((origCanvas, index) => {
    const destCanvas = clonedCanvases[index];
    destCanvas.width = origCanvas.width;
    destCanvas.height = origCanvas.height;
    destCanvas.getContext('2d').drawImage(origCanvas, 0, 0);
  });

  zoomWrapper.appendChild(clone);
  previewContent.appendChild(zoomWrapper);

  // Initialize zoom state
  window.reportZoomLevel = 1;

  document.getElementById("reportPreviewModal").style.display = "flex";
  // Add keyboard handlers for report preview zoom when modal is open
  (function attachReportPreviewKeyboard() {
    const onKey = (e) => {
      try {
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); changeReportZoom(0.1); }
        if (e.ctrlKey && e.key === '-') { e.preventDefault(); changeReportZoom(-0.1); }
      } catch (err) { }
    };
    document.addEventListener('keydown', onKey);
  })();
}

function changeReportZoom(delta) {
  window.reportZoomLevel = Math.max(0.4, Math.min(2.0, (window.reportZoomLevel || 1) + delta));
  const wrapper = document.getElementById('preview-zoom-wrapper');
  const display = document.getElementById('zoom-percentage');
  if (wrapper) {
    wrapper.style.transform = `scale(${window.reportZoomLevel})`;
    if (display) display.textContent = Math.round(window.reportZoomLevel * 100) + '%';

    // Maintain scrollability by adding bottom margin equal to the overflow created by scaling
    const extraHeight = wrapper.offsetHeight * (window.reportZoomLevel - 1);
    wrapper.style.marginBottom = (extraHeight > 0 ? extraHeight + 40 : 20) + 'px';
  }
}

function toggleReportCategoryDropdown() {
  const dropdown = document.getElementById('reportCategoryDropdown');
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function toggleReportOptionsDropdown() {
  const dropdown = document.getElementById('reportOptionsDropdown');
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

async function downloadReportPDF(orientation = 'p') {
  if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    alert("PDF libraries are not loaded.");
    return;
  }
  const reportOutput = document.getElementById('reportOutput');
  if (!reportOutput || reportOutput.innerText.trim() === '' || reportOutput.innerText.includes('No data available')) {
    return alert("Please generate a report first.");
  }
  const { jsPDF } = window.jspdf;
  const reportType = document.getElementById('reportType').value;
  const reportDate = document.getElementById('reportDate').value || new Date().toISOString().split('T')[0];

  // Create a robust capture clone to avoid clipping on mobile screen widths
  const clone = reportOutput.cloneNode(true);

  // Canvas contents (Charts) are not copied by cloneNode. We must copy them manually.
  const originalCanvases = reportOutput.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  originalCanvases.forEach((origCanvas, index) => {
    const destCanvas = clonedCanvases[index];
    if (destCanvas) {
      destCanvas.width = origCanvas.width;
      destCanvas.height = origCanvas.height;
      destCanvas.getContext('2d').drawImage(origCanvas, 0, 0);
    }
  });

  // Force a desktop-like width for capture to ensure all columns fit
  const captureWidth = orientation === 'p' ? 850 : 1200;
  clone.style.width = captureWidth + 'px';
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.padding = '40px';
  clone.style.background = 'white';
  clone.style.color = 'black';
  document.body.appendChild(clone);

  try {
    const canvas = await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff'
    });
    document.body.removeChild(clone);

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF(orientation, 'mm', 'a4');

    const imgWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    // Add the first page
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Loop to add extra pages if the report is longer than one A4 page
    while (heightLeft > 0) {
      position -= pageHeight; // Move the image "up" for the next page slice
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`YoShop_Report_${reportType}_${reportDate}.pdf`);
  } catch (error) {
    console.error("Error generating PDF:", error);
    if (clone.parentNode) document.body.removeChild(clone);
    alert("Could not generate PDF. Please try again.");
  }
}

async function exportReportAsImage() {
  if (typeof html2canvas === 'undefined') {
    alert("Image library not loaded.");
    return;
  }
  const reportOutput = document.getElementById('reportOutput');
  if (!reportOutput || reportOutput.innerText.trim() === '' || reportOutput.innerText.includes('No data available')) {
    return alert("Please generate a report first.");
  }
  const clone = reportOutput.cloneNode(true);

  // Copy canvas data for charts to show in the exported image
  const originalCanvases = reportOutput.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  originalCanvases.forEach((origCanvas, index) => {
    const destCanvas = clonedCanvases[index];
    if (destCanvas) {
      destCanvas.width = origCanvas.width;
      destCanvas.height = origCanvas.height;
      destCanvas.getContext('2d').drawImage(origCanvas, 0, 0);
    }
  });

  clone.style.width = '1200px';
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.padding = '40px';
  clone.style.background = 'white';
  clone.style.color = 'black';
  document.body.appendChild(clone);
  try {
    const canvas = await html2canvas(clone, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    document.body.removeChild(clone);
    const link = document.createElement('a');
    const reportType = document.getElementById('reportType').value;
    const reportDate = document.getElementById('reportDate').value || new Date().toISOString().split('T')[0];
    link.download = `YoShop_Report_${reportType}_${reportDate}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    console.error("Error generating image:", error);
    if (clone.parentNode) document.body.removeChild(clone);
    alert("Could not generate report image.");
  }
}

function exportReportToCSV() {
  const table = document.getElementById('reportTable');
  if (!table) return alert("Please generate a report first.");

  let csvContent = "data:text/csv;charset=utf-8,";

  // Header
  const headers = Array.from(table.querySelectorAll('thead th')).map(th => `"${th.innerText}"`).join(",");
  csvContent += headers + "\r\n";

  // Body
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(tr => {
    const row = Array.from(tr.querySelectorAll('td')).map(td => `"${td.innerText.replace(/[$]|,/g, '').trim()}"`).join(",");
    csvContent += row + "\r\n";
  });

  // Footer
  const footer = table.querySelector('tfoot tr');
  if (footer) {
    const footerRow = Array.from(footer.querySelectorAll('td')).map(td => `"${td.innerText.replace(/[$]|,/g, '').trim()}"`).join(",");
    csvContent += footerRow + "\r\n";
  }

  const reportType = document.getElementById('reportType').value;
  const reportDate = document.getElementById('reportDate').value || new Date().toISOString().split('T')[0];
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `report_${reportType}_${reportDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ===== Dashboard =====
let categoryChartInstance;
let bestSellingItemsChartInstance;
let dailySalesChartInstance;
let adminGlobalRevenueChartInstance;
let adminShopsComparisonChartInstance;
let adminPaymentMethodsChartInstance;
let adminShopsStatusChartInstance;
let staffRevenueChartInstance;
let reportProfitChartInstance;
let monthlyRevenueChartInstance;

let dashboardDateFilterMode = 'all';

function updateQuickFilterButtons(selected) {
  document.querySelectorAll('.dashboard-filter-buttons button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === selected);
  });
}

function setDashboardFilter(filter) {
  dashboardDateFilterMode = filter;
  const fromInput = document.getElementById('dashboardFromDate');
  const toInput = document.getElementById('dashboardToDate');
  const now = new Date();
  const todayValue = now.toISOString().split('T')[0];

  if (filter === 'today') {
    if (fromInput) fromInput.value = todayValue;
    if (toInput) toInput.value = todayValue;
  } else if (filter === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayValue = yesterday.toISOString().split('T')[0];
    if (fromInput) fromInput.value = yesterdayValue;
    if (toInput) toInput.value = yesterdayValue;
  } else if (filter === '7d') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    if (fromInput) fromInput.value = start.toISOString().split('T')[0];
    if (toInput) toInput.value = todayValue;
  } else if (filter === '30d') {
    const start = new Date(now);
    start.setDate(now.getDate() - 29);
    if (fromInput) fromInput.value = start.toISOString().split('T')[0];
    if (toInput) toInput.value = todayValue;
  } else {
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
  }

  updateQuickFilterButtons(filter);
  updateDashboard();
}

function applyDashboardDateFilter() {
  dashboardDateFilterMode = 'custom';
  updateQuickFilterButtons('custom');
  updateDashboard();
}

function getDashboardDateRange() {
  const fromValue = document.getElementById('dashboardFromDate')?.value;
  const toValue = document.getElementById('dashboardToDate')?.value;
  let startDate = fromValue ? new Date(fromValue) : null;
  let endDate = toValue ? new Date(toValue) : null;
  if (startDate && Number.isNaN(startDate.getTime())) startDate = null;
  if (endDate && !Number.isNaN(endDate.getTime())) {
    endDate.setHours(23, 59, 59, 999);
  } else {
    endDate = null;
  }
  return { startDate, endDate };
}

function getFilteredDashboardTransactions() {
  const { startDate, endDate } = getDashboardDateRange();
  const allTx = deduplicateTransactions(Array.isArray(transactions) ? transactions : []);
  return allTx.filter(tx => {
    const txDate = new Date(tx.date);
    if (Number.isNaN(txDate.getTime())) return false;
    if (startDate && txDate < startDate) return false;
    if (endDate && txDate > endDate) return false;
    return true;
  });
}

function initializeDashboardFilters() {
  updateQuickFilterButtons(dashboardDateFilterMode);
}

function updateDashboard() {
  // Initialize with defaults even if data is not yet loaded
  // This ensures the dashboard always shows cards with 0 values
  if (!menu) menu = [];
  if (!transactions) transactions = [];

  menu = normalizeProductCatalog(Array.isArray(menu) ? menu : []);
  transactions = deduplicateTransactions(Array.isArray(transactions) ? transactions : []);
  const filteredTransactions = getFilteredDashboardTransactions();
  const allProducts = getCanonicalProductCatalog(Array.isArray(menu) ? menu : [], { includeOnlySellable: true });
  const categoriesForDashboard = new Set([
    ...allProducts.map(d => d && d.category).filter(Boolean),
    ...(Array.isArray(dishCategories) ? dishCategories : []).filter(Boolean)
  ]);

  document.getElementById('menuCount').textContent = allProducts.length;
  document.getElementById('uniqueCategoriesCount').textContent = categoriesForDashboard.size;

  // Calculate total stock value (cost of all raw ingredients)
  const totalStockValue = menu
    .filter(item => item.stock !== undefined) // Filter for items with a stock property (raw ingredients)
    .reduce((sum, item) => sum + (item.stock * (item.costPrice || 0)), 0);

  // Calculate total revenue and total cost of goods sold (COGS) from filtered transactions
  const totalRevenue = filteredTransactions.reduce((sum, t) => sum + (t.total || 0), 0);
  const totalCost = filteredTransactions.reduce((sum, t) => {
    const transactionCost = (t.items || []).reduce((itemSum, item) => {
      const dish = menu.find(d => d.name === item.name);
      return itemSum + ((dish ? dish.costPrice : 0) * (item.qty || 0));
    }, 0);
    return sum + transactionCost;
  }, 0);

  const profitMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
  const netProfit = totalRevenue - totalCost;
  const totalBills = filteredTransactions.length;
  const debtSummary = summarizeDebtInvoices({
    customers: Array.isArray(customers) ? customers : [],
    transactions: Array.isArray(transactions) ? transactions : []
  });
  const outstandingDebt = debtSummary.outstandingDebt;
  const pendingInvoices = debtSummary.pendingInvoices;

  // Always update dashboard cards (even with 0 values)
  document.getElementById('stockValue').textContent = formatCurrency(totalStockValue);
  document.getElementById('profitPercentage').textContent = profitMargin.toFixed(2);
  document.getElementById('netProfit').textContent = formatCurrency(netProfit);
  document.getElementById('totalRevenue').textContent = formatCurrency(totalRevenue);
  document.getElementById('totalBills').textContent = totalBills;
  document.getElementById('outstandingDebt').textContent = formatCurrency(outstandingDebt);
  document.getElementById('pendingInvoices').textContent = pendingInvoices;
  const avgOrderValue = totalBills > 0 ? totalRevenue / totalBills : 0;
  document.getElementById('avgOrderValue').textContent = formatCurrency(avgOrderValue);

  updateCurrencyDisplay();

  // Render charts - they will show empty/zero state if no data
  try {
    renderDashboardChart();
    renderBestSellingItemsChart(filteredTransactions);
    renderDailySalesChart(filteredTransactions);
  } catch (error) {
    console.error('Error rendering dashboard charts:', error);
  }
}

window.updateDashboard = updateDashboard;
window.setDashboardFilter = setDashboardFilter;
window.applyDashboardDateFilter = applyDashboardDateFilter;

function renderBestSellingItemsChart(sourceTransactions = transactions) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('bestSellingItemsChart').getContext('2d');

  // Safely handle empty transactions
  const itemSales = (sourceTransactions && sourceTransactions.length > 0)
    ? sourceTransactions.flatMap(t => t.items || []).reduce((acc, item) => {
      acc[item.name] = (acc[item.name] || 0) + (item.qty || 0);
      return acc;
    }, {})
    : {};

  const sortedItems = Object.entries(itemSales).sort(([, a], [, b]) => b - a).slice(0, 5);
  const labels = sortedItems.map(([name]) => name);
  const data = sortedItems.map(([, qty]) => qty);

  if (bestSellingItemsChartInstance) {
    bestSellingItemsChartInstance.destroy();
  }

  // Always render chart, even with empty data (shows zero state)
  bestSellingItemsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No data yet'],
      datasets: [{
        label: 'Top 5 Best-Selling Items',
        data: data.length > 0 ? data : [0],
        backgroundColor: '#3d5a80',
      }]
    },
    options: {
      indexAxis: 'y',
      scales: { x: { beginAtZero: true } },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Top 5 Best-Selling Items'
        },
        tooltip: {
          enabled: data.length > 0
        }
      }
    }
  });
}

function renderStaffRevenueChart(data) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('staffRevenueChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (staffRevenueChartInstance) {
    staffRevenueChartInstance.destroy();
  }

  const sortedData = Object.entries(data).sort(([, a], [, b]) => b - a);
  const labels = sortedData.map(([name]) => name);
  const values = sortedData.map(([, val]) => val);

  staffRevenueChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Revenue',
        data: values,
        backgroundColor: '#3d5a80',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Revenue Comparison by Staff Member' }
      }
    }
  });
}

function renderReportProfitChart(data) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('reportProfitChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (reportProfitChartInstance) {
    reportProfitChartInstance.destroy();
  }

  reportProfitChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        label: 'Profit Margin %',
        data: data.map(d => d.margin),
        backgroundColor: '#6f42c1',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (value) => value + '%' }
        }
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Top 10 Product Profit Margins (%)' }
      }
    }
  });
}

function renderMonthlyRevenueChart(data) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('monthlyRevenueChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (monthlyRevenueChartInstance) {
    monthlyRevenueChartInstance.destroy();
  }

  const labels = Object.keys(data).sort();
  const values = labels.map(label => data[label]);

  monthlyRevenueChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Revenue',
        data: values,
        borderColor: '#ff6b35',
        backgroundColor: 'rgba(255, 107, 53, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Monthly Revenue Trend' }
      },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderDailySalesChart(sourceTransactions = transactions) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('dailySalesChart').getContext('2d');

  // Safely handle empty transactions
  const salesByDay = (sourceTransactions && sourceTransactions.length > 0)
    ? sourceTransactions.reduce((acc, t) => {
      const date = new Date(t.date).toLocaleDateString();
      acc[date] = (acc[date] || 0) + (t.total || 0);
      return acc;
    }, {})
    : {};

  const labels = Object.keys(salesByDay).reverse();
  const data = Object.values(salesByDay).reverse();

  if (dailySalesChartInstance) {
    dailySalesChartInstance.destroy();
  }

  // Always render chart, even with empty data (shows zero state)
  dailySalesChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No data yet'],
      datasets: [{ label: 'Daily Sales', data: data.length > 0 ? data : [0], backgroundColor: '#ff6b35' }]
    },
    options: {
      scales: { y: { beginAtZero: true } },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Daily Sales'
        },
        tooltip: {
          enabled: data.length > 0
        }
      }
    }
  });
}
function renderDashboardChart() {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('categoryChart').getContext('2d');

  // Only count items that have a category assigned.
  // Safely handle when menu is empty or not initialized
  const categoryCounts = (menu && menu.length > 0)
    ? menu.filter(dish => dish.category).reduce((acc, dish) => {
      if (dish.category) {
        acc[dish.category] = (acc[dish.category] || 0) + 1;
      }
      return acc;
    }, {})
    : {};

  const labels = Object.keys(categoryCounts);
  const data = Object.values(categoryCounts);

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  // Always render chart, even with empty data (shows zero state)
  categoryChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No data yet'],
      datasets: [{
        label: 'Products by Category',
        data: data.length > 0 ? data : [0],
        backgroundColor: ['#ff6b35', '#f7c59f', '#7dcdb8', '#3d5a80', '#98c1d9'],
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          display: false
        },
        title: {
          display: true,
          text: 'Products by Category'
        },
        tooltip: {
          enabled: data.length > 0
        }
      }
    }
  });
}

function renderAdminGlobalRevenueChart(revenuePerDay) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('adminGlobalRevenueChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels = Object.keys(revenuePerDay).sort((a, b) => new Date(a) - new Date(b));
  const data = labels.map(label => revenuePerDay[label]);

  if (adminGlobalRevenueChartInstance) adminGlobalRevenueChartInstance.destroy();

  adminGlobalRevenueChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Global Daily Revenue',
        data: data,
        borderColor: '#ff6b35',
        backgroundColor: 'rgba(255, 107, 53, 0.1)',
        tension: 0.1,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
      plugins: {
        title: { display: true, text: 'Global Daily Revenue', font: { size: 14 } },
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      }
    }
  });
}

function renderAdminShopsComparisonChart(revenuePerShop) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('adminShopsComparisonChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const sorted = Object.entries(revenuePerShop).sort(([, a], [, b]) => b - a).slice(0, 10);
  const labels = sorted.map(([name]) => name);
  const data = sorted.map(([, revenue]) => revenue);

  if (adminShopsComparisonChartInstance) adminShopsComparisonChartInstance.destroy();

  adminShopsComparisonChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: 'Revenue per Shop', data: data, backgroundColor: '#3d5a80' }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { beginAtZero: true } },
      plugins: { title: { display: true, text: 'Top 10 Shops by Revenue', font: { size: 13 } }, legend: { display: false } }
    }
  });
}

// ===== Settings =====
async function saveSettings() {
  const pin = document.getElementById('ShopAdminPIN').value;
  const confirmPin = document.getElementById('confirmShopAdminPIN').value;

  // Enforce exactly 4 numeric digits
  if (pin.length !== 4 || !/^\d+$/.test(pin)) {
    return alert("ShopAdmin PIN must be exactly 4 numeric digits.");
  }

  // Match confirmation field
  if (pin !== confirmPin) {
    return alert("ShopAdmin PINs do not match. Please verify and try again.");
  }

  settings.name = document.getElementById('companyName').value;
  settings.address = document.getElementById('companyAddress').value;
  settings.contact = document.getElementById('companyContact').value;
  settings.currency = document.getElementById('currency').value;
  const lowStockThresholdVal = parseInt(document.getElementById('lowStockThreshold').value, 10);
  settings.lowStockThreshold = isNaN(lowStockThresholdVal) ? 10 : lowStockThresholdVal;
  settings.defaultMarkup = parseFloat(document.getElementById('defaultMarkup').value) || 200;
  settings.taxRate = parseFloat(document.getElementById('taxRate').value) || 0;
  settings.ShopAdminPIN = pin;

  const logoFile = document.getElementById('companyLogo').files[0];
  if (logoFile) {
    const base64Logo = await toBase64(logoFile);
    const oldLogo = settings.logo;
    settings.logo = await uploadImage(base64Logo, 'branding/logo.jpg');
    if (oldLogo && oldLogo !== settings.logo) {
      clearImageFromCache(oldLogo);
    }
    if (settings.logo) {
      clearImageFromCache(settings.logo);
    }
  }

  settings = touchSettingsRecord(settings, 'settings');

  saveData();
  alert('Settings saved!');
  loadSettings(); // Reload to show preview

  // --- Re-render all relevant sections to reflect currency change ---
  updateDashboard();
  renderMenu();
  renderDishesTable();
  renderInventoryReport();
  renderStockListTable();
  renderTransactions();
  renderReport();
  updateCurrencyDisplay(); // Call this AFTER all sections are re-rendered
}

function loadSettings() {
  if (currentUser) {
    const emailEl = document.getElementById('display-user-email');
    if (emailEl) emailEl.textContent = currentUser.email;

    const providers = currentUser.providerData.map(p => p.providerId);
    const isEmailUser = providers.includes('password');
    const isGoogleUser = providers.includes('google.com');

    const badgeContainer = document.getElementById('auth-provider-badges');
    if (badgeContainer) {
      badgeContainer.innerHTML = `
          ${isGoogleUser ? '<span style="background: #4285F4; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em;">Google</span>' : ''}
          ${isEmailUser ? '<span style="background: #28a745; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em;">Password</span>' : ''}
        `;
    }

    const changeBtn = document.getElementById('change-password-btn');
    const linkBtn = document.getElementById('link-password-btn');
    if (changeBtn) changeBtn.style.display = isEmailUser ? 'block' : 'none';
    if (linkBtn) linkBtn.style.display = (isGoogleUser && !isEmailUser) ? 'block' : 'none';
    // Check for admin notices targeted at this shop and surface them to the owner
    try { if (typeof window.checkForAdminNoticeForCurrentShop === 'function') { window.checkForAdminNoticeForCurrentShop(); } else if (typeof checkForAdminNoticeForCurrentShop === 'function') { checkForAdminNoticeForCurrentShop(); } } catch (e) { /* non-blocking */ }
  }

function closeNoticesPage() {
  const page = document.getElementById('noticesPage');
  if (page) page.style.display = 'none';
  document.querySelectorAll('main, section, [data-page]').forEach(el => {
    if (el.id !== 'noticesPage') el.style.display = '';
  });
  const activeTabBtn = document.querySelector('nav button.active');
  if (activeTabBtn) activeTabBtn.click();
}

async function checkForAdminNoticeForCurrentShop() {
  if (!currentUser || !dbFirestore) return;
  try {
    const docRef = doc(dbFirestore, 'users', currentUser.uid, 'data', 'shop_profile');
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const shopData = snap.data() || {};
    const adminSettings = shopData.appAdminSettings || {};
    const notice = (adminSettings.noticeMessage || '').toString().trim();
    const sentAt = adminSettings.noticeSentAt || adminSettings.noticeAt || null;
    if (!notice) return;

    const serverSeenAt = adminSettings.lastNoticeReadAt || null;
    const key = `lastAdminNoticeSeen_${currentUser.uid}`;
    const localSeenAt = localStorage.getItem(key);

    // Decide whether to show banner: show when sentAt is newer than server or local seen timestamps
    const sentTime = sentAt ? new Date(sentAt).getTime() : 0;
    const serverSeenTime = serverSeenAt ? new Date(serverSeenAt).getTime() : 0;
    const localSeenTime = localSeenAt ? new Date(localSeenAt).getTime() : 0;

    if (sentTime <= 0) return;
    if (sentTime <= serverSeenTime) return; // already read on server
    if (sentTime <= localSeenTime) return; // already dismissed locally

    // Prepare notice history (if available)
    const noticesArray = Array.isArray(adminSettings.notices) ? adminSettings.notices.slice().reverse() : [{ message: notice, sentAt }];

    // Create a persistent dismissible banner with 'View' and 'Dismiss' actions
    addOrUpdateAdminNoticeNotification(notice, sentAt, noticesArray);
    createAdminNoticeBanner(notice, sentAt, noticesArray, key);
  } catch (error) {
    console.warn('Failed to fetch admin notice for shop:', error);
  }
}
// Export to window immediately so startup callers can access it even before global export
try { window.checkForAdminNoticeForCurrentShop = checkForAdminNoticeForCurrentShop; } catch (e) { /* ignore in restricted contexts */ }

function createAdminNoticeBanner(notice, sentAt, notices = [], storageKey) {
  // remove existing banner if present
  const existing = document.getElementById('admin-notice-banner');
  if (existing) existing.remove();

  const header = document.querySelector('header');
  const container = document.createElement('div');
  container.id = 'admin-notice-banner';
  container.className = 'admin-notice-banner';

  const msg = document.createElement('div');
  msg.className = 'notice-message';
  msg.textContent = notice;

  const actions = document.createElement('div');
  actions.className = 'notice-actions';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-info';
  viewBtn.textContent = 'View';
  viewBtn.onclick = () => { showAdminNoticesOverlay(notices); if (currentUser && sentAt) markNoticeReadOnServer(currentUser.uid, sentAt); };

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn btn-secondary';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.onclick = () => {
    try { if (storageKey) localStorage.setItem(storageKey, sentAt || new Date().toISOString()); } catch (e) {}
    if (currentUser && sentAt) markNoticeReadOnServer(currentUser.uid, sentAt);
    removeAdminNoticeNotification();
    container.remove();
  };

  actions.appendChild(viewBtn);
  actions.appendChild(dismissBtn);

  container.appendChild(msg);
  container.appendChild(actions);

  if (header && header.parentNode) {
    header.parentNode.insertBefore(container, header.nextSibling);
  } else {
    document.body.insertBefore(container, document.body.firstChild);
  }
}

function showAdminNoticesOverlay(notices = []) {
  // Remove existing overlay
  const existing = document.getElementById('admin-notices-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-notices-overlay';
  overlay.className = 'admin-notices-overlay';

  const panel = document.createElement('div');
  panel.className = 'admin-notices-panel';

  const title = document.createElement('h3');
  title.textContent = 'Admin Notices';
  title.style.marginTop = '0';
  panel.appendChild(title);

  if (!Array.isArray(notices) || notices.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No notices available.';
    panel.appendChild(p);
  } else {
    const list = document.createElement('div');
    list.className = 'admin-notices-list';

    // Sort by sentAt desc if possible
    const sorted = notices.slice().sort((a, b) => {
      const ta = a && a.sentAt ? new Date(a.sentAt).getTime() : 0;
      const tb = b && b.sentAt ? new Date(b.sentAt).getTime() : 0;
      return tb - ta;
    });

    sorted.forEach(n => {
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(0,0,0,0.03); padding:12px; border-radius:8px;';
      const t = document.createElement('div');
      t.style.fontWeight = '600';
      t.style.marginBottom = '6px';
      t.textContent = n.by ? `${n.by} • ${n.sentAt ? new Date(n.sentAt).toLocaleString() : ''}` : `${n.sentAt ? new Date(n.sentAt).toLocaleString() : ''}`;
      const m = document.createElement('div');
      m.textContent = n.message || n;
      card.appendChild(t);
      card.appendChild(m);
      list.appendChild(card);
    });

    panel.appendChild(list);
  }

  const closeRow = document.createElement('div');
  closeRow.style.cssText = 'display:flex; justify-content:flex-end; margin-top:12px; gap:8px;';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-secondary';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => overlay.remove();
  closeRow.appendChild(closeBtn);
  panel.appendChild(closeRow);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
  // Safe loading helper
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('companyName', settings.name || '');
  setVal('companyAddress', settings.address || '');
  setVal('companyContact', settings.contact || '');
  setVal('currency', settings.currency || '$');
  setVal('lowStockThreshold', (settings.lowStockThreshold !== undefined && settings.lowStockThreshold !== null) ? settings.lowStockThreshold : 10);
  setVal('taxRate', settings.taxRate || 0);
  setVal('ShopAdminPIN', settings.ShopAdminPIN || "");
  setVal('confirmShopAdminPIN', settings.ShopAdminPIN || "");

  const logoPreview = document.getElementById('logoPreview');
  const logoUrl = sanitizeLogoUrl(settings.logo);
  if (logoUrl) {
    logoPreview.src = logoUrl;
    logoPreview.style.display = 'inline-block';
  } else {
    logoPreview.src = '';
    logoPreview.style.display = 'none';
  }
  checkNotificationStatus();
}

function togglePINVisibility(inputId = 'ShopAdminPIN') {
  const pin = document.getElementById(inputId);
  if (!pin) return;
  const type = pin.type === 'password' ? 'text' : 'password';
  pin.type = type;

  // Sync confirmation fields
  if (inputId === 'ShopAdminPIN') {
    const confirm = document.getElementById('confirmShopAdminPIN');
    if (confirm) confirm.type = type;
  }

  // Sync new password confirmation fields
  if (inputId === 'authNewPassword') {
    const confirm = document.getElementById('authConfirmNewPassword');
    if (confirm) confirm.type = type;
  }

  // Sync auth confirmation field
  if (inputId === 'authPassword') {
    const confirm = document.getElementById('authConfirmPassword');
    if (confirm) confirm.type = type;
  }
}

function previewLogo(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      const logoPreview = document.getElementById('logoPreview');
      logoPreview.src = e.target.result;
      logoPreview.style.display = 'inline-block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function toggleSelectAllRows(bodyId, checked, buttonId = null) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.querySelectorAll('.table-row-select').forEach(checkbox => {
    checkbox.checked = checked;
  });
  if (buttonId) {
    updateDeleteMarkedButtonVisibility(bodyId, buttonId);
  }
}

function updateDeleteMarkedButtonVisibility(bodyId, buttonId) {
  const body = document.getElementById(bodyId);
  const button = document.getElementById(buttonId);
  if (!body || !button) return;
  const checkedCount = body.querySelectorAll('.table-row-select:checked').length;
  button.style.display = checkedCount > 0 ? 'inline-block' : 'none';
  button.textContent = checkedCount > 0 ? `🗑️ Delete marked (${checkedCount})` : '🗑️ Delete marked';
}

function updateSelectAllHeader(bodyId, headerId) {
  const body = document.getElementById(bodyId);
  const header = document.getElementById(headerId);
  if (!body || !header) return;
  const checkboxes = body.querySelectorAll('.table-row-select');
  const checkedBoxes = body.querySelectorAll('.table-row-select:checked');
  header.checked = checkboxes.length > 0 && checkboxes.length === checkedBoxes.length;
}

// ===== Staff Management =====
function renderStaffList() {
  const tbody = document.getElementById('staffListBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  staff.forEach((member, i) => {
    const tr = document.createElement('tr');
    const isActive = member.isActive !== false;
    const statusIcon = isActive ?
      `<button class="icon-btn" title="Deactivate Staff" onclick="toggleStaffStatus(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#ffc107" viewBox="0 0 16 16"><path d="M15 8a6.973 6.973 0 0 0-1.71-4.584l-9.874 9.875A7 7 0 0 0 15 8M2.71 12.584l9.874-9.875a7 7 0 0 0-9.874 9.875zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8"/></svg></button>` :
      `<button class="icon-btn" title="Activate Staff" onclick="toggleStaffStatus(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#28a745" viewBox="0 0 16 16"><path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.317 8.704a.733.733 0 0 1 .01-1.05.733.733 0 0 1 1.05.01L7.31 10.51l5.426-6.54z"/></svg></button>`;

    const editIcon = `<button class="icon-btn" title="Edit Staff" onclick="editStaff(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V12h2.293l6.5-6.5-.207-.207z"/></svg></button>`;
    const deleteIcon = `<button class="icon-btn" title="Delete Staff" onclick="deleteStaff(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>`;

    tr.style.opacity = isActive ? '1' : '0.5';
    tr.innerHTML =
      `<td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('staffListBody','selectAllStaff')"></td>` +
      `<td>${i + 1}</td>` +
      `<td>${member.name} ${isActive ? '' : '<small>(Inactive)</small>'}</td>` +
      `<td>${member.role}</td>` +
      `<td>****</td>` +
      `<td><button class="btn u-fs-08" style="padding: 4px 8px; margin: 0;" onclick="openStaffPermissionsModal(${i})">Manage</button></td>` +
      `<td style="text-align: right; white-space: nowrap;">
          ${editIcon}
          ${statusIcon}
          ${deleteIcon}
        </td>`;
    tbody.appendChild(tr);
  });
}

function addStaff() {
  const nameInput = document.getElementById('staffNameInput');
  const roleInput = document.getElementById('staffRoleInput');
  const pinInput = document.getElementById('staffPinInput');
  const indexInput = document.getElementById('staffIndex');

  const name = nameInput.value.trim();
  const role = roleInput.value;
  const pin = pinInput.value.trim();
  const index = indexInput.value;

  const checkboxes = document.querySelectorAll('#staffPermissionsContainer input[type="checkbox"]');
  const permissions = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  if (!name || (index === '' && pin.length !== 4)) {
    alert("Please enter a staff name and a 4-digit PIN.");
    return;
  }

  if (index !== '') {
    const i = parseInt(index, 10);
    const existingStaff = staff[i] || {};
    const staffData = enrichEnterpriseRecord('staff', {
      ...existingStaff,
      name,
      role,
      permissions
    }, existingStaff);

    if (pin) staffData.pin = pin;
    staff[i] = staffData;

    enqueueEnterpriseRecordChange('staff', staffData, 'upsert').catch(console.warn);
    appendAuditEvent('staff_updated', { staffName: name, role });
    const addBtn = document.querySelector('#staffTab .form-panel .btn[onclick="addStaff()"]');
    if (addBtn) addBtn.textContent = "Add Staff";
  } else {
    const staffData = enrichEnterpriseRecord('staff', {
      name,
      role,
      pin,
      permissions,
      isActive: true
    });

    staff.push(staffData);
    enqueueEnterpriseRecordChange('staff', staffData, 'upsert').catch(console.warn);
    appendAuditEvent('staff_created', { staffName: name, role });
  }

  nameInput.value = '';
  roleInput.value = '';
  pinInput.value = '';
  indexInput.value = '';
  checkboxes.forEach(cb => cb.checked = (cb.value === 'menuTab'));

  saveData();
  renderStaffList();
  populateReportFilters();
}

function editStaff(index) {
  const member = staff[index];
  document.getElementById('staffNameInput').value = member.name;
  document.getElementById('staffRoleInput').value = member.role;
  document.getElementById('staffPinInput').value = member.pin;
  document.getElementById('staffIndex').value = index;

  const checkboxes = document.querySelectorAll('#staffPermissionsContainer input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = member.permissions?.includes(cb.value);
  });

  const addBtn = document.querySelector('#staffTab .form-panel .btn[onclick="addStaff()"]');
  if (addBtn) addBtn.textContent = "Update Staff";
}

function toggleStaffStatus(index) {
  staff[index].isActive = staff[index].isActive === false ? true : false;
  staff[index] = enrichEnterpriseRecord('staff', staff[index], staff[index]);
  enqueueEnterpriseRecordChange('staff', staff[index], 'upsert').catch(console.warn);
  saveData();
  renderStaffList();
  populateReportFilters();
}

function openStaffPermissionsModal(index) {
  const member = staff[index];
  const container = document.getElementById('editPermissionsGrid');
  document.getElementById('permStaffName').textContent = member.name;
  document.getElementById('permStaffIndex').value = index;

  const tabs = [
    { id: 'dashboardTab', label: 'Dashboard' },
    { id: 'menuTab', label: 'Shop' },
    { id: 'addDishTab', label: 'Products' },
    { id: 'categoryTab', label: 'Categories' },
    { id: 'unitTab', label: 'Units' },
    { id: 'staffTab', label: 'Staff' },
    { id: 'customerTab', label: 'Customers' },
    { id: 'stockTab', label: 'Stock' },
    { id: 'transactionsTab', label: 'Sales' },
    { id: 'reportsTab', label: 'Reports' },
    { id: 'settingsTab', label: 'Settings' }
  ];

  container.innerHTML = tabs.map(tab => `
      <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" value="${tab.id}" ${member.permissions?.includes(tab.id) ? 'checked' : ''}>
        ${tab.label}
      </label>
    `).join('');

  document.getElementById('staffPermissionsModal').style.display = 'flex';
}

function saveStaffPermissions() {
  const index = parseInt(document.getElementById('permStaffIndex').value, 10);
  const checkboxes = document.querySelectorAll('#editPermissionsGrid input[type="checkbox"]');
  const permissions = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

  staff[index].permissions = permissions;
  staff[index] = enrichEnterpriseRecord('staff', staff[index], staff[index]);
  enqueueEnterpriseRecordChange('staff', staff[index], 'upsert').catch(console.warn);

  saveData();
  document.getElementById('staffPermissionsModal').style.display = 'none';
  alert("Permissions updated successfully.");
}

async function deleteStaff(index) {
  const confirmed = await showAppConfirm(`Are you sure you want to remove ${staff[index].name}?`, "Remove Staff", "Remove", "Cancel");
  if (!confirmed) return;

  const staffToDelete = staff[index];
  enqueueEnterpriseRecordChange('staff', staffToDelete, 'delete').catch(console.warn);

  staff.splice(index, 1);
  saveData();
  renderStaffList();
}

async function resetApp() {
  const confirmed = await showAppConfirm("WARNING: This will permanently delete ALL application data, including your menu, transactions, settings, IndexedDB, and browser caches. This action cannot be undone. Are you sure?", "Reset Application", "Reset", "Cancel");
  if (!confirmed) return;

  const cleared = await clearYoShopLocalData({ skipConfirm: true, reload: true });
  if (!cleared) {
    if (typeof showAppAlert === 'function') {
      showAppAlert('Could not reset application data. Please close other tabs of this app and try again.', 'Reset Failed');
    }
  }
}

function populateCurrencies() {
  const currencies = {
    // Common World Currencies
    "$": "USD (US Dollar)",
    "€": "EUR (Euro)",
    "¥": "JPY (Japanese Yen)",
    "£": "GBP (British Pound)",
    "A$": "AUD (Australian Dollar)",
    "C$": "CAD (Canadian Dollar)",
    "Fr": "CHF (Swiss Franc)",
    "元": "CNY (Chinese Yuan)",
    "₹": "INR (Indian Rupee)",
    "₽": "RUB (Russian Ruble)",
    "R$": "BRL (Brazilian Real)",
    "₩": "KRW (South Korean Won)",
    "₺": "TRY (Turkish Lira)",
    "Mex$": "MXN (Mexican Peso)",
    "S$": "SGD (Singapore Dollar)",
    "NZ$": "NZD (New Zealand Dollar)",
    "AED": "AED (United Arab Emirates Dirham)",
    // African Currencies
    "DZD": "DZD (Algerian Dinar)",
    "AOA": "AOA (Angolan Kwanza)",
    "BWP": "BWP (Botswana Pula)",
    "BIF": "BIF (Burundian Franc)",
    "CVE": "CVE (Cape Verdean Escudo)",
    "XAF": "XAF (Central African CFA Franc)",
    "XOF": "XOF (West African CFA Franc)",
    "KMF": "KMF (Comorian Franc)",
    "CDF": "CDF (Congolese Franc)",
    "DJF": "DJF (Djiboutian Franc)",
    "EGP": "EGP (Egyptian Pound)",
    "ERN": "ERN (Eritrean Nakfa)",
    "SZL": "SZL (Eswatini Lilangeni)",
    "ETB": "ETB (Ethiopian Birr)",
    "GMD": "GMD (Gambian Dalasi)",
    "GHS": "GHS (Ghanaian Cedi)",
    "GNF": "GNF (Guinean Franc)",
    "KES": "KES (Kenyan Shilling)",
    "LSL": "LSL (Lesotho Loti)",
    "LRD": "LRD (Liberian Dollar)",
    "LYD": "LYD (Libyan Dinar)",
    "MGA": "MGA (Malagasy Ariary)",
    "MWK": "MWK (Malawian Kwacha)",
    "MRU": "MRU (Mauritanian Ouguiya)",
    "MUR": "MUR (Mauritian Rupee)",
    "MAD": "MAD (Moroccan Dirham)",
    "MZN": "MZN (Mozambican Metical)",
    "NAD": "NAD (Namibian Dollar)",
    "NGN": "NGN (Nigerian Naira)",
    "RWF": "RWF (Rwandan Franc)",
    "STN": "STN (São Tomé & Príncipe Dobra)",
    "SLL": "SLL (Sierra Leonean Leone)",
    "SOS": "SOS (Somali Shilling)",
    "ZAR": "ZAR (South African Rand)",
    "SSP": "SSP (South Sudanese Pound)",
    "SDG": "SDG (Sudanese Pound)",
    "TZS": "TZS (Tanzanian Shilling)",
    "TND": "TND (Tunisian Dinar)",
    "UGX": "UGX (Ugandan Shilling)",
    "ZMW": "ZMW (Zambian Kwacha)",
    "ZWL": "ZWL (Zimbabwean Dollar)"
  };
  const select = document.getElementById('currency');
  select.innerHTML = ''; // Clear existing options
  for (const symbol in currencies) {
    const option = document.createElement('option');
    option.value = symbol;
    option.textContent = `${symbol} - ${currencies[symbol]}`;
    select.appendChild(option);
  }
}

// ===== Category Management =====
function renderCategoryList() {
  const tbody = document.getElementById('categoryListBody');
  tbody.innerHTML = '';
  dishCategories.forEach((cat, rowIndex) => {
    const index = dishCategories.indexOf(cat); // Get index for functions
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('categoryListBody','selectAllCategories')"></td>
                      <td>${rowIndex + 1}</td>
                      <td>${cat}</td>
                      <td style="text-align: right; white-space: nowrap;">
                        <button class="icon-btn" title="Edit Category" onclick="editCategory(${index})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V12h2.293l6.5-6.5-.207-.207z"/></svg></button>
                        <button class="icon-btn" title="Delete Category" onclick="deleteCategory(${index})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>
                      </td>`;
    tbody.appendChild(tr);
  });
}

function populateCategoryFilter() {
  const select = document.getElementById('categoryFilter');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Categories</option>';
  dishCategories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
  if (dishCategories.includes(currentVal)) select.value = currentVal;
}

function addCategory() {
  const nameInput = document.getElementById('categoryNameInput');
  const name = nameInput.value.trim();
  if (!name) return showAppAlert("Category name cannot be empty.", 'Category Required');
  if (dishCategories.includes(name)) return showAppAlert("Category already exists.", 'Category Exists');

  dishCategories.push(name);
  dishCategories.sort();
  const categoryRecord = createCategoryRecord(name);
  enqueueEnterpriseRecordChange('categories', categoryRecord, 'upsert').catch(console.warn);
  nameInput.value = '';
  saveData();
  renderCategoryList();
  populateCategoryDropdown();
  populateCategoryFilter();
  updateDashboard();
}

async function editCategory(index) {
  const oldCategoryName = dishCategories[index];
  let newCategoryName = null;
  if (typeof showAppPrompt === 'function') {
    newCategoryName = await showAppPrompt(`Enter new name for category "${oldCategoryName}":`, 'Rename Category', oldCategoryName);
  }

  if (!newCategoryName || newCategoryName.trim() === '') {
    return; // User cancelled or entered empty string
  }

  const trimmedNewName = newCategoryName.trim();
  if (trimmedNewName === oldCategoryName) {
    return; // No change
  }

  if (dishCategories.includes(trimmedNewName)) {
    return showAppAlert(`Category "${trimmedNewName}" already exists.`, 'Category Exists');
  }

  // Update category in the list
  dishCategories[index] = trimmedNewName;
  dishCategories.sort();
  const oldCategoryRecord = createCategoryRecord(oldCategoryName);
  const newCategoryRecord = createCategoryRecord(trimmedNewName);

  enqueueEnterpriseRecordChange('categories', oldCategoryRecord, 'delete').catch(console.warn);
  enqueueEnterpriseRecordChange('categories', newCategoryRecord, 'upsert').catch(console.warn);

  // Update all menu items with the old category
  menu.forEach(dish => {
    if (dish.category === oldCategoryName) {
      dish.category = trimmedNewName;
    }
  });

  saveData();
  renderCategoryList();
  renderDishesTable(); // To reflect changes in the dishes list
  populateCategoryDropdown();
  populateCategoryFilter();
  updateDashboard();
  await showAppAlert(`Category "${oldCategoryName}" was updated to "${trimmedNewName}".`, 'Category Updated');
}

async function deleteCategory(index) {
  const categoryName = dishCategories[index];
  const itemsUsingCategory = menu.filter(item => item.category === categoryName);

  let message = `Are you sure you want to delete the category "${categoryName}"?`;
  if (itemsUsingCategory.length > 0) {
    message += `\n\nWarning: This category contains ${itemsUsingCategory.length} items. They will be moved to "Uncategorized".`;
  }

  const confirmed = await showAppConfirm(message, 'Delete Category', 'Delete', 'Cancel');
  if (confirmed?.confirmed) {
    // Update items to remove the category reference
    itemsUsingCategory.forEach(item => item.category = '');
    const categoryRecord = createCategoryRecord(categoryName);
    enqueueEnterpriseRecordChange('categories', categoryRecord, 'delete').catch(console.warn);

    dishCategories.splice(index, 1);
    saveData();
    populateCategoryDropdown();
    renderCategoryList();
    populateCategoryFilter();
    updateDashboard();

    // Refresh menu if visible to show items in Uncategorized
    if (document.getElementById('menuTab').classList.contains('active')) {
      renderMenu(document.getElementById('menuTab').dataset.tableId);
    }
  }
}

function populateCategoryDropdown() {
  const select = document.getElementById('dishCategory'); // This now targets the select in the add dish form
  select.innerHTML = '<option value="" disabled selected>Select Category</option>';
  dishCategories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
}
// ===== Customer Management =====
// ===== Unit Management =====
function renderUnitList() {
  const tbody = document.getElementById('unitListBody');
  if (!tbody) return;

  // Guard against units being undefined or not an array
  if (!units || !Array.isArray(units)) return;

  tbody.innerHTML = '';

  units.forEach((unit, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('unitListBody','selectAllUnits')"></td>
                      <td>${i + 1}</td>
                      <td>${unit.full}</td>
                      <td>${unit.short}</td>
                      <td style="text-align: right;">
                        <button class="icon-btn" title="Delete Unit" onclick="deleteUnit(${i})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>
                      </td>`;
    tbody.appendChild(tr);
  });
}

function addUnit() {
  const nameInput = document.getElementById('unitNameInput');
  const fullNameInput = document.getElementById('unitFullNameInput');
  const shortName = nameInput.value.trim();
  const fullName = fullNameInput.value.trim();

  if (!shortName || !fullName) return showAppAlert("Both short name and full name are required.", 'Unit Required');
  if (units.some(u => u.short.toLowerCase() === shortName.toLowerCase())) return showAppAlert("Unit short name already exists.", 'Unit Exists');
  if (units.some(u => u.full.toLowerCase() === fullName.toLowerCase())) return showAppAlert("Unit full name already exists.", 'Unit Exists');

  const unitData = enrichEnterpriseRecord('units', {
    short: shortName,
    full: fullName
  });

  units.push(unitData);
  enqueueEnterpriseRecordChange('units', unitData, 'upsert').catch(console.warn);
  units.sort((a, b) => a.short.localeCompare(b.short));
  nameInput.value = '';
  fullNameInput.value = '';

  appendAuditEvent('unit_created', { shortName, fullName });

  saveData();
  renderUnitList();
  populateUnitDropdown();
}

async function deleteUnit(index) {
  const unit = units[index];
  const confirmed = await showAppConfirm(`Are you sure you want to delete the unit "${unit.short} (${unit.full})"?`, 'Delete Unit', 'Delete', 'Cancel');
  if (confirmed?.confirmed) {
    const unitToDelete = units[index];
    enqueueEnterpriseRecordChange('units', unitToDelete, 'delete').catch(console.warn);
    units.splice(index, 1);
    saveData();
    renderUnitList();
    populateUnitDropdown();
  }
}

function toggleAddCustomerForm(show) {
  const formContainer = document.getElementById('addCustomerFormContainer');
  const toggleButton = document.getElementById('addCustomerBtn');
  if (show) {
    formContainer.style.display = 'block';
    if (toggleButton) toggleButton.style.display = 'none'; // Hide the 'Add New' button
    document.getElementById('customerNameInput').value = '';
    document.getElementById('customerContactInput').value = '';
    document.getElementById('customerAddressInput').value = '';
  } else {
    formContainer.style.display = 'none';
    if (toggleButton) toggleButton.style.display = 'inline-block'; // Show the 'Add New' button
  }
}

function toggleSelectAllCustomers(checked) {
  document.querySelectorAll('.customer-row-select').forEach(checkbox => {
    checkbox.checked = checked;
  });
}

function renderCustomerList() {
  const tbody = document.getElementById('customerListBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const currencySymbol = getCurrencySymbol();
  customers.forEach((customer, i) => {
    const customerTransactions = (Array.isArray(transactions) ? transactions : []).filter(transaction => {
      const matchesCustomerId = customer?.id && transaction?.customerId && transaction.customerId === customer.id;
      const matchesCustomerName = transaction?.customerNameReal && customer?.name && transaction.customerNameReal === customer.name;
      return matchesCustomerId || matchesCustomerName;
    });
    const outstandingBalance = buildInvoiceListItems({
      customers: [customer],
      transactions: customerTransactions
    }).reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
    const outstandingText = outstandingBalance === 0
      ? `${currencySymbol}0`
      : `<span style="${outstandingBalance < 0 ? 'color:#dc3545' : 'color:#28a745'}; font-weight:bold;">${outstandingBalance < 0 ? '-' : ''}${currencySymbol}${formatCurrency(Math.abs(outstandingBalance))}</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="text-align: center;"><input type="checkbox" class="customer-row-select" value="${i}" onchange="document.getElementById('selectAllCustomers').checked = document.querySelectorAll('.customer-row-select:checked').length === document.querySelectorAll('.customer-row-select').length"></td>
                        <td>${i + 1}</td>
                        <td>${customer.name}</td>
                        <td>${customer.contact || customer.phone || customer.mobile || ''}</td>
                        <td>${customer.address || ''}</td>
                        <td>${outstandingText}</td>
                        <td style="text-align: right; white-space: nowrap;">
                          <button class="icon-btn" title="Edit Customer" onclick="editCustomer(${i}); event.stopPropagation();"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V12h2.293l6.5-6.5-.207-.207z"/></svg></button>
                          <button class="icon-btn" title="Delete Customer" onclick="deleteCustomer(${i}); event.stopPropagation();"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>
                        </td>`;
    tbody.appendChild(tr);
  });
  
  populateCustomerDropdowns();
  renderInvoices();
}

function createCustomerDebtInvoice(customer) {
  if (!customer || typeof customer !== 'object') return null;
  const subtotalSales = parseFloat(customer.subtotalSales ?? 0) || 0;
  const totalSales = parseFloat(customer.totalSales ?? 0) || 0;
  const amountPaid = parseFloat(customer.totalPaid ?? 0) || 0;
  const balance = parseFloat(customer.balance) || 0;
  const lastAdjustment = null;

  const dateValue = customer.lastTransactionDate ? new Date(customer.lastTransactionDate) : new Date();
  const previousInvoiceFromTransactions = Array.isArray(transactions)
    ? transactions
        .filter(tx => tx && tx.invoiceNumber && ((customer?.id && tx.customerId && tx.customerId === customer.id) || (tx.customerNameReal && customer?.name && tx.customerNameReal === customer.name) || (tx.customerName && customer?.name && tx.customerName === customer.name)))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map(tx => normalizeInvoiceNumber(tx.invoiceNumber))
        .find(Boolean)
    : null;
  const invoiceNumber = normalizeInvoiceNumber(
    customer.invoiceNumber || customer.lastInvoiceNumber || previousInvoiceFromTransactions || getInvoiceNumber({ date: dateValue.toISOString() })
  );
  if (!customer.invoiceNumber || customer.invoiceNumber !== invoiceNumber) {
    customer.invoiceNumber = invoiceNumber;
    if (typeof saveData === 'function') {
      saveData();
    }
  }
  if (!customer.lastInvoiceNumber || customer.lastInvoiceNumber !== invoiceNumber) {
    customer.lastInvoiceNumber = invoiceNumber;
  }

  return {
    date: customer.lastTransactionDate || new Date().toISOString(),
    customerName: customer.name || 'Unknown Customer',
    customerNameReal: customer.name || 'Unknown Customer',
    customerContact: customer.contact || customer.phone || customer.mobile || '',
    customerAddress: customer.address || '',
    tableNo: 'Customer Account',
    items: [{ name: 'Account Summary', qty: 1, price: subtotalSales, notes: 'Customer account summary' }],
    total: subtotalSales,
    subtotal: subtotalSales,
    tax: 0,
    discount: { amount: 0 },
    receiptType: 'customerDebtInvoice',
    paymentMethod: 'On Account',
    customerId: customer.id,
    note: `Outstanding balance due for ${customer.name || 'customer account'}`,
    amountPaid: amountPaid,
    balance: balance,
    lastAdjustment: lastAdjustment,
    adjustments: [],
    invoiceNumber
  };
}

function renderInvoices() {
  const startDate = document.getElementById('invoiceStartDate')?.value;
  const endDate = document.getElementById('invoiceEndDate')?.value;
  const invoiceRows = buildInvoiceListItems({
    customers: Array.isArray(customers) ? customers : [],
    transactions: Array.isArray(transactions) ? transactions : []
  });

  const filteredRows = invoiceRows.filter(row => {
    const txDate = row?.date ? row.date.split('T')[0] : '';
    if (startDate && txDate && txDate < startDate) return false;
    if (endDate && txDate && txDate > endDate) return false;
    return true;
  });

  const currencySymbol = getCurrencySymbol();
  const rowsHtml = filteredRows.map((row, idx) => {
    const balance = Number(row.balance || 0);
    const total = Number(row.total || 0);
    const amountPaid = Number(row.amountPaid || 0);
    const customer = row.customer;
    const previewData = row.previewData;
    const invoiceNumber = row.invoiceNumber || 'INV-UNKNOWN';
    const previewDataJson = previewData ? JSON.stringify(previewData).replace(/'/g, "\\'") : 'null';
    const lastDate = row.date ? new Date(row.date).toLocaleString() : new Date().toLocaleString();
    const allAdjustments = Array.isArray(previewData?.adjustments) ? previewData.adjustments : [];
    const lastAdjustment = previewData?.lastAdjustment || (allAdjustments.length > 0 ? allAdjustments[allAdjustments.length - 1] : null);
    const adjAmount = lastAdjustment ? (parseFloat(lastAdjustment.amount) || 0) : 0;
    const adjMethod = lastAdjustment ? (lastAdjustment.method || '') : '';
    const adjustedHtml = lastAdjustment ? `${adjMethod ? adjMethod + ' ' : ''}${currencySymbol}${formatCurrency(adjAmount)}` : '-';

    const isPaid = Math.abs(balance) === 0;
    const adjustDisabledAttr = isPaid || !customer?.id ? 'disabled' : '';
    const adjustStyle = isPaid || !customer?.id ? 'opacity:0.45; pointer-events:none;' : '';
    const statusBadge = isPaid
      ? `<span style="margin-left:8px; padding:4px 8px; background:#28a745; color:#fff; border-radius:6px; font-size:0.85em;">Cleared</span>`
      : `<span style="margin-left:8px; padding:4px 8px; background:#ffc107; color:#212529; border-radius:6px; font-size:0.85em;">Pending</span>`;

    return `<tr class="u-cursor-pointer">
      <td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('invoiceListBody','selectAllInvoiceRows')"></td>
      <td>${idx + 1}</td>
      <td>${lastDate}</td>
      <td>${row.customerName || 'Unknown Customer'}</td>
      <td>${invoiceNumber}</td>
      <td style="text-align: right;"><strong><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(total)}</strong></td>
      <td style="text-align: right;"><span class="currency-symbol">${currencySymbol}</span>${formatCurrency(amountPaid)}</td>
      <td style="text-align: right; color:${balance < 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">${balance < 0 ? '-' : ''}${currencySymbol}${formatCurrency(Math.abs(balance))}</td>
      <td style="text-align: right;">${adjustedHtml}</td>
      <td style="text-align: right; display:flex; gap:6px; justify-content:flex-end; align-items:center;">
        <button class="btn" type="button" ${adjustDisabledAttr} style="${adjustStyle}" onclick='showInvoiceAdjustmentPrompt(${JSON.stringify(String(row.transaction?.id || row.transaction?.invoiceNumber || ''))}); event.stopPropagation();'>Adjust</button>
        <button class="btn" type="button" title="BC🖨️" onclick='previewOrder(${previewDataJson}); event.stopPropagation();'>BC🖨️</button>
        <button class="btn" type="button" onclick='openA4InvoicePreview(${previewDataJson}); event.stopPropagation();'>A4 🖨️</button>
        ${statusBadge}
      </td>
    </tr>`;
  }).join('');

  const invoiceCountEl = document.getElementById('invoiceCountInfo');
  if (invoiceCountEl) {
    invoiceCountEl.textContent = `Showing ${filteredRows.length} of ${invoiceRows.length} debt invoices`;
  }

  const tbody = document.getElementById('invoiceListBody');
  if (tbody) {
    tbody.innerHTML = rowsHtml || '<tr><td colspan="10" class="u-text-center">No debt invoices found.</td></tr>';
  }
}

async function showInvoiceAdjustmentPrompt(transactionOrCustomer) {
  const transactionIdOrKey = (typeof transactionOrCustomer === 'string' || typeof transactionOrCustomer === 'number')
    ? String(transactionOrCustomer)
    : null;

  const transaction = Array.isArray(transactions)
    ? transactions.find(tx => tx && (
        (transactionIdOrKey && (String(tx.id) === transactionIdOrKey || String(tx.invoiceNumber) === transactionIdOrKey || String(tx.customerId) === transactionIdOrKey)) ||
        (typeof transactionOrCustomer === 'object' && transactionOrCustomer && (
          (tx.id && tx.id === transactionOrCustomer.id) ||
          (tx.invoiceNumber && tx.invoiceNumber === transactionOrCustomer.invoiceNumber) ||
          (tx.customerId && transactionOrCustomer.customerId && String(tx.customerId) === String(transactionOrCustomer.customerId))
        ))
      ))
    : null;

  const resolvedTransaction = transaction || (typeof transactionOrCustomer === 'object' ? transactionOrCustomer : null);
  if (!resolvedTransaction) return;

  const activeTransaction = transaction || resolvedTransaction;

  const customer = activeTransaction.customerId
    ? customers.find(c => c && (c.id === activeTransaction.customerId || String(c.id) === String(activeTransaction.customerId))) || null
    : null;

  const modal = document.getElementById('appPopupModal');
  const titleEl = document.getElementById('appPopupTitle');
  const messageEl = document.getElementById('appPopupMessage');
  const inputWrapper = document.getElementById('appPopupInputWrapper');
  const inputEl = document.getElementById('appPopupInput');
  const confirmBtn = document.getElementById('appPopupConfirm');
  const cancelBtn = document.getElementById('appPopupCancel');

  titleEl.textContent = 'Record Adjustment';
  titleEl.style.marginBottom = '4px';
  messageEl.style.marginBottom = '0';
  messageEl.innerHTML = `
    <p class="adjHelperText" style="margin:0 0 10px; color:var(--text-muted,#666); font-size:0.96rem; line-height:1.5;">
      Choose a payment method below, then enter the adjustment amount.
    </p>
    <div id="adjMethodSelector" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
      <button id="adjModeCash" class="btn">Cash</button>
      <button id="adjModeMobile" class="btn">Mobile Money</button>
      <button id="adjModeCard" class="btn">Credit/Debit Card</button>
    </div>
    <div id="adjAmountWrapper" style="display:none; margin-top:0;">
      <label style="display:block; margin-bottom:2px;">Enter amount to adjust</label>
    </div>
  `;

  inputWrapper.style.display = 'none';
  inputEl.type = 'number';
  inputEl.placeholder = '0.00';
  inputEl.value = '';

  confirmBtn.style.display = 'none';
  cancelBtn.style.display = 'none';

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  let selectedMethod = null;

  const showAmountField = () => {
    inputWrapper.style.display = 'block';
    const amtWrapper = document.getElementById('adjAmountWrapper');
    if (amtWrapper) amtWrapper.style.display = 'block';
    confirmBtn.style.display = 'inline-flex';
    cancelBtn.style.display = 'inline-flex';
    titleEl.textContent = `Record Adjustment — ${selectedMethod}`;
    const helperText = messageEl.querySelector('.adjHelperText');
    const selector = document.getElementById('adjMethodSelector');
    if (helperText) helperText.style.display = 'none';
    if (selector) selector.style.display = 'none';
    setTimeout(() => inputEl.focus(), 50);
  };

  const modeHandler = (method) => {
    selectedMethod = method;
    showAmountField();
  };

  const btnCash = document.getElementById('adjModeCash');
  const btnMobile = document.getElementById('adjModeMobile');
  const btnCard = document.getElementById('adjModeCard');
  if (btnCash) btnCash.onclick = () => modeHandler('Cash');
  if (btnMobile) btnMobile.onclick = () => modeHandler('Mobile Money');
  if (btnCard) btnCard.onclick = () => modeHandler('Card');

  const onConfirm = async () => {
    const amount = parseFloat(inputEl.value);
    if (isNaN(amount) || amount <= 0) {
      inputEl.style.boxShadow = '0 0 0 3px rgba(220,53,69,0.08)';
      setTimeout(() => inputEl.style.boxShadow = '', 800);
      return;
    }

    const adjustment = {
      id: `adj-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      date: new Date().toISOString(),
      amount,
      method: selectedMethod || 'On Account',
      note: ''
    };

    activeTransaction.adjustments = Array.isArray(activeTransaction.adjustments) ? activeTransaction.adjustments : [];
    activeTransaction.adjustments.push(adjustment);
    activeTransaction.lastAdjustment = adjustment;
    activeTransaction.lastTransactionDate = adjustment.date;
    const adjustmentTotal = activeTransaction.adjustments.reduce((sum, entry) => sum + (parseFloat(entry?.amount) || 0), 0);
    const updatedAmountPaid = (parseFloat(activeTransaction.amountPaid) || 0) + amount;
    activeTransaction.amountPaid = updatedAmountPaid;
    activeTransaction.balance = Math.min(0, updatedAmountPaid - (parseFloat(activeTransaction.total) || 0) + adjustmentTotal);

    if (typeof enqueueLocalSyncAction === 'function') {
      enqueueLocalSyncAction({
        entityType: 'sales',
        payload: activeTransaction,
        businessId: getEffectiveUid(),
        userId: currentUser?.uid || getEffectiveUid(),
        staffId: getCurrentStaffId(),
        updatedBy: currentUser?.uid || getEffectiveUid(),
        deviceId: getCurrentDeviceId()
      }).catch(console.warn);
    }

    saveData();
    renderInvoices();
    renderTransactions();
    previewOrder(activeTransaction);

    modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  const onCancel = () => {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  confirmBtn.onclick = onConfirm;
  cancelBtn.onclick = onCancel;

  modal.onclick = (ev) => { if (ev.target === modal) onCancel(); };
}

function toggleCustomerAdjustmentPanel(index) {
  const row = document.getElementById(`customerAdjustmentRow-${index}`);
  if (!row) return;
  const isVisible = row.style.display === 'table-row';
  document.querySelectorAll('[id^="customerAdjustmentRow-"]').forEach(el => {
    el.style.display = 'none';
  });
  if (!isVisible) row.style.display = 'table-row';
}

function showCustomerAdjustmentReceipt(index, adjustmentIndex = null) {
  const customer = customers[index];
  if (!customer) return;

  const adjustments = Array.isArray(customer.adjustments) ? customer.adjustments : [];
  const adjustment = adjustmentIndex !== null && adjustments[adjustmentIndex]
    ? adjustments[adjustmentIndex]
    : adjustments[adjustments.length - 1];

  if (!adjustment) return;

  const totalAmount = Math.max(parseFloat(customer.totalSales) || 0, parseFloat(customer.subtotalSales) || 0, parseFloat(adjustment.amount) || 0);
  const balance = parseFloat(customer.balance) || 0;
  const receiptData = {
    date: adjustment.date || new Date().toISOString(),
    customerName: customer.name,
    customerNameReal: customer.name,
    customerContact: customer.contact || customer.phone || customer.mobile || '',
    customerAddress: customer.address || '',
    tableNo: 'Customer Account',
    items: [{ name: 'Customer Payment Adjustment', qty: 1, price: adjustment.amount, notes: adjustment.note || '' }],
    total: adjustment.amount,
    subtotal: adjustment.amount,
    tax: 0,
    discount: { amount: 0 },
    receiptType: 'customerAdjustment',
    paymentMethod: adjustment.method || 'Cash',
    customerId: customer.id,
    note: adjustment.note || '',
    amountPaid: adjustment.amount,
    totalAmount,
    balance
  };

  const receiptModal = document.getElementById('receiptModal');
  if (receiptModal) {
    receiptModal._transactionData = receiptData;
    populateReceiptContent(receiptData);
    receiptModal.style.display = 'flex';
  }
}

async function recordCustomerAdjustment(index) {
  const customer = customers[index];
  if (!customer) return;

  const amountInput = document.getElementById(`customerAdjustmentAmount-${index}`);
  const dateInput = document.getElementById(`customerAdjustmentDate-${index}`);
  const noteInput = document.getElementById(`customerAdjustmentNote-${index}`);

  const amount = parseFloat(amountInput?.value) || 0;
  if (!amount || amount <= 0) {
    await showAppAlert('Please enter a valid adjustment amount.', 'Invalid Amount');
    return;
  }

  const adjustment = {
    id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: dateInput?.value ? new Date(dateInput.value).toISOString() : new Date().toISOString(),
    amount,
    method: 'On Account',
    note: noteInput?.value.trim() || 'Customer payment adjustment'
  };

  customer.adjustments = Array.isArray(customer.adjustments) ? customer.adjustments : [];
  customer.adjustments.push(adjustment);
  customer.balance = (parseFloat(customer.balance) || 0) + amount;
  customer.totalPaid = (parseFloat(customer.totalPaid) || 0) + amount;
  customer.lastTransactionDate = adjustment.date;

  enqueueEnterpriseRecordChange('customers', customer, 'upsert').catch(console.warn);
  saveData();
  renderCustomerList();
  showCustomerAdjustmentReceipt(index, customer.adjustments.length - 1);
  await showAppAlert(`Adjustment recorded for ${customer.name}.`, 'Adjustment Saved');
}

function populateCustomerDropdowns() {
  const orderSelect = document.getElementById('orderCustomerSelect');
  const paymentSelect = document.getElementById('paymentCustomerSelect');
  
  const currencySymbol = getCurrencySymbol();
  const optionsHtml = `
    <option value="">Walk-in Customer</option>
    ${customers.map((c, i) => {
      const bal = c.balance || 0;
      const balStr = bal < 0 ? 'Debt: -' + currencySymbol + formatCurrency(Math.abs(bal)) : (bal > 0 ? 'Credit: ' + currencySymbol + formatCurrency(bal) : 'No Balance');
      return `<option value="${i}">${c.name} (${balStr})</option>`;
    }).join('')}
  `;
  
  if (orderSelect) {
    const currentVal = orderSelect.value;
    orderSelect.innerHTML = optionsHtml;
    orderSelect.value = currentVal;
  }
  
  if (paymentSelect) {
    const currentVal = paymentSelect.value;
    paymentSelect.innerHTML = optionsHtml;
    paymentSelect.value = currentVal;
  }
}

function updateOrderCustomer() {
  const orderSelect = document.getElementById('orderCustomerSelect');
  const paymentSelect = document.getElementById('paymentCustomerSelect');
  if (orderSelect && paymentSelect) {
    paymentSelect.value = orderSelect.value;
    onPaymentCustomerChange();
  }
}

function onPaymentCustomerChange() {
  const paymentSelect = document.getElementById('paymentCustomerSelect');
  const balanceRow = document.getElementById('paymentCustomerBalanceRow');
  const balanceVal = document.getElementById('paymentCustomerBalanceVal');
  const newBalanceRow = document.getElementById('paymentNewBalanceRow');

  if (!paymentSelect) return;
  const customerIndex = paymentSelect.value;
  if (customerIndex !== '') {
    const customer = customers[parseInt(customerIndex, 10)];
    const currentBalance = customer.balance || 0;
    
    const currencySymbol = getCurrencySymbol();
    if (balanceRow && balanceVal) {
      balanceRow.style.display = 'flex';
      if (currentBalance < 0) {
        balanceVal.innerHTML = `<span style="color:#dc3545; font-weight:bold;">Debt: -${currencySymbol}${formatCurrency(Math.abs(currentBalance))}</span>`;
      } else if (currentBalance > 0) {
        balanceVal.innerHTML = `<span style="color:#28a745; font-weight:bold;">Credit: ${currencySymbol}${formatCurrency(currentBalance)}</span>`;
      } else {
        balanceVal.innerHTML = `No Balance (${currencySymbol}0)`;
      }
    }
    
    if (newBalanceRow) newBalanceRow.style.display = 'flex';
  } else {
    if (balanceRow) balanceRow.style.display = 'none';
    if (newBalanceRow) newBalanceRow.style.display = 'none';
  }
  
  updatePaymentTotals();
}

function addCustomer() {
  const nameInput = document.getElementById('customerNameInput');
  const contactInput = document.getElementById('customerContactInput');
  const addressInput = document.getElementById('customerAddressInput');
  const index = document.getElementById('customerIndex').value;

  if (!nameInput.value.trim()) return showAppAlert("Customer name is required.", 'Customer Required');

  const parsedIndex = index !== '' ? parseInt(index, 10) : -1;
  const existingCustomer = parsedIndex >= 0 ? customers[parsedIndex] : null;

  const customerData = enrichEnterpriseRecord('customers', {
    name: nameInput.value.trim(),
    contact: contactInput.value.trim(),
    address: addressInput.value.trim(),
    balance: existingCustomer?.balance || 0,
    subtotalSales: existingCustomer?.subtotalSales || 0,
    totalSales: existingCustomer?.totalSales || 0,
    totalPaid: existingCustomer?.totalPaid || 0,
    adjustments: existingCustomer?.adjustments || [],
    lastTransactionDate: existingCustomer?.lastTransactionDate || new Date().toISOString()
  }, existingCustomer);

  if (index !== '') {
    customers[parsedIndex] = customerData;
    appendAuditEvent('customer_updated', { customerName: customerData.name });
  } else {
    customers.push(customerData);
    appendAuditEvent('customer_created', { customerName: customerData.name });
  }

  enqueueEnterpriseRecordChange('customers', customerData, 'upsert').catch(console.warn);

  saveData();
  renderCustomerList();
  toggleAddCustomerForm(false);
}

function editCustomer(index) {
  const customer = customers[index];
  toggleAddCustomerForm(true);
  document.getElementById('customerNameInput').value = customer.name;
  document.getElementById('customerContactInput').value = customer.contact;
  document.getElementById('customerAddressInput').value = customer.address;
  document.getElementById('customerIndex').value = index;
  document.getElementById('saveCustomerBtn').textContent = 'Update Customer';
}

async function deleteCustomer(index) {
  const confirmed = await showAppConfirm(`Are you sure you want to delete customer "${customers[index].name}"?`, 'Delete Customer', 'Delete', 'Cancel');
  if (confirmed?.confirmed) {
    const customerToDelete = customers[index];
    enqueueEnterpriseRecordChange('customers', customerToDelete, 'delete').catch(console.warn);
    customers.splice(index, 1);
    saveData();
    renderCustomerList();
  }
}

// ===== Theme Toggle =====
function toggleTheme() {
  // Toggle based on the class on the body
  if (document.body.classList.contains('dark-mode')) {
    document.body.classList.remove('dark-mode');
    settings.theme = 'light';
  } else {
    document.body.classList.add('dark-mode');
    settings.theme = 'dark';
  }
  applyTheme(); // Update icon
  saveData();
  // Re-render charts to adapt to new theme
  updateDashboard();
}

function applyTheme() {
  const themeIcon = document.getElementById('theme-icon');
  const resolvedSettings = normalizeSettings(settings, defaultSettings);
  settings = resolvedSettings;
  const isDark = getThemePreference(resolvedSettings, 'light') === 'dark';

  if (isDark) {
    document.body.classList.add('dark-mode');
    if (themeIcon) themeIcon.textContent = '🌙'; // Moon icon
  } else {
    document.body.classList.remove('dark-mode');
    if (themeIcon) themeIcon.textContent = '☀️'; // Sun icon
  }
}

function handleSplashScreen() {
  if (window._splashStarted) return;
  window._splashStarted = true;

  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    const header = document.querySelector('header');
    const appLayout = document.querySelector('.app-layout');

    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
        document.body.classList.remove('loading');
        if (header) {
          header.style.visibility = 'visible';
          header.style.opacity = '1';
        }
        if (appLayout) {
          appLayout.style.visibility = 'visible';
          appLayout.style.opacity = '1';
        }
      }, 800);
    }
  }, 3000);
}

// ===== Settings Accordion =====
function setupSettingsAccordion() {
  const headers = document.querySelectorAll('#settingsTab .settings-header');
  const settingsTab = document.getElementById('settingsTab');
  const allGroups = document.querySelectorAll('#settingsTab .settings-group');

  headers.forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling;
      const parentGroup = header.closest('.settings-group');
      const wasActive = header.classList.contains('active');
      const contentClass = header.dataset.contentClass;

      if (wasActive) {
        // It was active, so close it and show all other groups
        header.classList.remove('active');
        content.style.maxHeight = null;
        content.style.padding = "0 20px";
        content.classList.remove('active');
        if (contentClass) {
          content.classList.remove(contentClass);
        }
        allGroups.forEach(group => group.style.display = 'block');
      } else {
        // It was not active, so open it and hide all other groups
        // First, close any other potentially open group
        headers.forEach(h => {
          h.classList.remove('active');

          const c = h.nextElementSibling;
          c.style.maxHeight = null;
          c.style.padding = "0 20px";
          c.classList.remove('active');
          const otherContentClass = h.dataset.contentClass;
          if (otherContentClass) {
            c.classList.remove(otherContentClass);
          }
        });
        allGroups.forEach(group => group.style.display = 'none');
        parentGroup.style.display = 'block';
        header.classList.add('active');
        content.classList.add('active');
        if (contentClass) {
          content.classList.add(contentClass);
        }

        // Calculate available height for scrolling
        // Special handling for management sections to take up full height
        content.style.maxHeight = content.scrollHeight + "px";
        content.style.padding = "20px";
      }
    });
  });
}

// ===== Inventory Management (Settings Tab) =====
function renderInventoryReport() {
  const tbody = document.getElementById('lowStockReportBody');
  const dashboardTbody = document.getElementById('dashboardLowStockBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const threshold = (settings.lowStockThreshold !== undefined && settings.lowStockThreshold !== null) ? settings.lowStockThreshold : 10;

  // Only check primary ingredients (items with a stock property) for the low stock report.
  const lowStockItems = menu.filter(item => item.stock !== undefined && item.stock <= threshold);

  if (lowStockItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 15px;">No items are currently low on stock.</td></tr>`;
    if (dashboardTbody) dashboardTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 12px;">No items are currently low on stock.</td></tr>`;
    return;
  }
  // Populate full low stock table
  lowStockItems.forEach(item => {
    const stock = calculateDishStock(item, true);
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td style="text-align: right; color: #dc3545; font-weight: bold;">${Number(stock).toFixed(1)}</td>
      `;
    tbody.appendChild(tr);
  });

  // Populate dashboard low stock with up to 5 items for quick view
  if (dashboardTbody) {
    dashboardTbody.innerHTML = '';
    lowStockItems.slice(0, 5).forEach(item => {
      const stock = calculateDishStock(item, true);
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${item.name}</td>
          <td>${item.category}</td>
          <td style="text-align: right; color: #dc3545; font-weight: bold;">${Number(stock).toFixed(1)}</td>
        `;
      dashboardTbody.appendChild(tr);
    });
  }
}

function renderStockListTable() {
  const searchTerm = document.getElementById('stockSearchInput')?.value.toLowerCase() || '';
  const tbody = document.getElementById('stockListBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Filter to show only raw ingredients (items with a 'stock' property)
  const stockItems = menu.filter(item => item.stock !== undefined && (!searchTerm || item.name.toLowerCase().includes(searchTerm)));

  stockItems.forEach((item, rowIndex) => {
    const index = menu.indexOf(item);
    const stock = calculateDishStock(item, true);
    const costPrice = item.costPrice || 0;
    const totalCost = stock * costPrice;
    const tr = document.createElement('tr');


    tr.innerHTML = `
        <td style="text-align: center;"><input type="checkbox" class="table-row-select" onchange="updateSelectAllHeader('stockListBody','selectAllStock')"></td>
        <td>${rowIndex + 1}</td>
        <td class="u-fs-08 u-text-break">${item.name}</td> 
        <td class="u-fs-08">${(item.recipe && item.recipe.length > 0) ? 'Recipe' : (item.unit || 'N/A')}</td>
        <td class="u-fs-08 u-text-right u-nowrap"><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(costPrice)}</td>
        <td class="u-fs-08 u-text-right">${Number(stock).toFixed(1)}</td>
        <td class="u-fs-08 u-text-right"><span class="currency-symbol">${settings.currency || '$'}</span>${formatCurrency(totalCost)}</td>
        <td class="u-text-right table-actions-cell">
          <button class="icon-btn" title="Adjust Stock" onclick="toggleStockAdjustmentForm(true, ${index})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311a1.464 1.464 0 0 1-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413-1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/></svg></button>
          <button class="icon-btn" title="Edit Item" onclick="editStockItem(${index})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V12h2.293l6.5-6.5-.207-.207z"/></svg></button>
          <button class="icon-btn" title="Add to Shop" onclick="convertToProduct(${index})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#28a745" viewBox="0 0 16 16"><path d="M3 2v4.586l7 7L14.586 9l-7-7H3zM2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586V2z"/><path d="M5.5 5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm0 1a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg></button>
          <button class="icon-btn" title="Delete Item" onclick="deleteItem(${index})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#dc3545" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>
        </td>
      `;
    tbody.appendChild(tr);
  });
}

function editStockItem(index) {
  const item = menu[index];
  if (!item || item.stock === undefined) {
    return showAppAlert("This item cannot be edited here. Please edit it from the 'Products' section.", 'Stock Edit Blocked');
  }

  // Show the form
  toggleNewStockItemForm(true);

  // Populate the form with the item's data
  document.getElementById('newStockItemName').value = item.name;
  document.getElementById('newStockItemUnit').value = item.unit || '';
  document.getElementById('newStockItemCost').value = item.costPrice || 0;
  document.getElementById('newStockItemPrice').value = item.price || 0;
  document.getElementById('newStockItemStock').value = item.stock || 0;

  // Store the index of the item being edited
  const formContainer = document.getElementById('newStockItemFormContainer');
  formContainer.dataset.editingIndex = index;
}

function convertToProduct(index) {
  const item = menu[index];
  if (!item) return;

  // Switch to Products tab
  const productsBtn = document.querySelector('nav button[onclick*="addDishTab"]');
  if (productsBtn) showTab('addDishTab', productsBtn);

  // Open the form and pre-fill
  toggleAddDishForm(true);
  document.getElementById('dishIndex').value = index;
  document.getElementById('dishName').value = item.name;
  document.getElementById('dishBarcode').value = item.barcode || '';
  document.getElementById('dishSellingPrice').value = parseFloat(item.price) || 0;

  // Automatically assign a category
  const defaultCat = item.category || (dishCategories.length > 0 ? dishCategories[0] : "");
  document.getElementById('dishCategory').value = defaultCat;

  document.getElementById('dishImageBase64').value = item.image || '';
  document.getElementById('dishImagePreview').src = item.image || 'https://placehold.co/100';

  // Trigger auto-barcode generation for the new product
  generateAutoBarcode();
  updateRecipeTotals();
}

function toggleStockAdjustmentForm(show, index = null) {
  const formContainer = document.getElementById('stockAdjustmentFormContainer');
  if (show && index !== null) {
    const item = menu[index];
    if (item.stock === undefined) {
      return showAppAlert(`Cannot directly adjust stock for "${item.name}" because it is a composite dish made from a recipe. Adjust the stock of its individual ingredients instead.`, 'Stock Adjustment Blocked');
    }
    document.getElementById('stockItemIndex').value = index;
    document.getElementById('stockAdjustItemName').textContent = `Adjust Stock for: ${item.name} (Current: ${item.stock})`;
    document.getElementById('newStockValue').value = '';
    formContainer.style.display = 'block';
    document.getElementById('newStockValue').focus();
  } else {
    formContainer.style.display = 'none';
    document.getElementById('stockItemIndex').value = '';
  }
}

async function saveStockAdjustment() {
  const index = document.getElementById('stockItemIndex').value;
  const newStockInput = document.getElementById('newStockValue');
  const newStock = parseInt(newStockInput.value, 10);

  if (index === '' || isNaN(newStock) || newStock < 0) {
    return showAppAlert("Please enter a valid, non-negative number for the stock.", 'Invalid Stock');
  }

  // Warning for zero stock if the item is used in popular products
  if (newStock === 0) {
    const itemName = menu[index].name;
    const dependentDishes = menu.filter(d => d.recipe && d.recipe.some(c => c.itemName === itemName));

    if (dependentDishes.length > 0) {
      // Identify top 5 best-selling items from transaction history
      const itemSales = transactions.flatMap(t => t.items || []).reduce((acc, item) => {
        acc[item.name] = (acc[item.name] || 0) + (item.qty || 0);
        return acc;
      }, {});

      const topSellers = Object.entries(itemSales)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name]) => name);

      const affectedPopular = dependentDishes.filter(d => topSellers.includes(d.name)).map(d => d.name);

      if (affectedPopular.length > 0) {
        const proceed = await showAppConfirm(`Warning: Setting stock to zero for "${itemName}" will make these popular products OUT OF STOCK:\n\n${affectedPopular.join('\n')}\n\nAre you sure you want to proceed?`, 'Low Stock Warning', 'Continue', 'Cancel');
        if (!proceed?.confirmed) return;
      }
    }
  }

  const oldStock = menu[index].stock;
  menu[index].stock = newStock;
  menu[index] = enrichEnterpriseRecord('products', menu[index], menu[index]);
  enqueueEnterpriseRecordChange('products', menu[index], 'upsert').catch(console.warn);

  const restockRecord = enrichEnterpriseRecord('inventoryHistory', {
    date: new Date().toISOString(),
    itemName: menu[index].name,
    itemId: menu[index].recordId || menu[index].id || null,
    adjustment: newStock - oldStock,
    newTotal: newStock,
    note: 'Manual Stock Adjustment'
  });
  restockHistory.unshift(restockRecord);
  enqueueEnterpriseRecordChange('inventory_history', restockRecord, 'upsert').catch(console.warn);
  if (restockHistory.length > 100) restockHistory.pop();

  saveData();

  // Re-render all relevant views
  toggleStockAdjustmentForm(false); // Hide form
  renderStockListTable();
  renderInventoryReport();
  renderDishesTable();
  renderMenu();
}

function toggleNewStockItemForm(show) {
  const formContainer = document.getElementById('newStockItemFormContainer');
  const toggleButton = document.querySelector('#settingsTab h5 button[onclick*="toggleNewStockItemForm"]');
  if (show) {
    formContainer.style.display = 'block';
    if (toggleButton) toggleButton.style.display = 'none';
    populateUnitDropdown();
    clearNewStockItemForm();
  } else {
    formContainer.style.display = 'none';
    if (toggleButton) toggleButton.style.display = 'inline-block';
  }
}

function populateUnitDropdown() {
  const unitSelect = document.getElementById('newStockItemUnit');
  if (!unitSelect) return;
  unitSelect.innerHTML = `<option value="" disabled selected>Select Unit</option>` + units.map(u => `<option value="${u.short}">${u.short}</option>`).join('');
}

async function saveNewStockItem() {
  console.log('[DEBUG_STOCK] saveNewStockItem start');
  try {
  const name = document.getElementById('newStockItemName').value.trim();
  const unit = document.getElementById('newStockItemUnit').value;
  const costPrice = parseFloat(document.getElementById('newStockItemCost').value);
  const sellingPriceInput = document.getElementById('newStockItemPrice').value;
  const stock = parseInt(document.getElementById('newStockItemStock').value, 10);

  if (!name) {
    return showAppAlert("Please enter an item name.", 'Item Name Required');
  }
  if (!unit) {
    return showAppAlert("Please select a unit.", 'Unit Required');
  }
  if (isNaN(costPrice) || costPrice < 0) {
    return showAppAlert("Please enter a valid cost price.", 'Invalid Cost');
  }
  if (isNaN(stock) || stock < 0) {
    return showAppAlert("Please enter a valid stock quantity.", 'Invalid Stock');
  }

  const itemIndex = document.getElementById('newStockItemFormContainer').dataset.editingIndex;
  const existingMatchIndex = !itemIndex ? getProductCatalogMatchIndex(name) : -1;

  if (itemIndex) {
    // Update existing item
    const index = parseInt(itemIndex, 10);
    const item = menu[index];
    const oldName = item.name;

    item.name = name;
    item.unit = unit;
    item.costPrice = costPrice;
    item.stock = stock;
    menu[index] = enrichEnterpriseRecord('products', item, item);
    // If name changed, update all recipes and active orders to keep the app working perfectly
    if (oldName !== name) {
      // Identify which products will be affected by this rename
      const affectedProducts = menu.filter(d => d.recipe && d.recipe.some(c => c.itemName === oldName)).map(d => d.name);

      if (affectedProducts.length > 0) {
        const confirmRename = await showAppConfirm(`Renaming "${oldName}" to "${name}" will automatically update recipes for the following products:\n\n${affectedProducts.join('\n')}\n\nDo you want to proceed?`, 'Confirm Rename', 'Continue', 'Cancel');
        if (!confirmRename?.confirmed) return;
      }

      menu.forEach(d => {
        if (d.recipe) {
          d.recipe.forEach(c => { if (c.itemName === oldName) c.itemName = name; });
        }
      });
      Object.keys(activeOrders).forEach(cartId => {
        if (activeOrders[cartId].items) {
          activeOrders[cartId].items.forEach(orderItem => {
            if (orderItem.name === oldName) {
              orderItem.name = name;
            }
          });
        }
      });
    }

    if (sellingPriceInput && !isNaN(parseFloat(sellingPriceInput))) {
      item.price = parseFloat(sellingPriceInput);
    } else {
      // Recalculate price based on markup in case cost changed
      item.price = costPrice * (1 + ((settings.defaultMarkup || 200) / 100));
    }
    enqueueEnterpriseRecordChange('products', menu[index], 'upsert').catch(console.warn);
    await showAppAlert(`Item "${name}" updated successfully.`, 'Stock Item Updated');
  } else if (existingMatchIndex >= 0) {
    const existingItem = menu[existingMatchIndex];
    const updatedItem = mergeProductRecord(existingItem || {}, {
      ...existingItem,
      name,
      category: existingItem?.category || null,
      costPrice,
      stock,
      unit,
      price: (() => {
        if (sellingPriceInput && !isNaN(parseFloat(sellingPriceInput))) return parseFloat(sellingPriceInput);
        const markup = (settings.defaultMarkup || 200) / 100;
        return costPrice * (1 + markup);
      })(),
      image: existingItem?.image || undefined
    });
    menu[existingMatchIndex] = enrichEnterpriseRecord('products', updatedItem, existingItem);
    enqueueEnterpriseRecordChange('products', menu[existingMatchIndex], 'upsert').catch(console.warn);
    await showAppAlert(`Item "${name}" updated successfully.`, 'Stock Item Updated');
  } else {
    // Add new item
    console.log('[DEBUG_STOCK] Adding new stock item', { name, unit, costPrice, stock });
    // It's a primary ingredient, so calculate its selling price based on markup
    let price;
    if (sellingPriceInput && !isNaN(parseFloat(sellingPriceInput))) {
      price = parseFloat(sellingPriceInput);
    } else {
      const markup = (settings.defaultMarkup || 200) / 100;
      price = costPrice * (1 + markup);
    }
    const newItem = enrichEnterpriseRecord('products', {
      name,
      category: null, // No default category
      costPrice,
      stock,
      unit,
      price,
      image: undefined
    });

    const restockRecord = enrichEnterpriseRecord('inventoryHistory', {
      date: new Date().toISOString(),
      itemName: name,
      adjustment: stock,
      newTotal: stock,
      note: 'Initial Stock'
    });

    restockHistory.unshift(restockRecord);
    enqueueEnterpriseRecordChange('inventory_history', restockRecord, 'upsert').catch(console.warn);
    menu.push(newItem);
    try { if (newItem && (newItem.recordId || newItem.id)) lastLocallyAddedProductIds.add(newItem.recordId || newItem.id); } catch(e) {}
    console.log('[DEBUG_STOCK] newItem prepared', { newItem });
    try {
      await enqueueEnterpriseRecordChange('products', newItem, 'upsert');
    } catch (e) { console.warn('[DEBUG_STOCK] enqueueEnterpriseRecordChange failed', e); }
    console.log('[DEBUG_STOCK] newItem pushed to menu', { name, menuLen: menu.length });
    await showAppAlert(`Item \"${name}\" added successfully.`, 'Stock Item Added');
  }

  // Ensure local save completes before closing the form to reduce race conditions
  try {
    console.log('[DEBUG_STOCK] calling saveData', { menuLenBefore: menu.length });
    await saveData();
    console.log('[DEBUG_STOCK] saveData completed', { menuLen: menu.length, containsNew: !!menu.find(m => m && m.name === name) });
  } catch (e) {
    console.error('[DEBUG_STOCK] saveData failed', e);
  }
  try {
    toggleNewStockItemForm(false);
    renderStockListTable();
    renderMenu();
    renderDishesTable();
  } catch (e) { console.error('[DEBUG_STOCK] render after save failed', e); }
  console.log('[DEBUG_STOCK] saveNewStockItem end');
  } catch (errSave) {
    console.error('[DEBUG_STOCK] saveNewStockItem error', errSave);
    try { showAppAlert('An error occurred while saving the stock item. Check console for details.', 'Save Failed'); } catch (e) {}
  }
}

/**
 * Automatically generates a formatted barcode/QR code based on Category and Name
 * Format: [CatPrefix]-[ProdPrefix]-[Seq] (e.g., SO-MI-01)
 */
function generateAutoBarcode(force = false) {
  const nameInput = document.getElementById('dishName');
  const catSelect = document.getElementById('dishCategory');
  const barcodeInput = document.getElementById('dishBarcode');
  const dishIndexInput = document.getElementById('dishIndex');
  const dishIndex = dishIndexInput ? dishIndexInput.value : '';

  // Only auto-generate if the field is empty OR if we are forcing it via the button
  if (!force && barcodeInput && barcodeInput.value !== '') return;

  const name = nameInput ? nameInput.value.trim() : '';
  const cat = catSelect ? catSelect.value : '';

  if (force) {
    if (!name || name.length < 2) {
      showAppAlert("Please enter a product name first (at least 2 letters).", 'Product Name Required');
      return;
    }
    if (!cat) {
      showAppAlert("Please select a category first.", 'Category Required');
      return;
    }
  }

  if (!name || name.length < 2 || !cat || cat.length < 2) return;

  // Extract prefixes (first 2 letters, forced to UPPERCASE)
  const catPrefix = cat.substring(0, 2).toUpperCase();
  const prodPrefix = name.substring(0, 2).toUpperCase();
  const basePrefix = `${catPrefix}-${prodPrefix}-`;

  // Find next number in sequence for this specific prefix across existing products
  let maxNum = 0;
  menu.forEach(item => {
    if (item.barcode && item.barcode.includes('-')) {
      const parts = item.barcode.split('-');
      const lastPart = parts[parts.length - 1];
      const num = parseInt(lastPart, 10);
      // Global sequence check: ensures we continue from the last saved product number (e.g. 12 -> 13)
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });

  const nextNum = (maxNum + 1).toString().padStart(2, '0');
  if (barcodeInput) barcodeInput.value = basePrefix + nextNum;
}

function clearNewStockItemForm() {
  document.getElementById('newStockItemName').value = '';
  document.getElementById('newStockItemUnit').value = '';
  document.getElementById('newStockItemCost').value = '';
  document.getElementById('newStockItemPrice').value = '';
  document.getElementById('newStockItemStock').value = '';
  delete document.getElementById('newStockItemFormContainer').dataset.editingIndex;
}

function renderRestockHistoryTable() {
  const tbody = document.getElementById('restockHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = restockHistory.map(log => `
      <tr>
        <td class="u-fs-08">${new Date(log.date).toLocaleString()}</td>
        <td class="u-fs-08">${log.itemName}</td>
        <td class="u-fs-08 u-text-right u-bold" style="color: ${log.adjustment >= 0 ? '#28a745' : '#dc3545'};">
          ${log.adjustment > 0 ? '+' : ''}${log.adjustment}
        </td>
        <td class="u-fs-08 u-text-right">${log.newTotal}</td>
      </tr>
    `).join('');
}

// ===== Real-Time Cloud Sync =====
let unsubscribeSync = null;
let lastRemoteDataHash = '';
let cloudSyncChannel = null;
const cloudSyncChannelName = 'yoshop-cloud-sync';
const cloudHashIgnoredKeys = new Set(['updatedAt', 'lastUpdated', 'lastSyncedAt', 'lastSyncAt', 'createdAt', 'date', 'timestamp', 'version', 'syncStatus', 'businessId', 'userId', 'staffId', 'deviceId']);

function normalizeCloudHashValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map(item => normalizeCloudHashValue(item));
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .filter(key => !cloudHashIgnoredKeys.has(key))
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeCloudHashValue(value[key]);
        return acc;
      }, {});
  }

  return String(value);
}

function getCloudDataHash(data) {
  if (!data) return '';

  const normalizedPayload = {
    menu: normalizeCloudHashValue(getCloudMenuItems(data)),
    activeOrders: normalizeCloudHashValue(data.activeOrders || {}),
    settings: normalizeCloudHashValue(data.settings || {}),
    staff: normalizeCloudHashValue(Array.isArray(data.staff) ? data.staff : []),
    customers: normalizeCloudHashValue(Array.isArray(data.customers) ? data.customers : []),
    categories: normalizeCloudHashValue(getCloudCategoryList(data)),
    units: normalizeCloudHashValue(Array.isArray(data.units) ? data.units : []),
    restockHistory: normalizeCloudHashValue(Array.isArray(data.restockHistory) ? data.restockHistory : []),
    appAdminSettings: normalizeCloudHashValue(data.appAdminSettings || {})
  };

  return JSON.stringify(normalizedPayload);
}

function notifyOtherTabsAboutCloudChange(targetUid) {
  if (cloudSyncChannel) {
    cloudSyncChannel.postMessage({
      type: 'YOSHOP_CLOUD_CHANGED',
      uid: targetUid
    });
  }
}

/**
 * Sets up real-time listener for cross-device/cross-tab synchronization
 * Updates all tabs/devices instantly when cloud data changes
 */
let unsubscribeEnterpriseRecordSyncs = [];
// Track recent locally-added product IDs for debugging sync merges
const lastLocallyAddedProductIds = new Set();

function stopEnterpriseRecordSyncs() {
  unsubscribeEnterpriseRecordSyncs.forEach(unsubscribe => {
    try { unsubscribe(); } catch (error) { console.warn('[SYNC] Record listener cleanup failed:', error); }
  });
  unsubscribeEnterpriseRecordSyncs = [];
}

function getEnterpriseRecordId(record = {}) {
  return record.recordId || record.id || record.name || record.short || '';
}

function getRecordTimestamp(record = {}) {
  const value = record.updatedAt || record.lastSyncAt || record.lastSyncedAt || record.createdAt || record.date || '';
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function shouldAcceptIncomingRecord(localRecord = {}, incomingRecord = {}) {
  const localVersion = Number(localRecord.version || 0);
  const incomingVersion = Number(incomingRecord.version || 0);

  if (incomingVersion > localVersion) return true;
  if (incomingVersion < localVersion) return false;

  return getRecordTimestamp(incomingRecord) >= getRecordTimestamp(localRecord);
}
const loggedSyncConflicts = new Set();

function logRejectedIncomingRecord(entityType, localRecord = {}, incomingRecord = {}) {
  const recordId = getEnterpriseRecordId(localRecord) || getEnterpriseRecordId(incomingRecord);
  const conflictKey = [
    entityType,
    recordId,
    localRecord.version || 0,
    incomingRecord.version || 0,
    localRecord.updatedAt || localRecord.lastSyncAt || '',
    incomingRecord.updatedAt || incomingRecord.lastSyncAt || ''
  ].join('|');

  if (loggedSyncConflicts.has(conflictKey)) return;
  loggedSyncConflicts.add(conflictKey);

  console.info('[SYNC_CONFLICT] Older incoming record ignored:', {
    entityType,
    recordId,
    localVersion: localRecord.version || 0,
    incomingVersion: incomingRecord.version || 0,
    localUpdatedAt: localRecord.updatedAt || localRecord.lastSyncAt || null,
    incomingUpdatedAt: incomingRecord.updatedAt || incomingRecord.lastSyncAt || null
  });

  appendAuditEvent('sync_conflict_ignored', {
    entityType,
    recordId,
    localVersion: localRecord.version || 0,
    incomingVersion: incomingRecord.version || 0,
    localUpdatedAt: localRecord.updatedAt || localRecord.lastSyncAt || null,
    incomingUpdatedAt: incomingRecord.updatedAt || incomingRecord.lastSyncAt || null
  });

  persistAuditTrail().catch(() => { });
}

function upsertEnterpriseRecord(records = [], incomingRecord = {}, entityType) {
  const hydratedRecord = hydrateEnterpriseRecord(entityType, incomingRecord);
  const incomingId = getEnterpriseRecordId(hydratedRecord);
  if (!incomingId) return records;

  const nextRecords = Array.isArray(records) ? [...records] : [];
  const index = nextRecords.findIndex(record => getEnterpriseRecordId(record) === incomingId);

  if (index >= 0) {
    const localRecord = nextRecords[index];
    if (!shouldAcceptIncomingRecord(localRecord, hydratedRecord)) {
      logRejectedIncomingRecord(entityType, localRecord, hydratedRecord);
      return nextRecords;
    }

    nextRecords[index] = {
      ...localRecord,
      ...hydratedRecord
    };
  } else {
    nextRecords.push(hydratedRecord);
  }

  return nextRecords;
}

function removeEnterpriseRecord(records = [], removedRecord = {}) {
  const removedId = getEnterpriseRecordId(removedRecord);
  if (!removedId || !Array.isArray(records)) return records;
  return records.filter(record => getEnterpriseRecordId(record) !== removedId);
}
function isDeletedEnterpriseRecord(record = {}) {
  return (
    record.deleted === true ||
    record.isDeleted === true ||
    record.operation === 'delete' ||
    record.syncStatus === 'deleted' ||
    Boolean(record.deletedAt)
  );
}

function setupEnterpriseRecordCollectionSync(uid) {
  if (!dbFirestore || !uid) return;

  stopEnterpriseRecordSyncs();

  const collectionConfigs = [
    {
      collectionName: 'products',
      entityType: 'products',
      getRecords: () => menu,
      setRecords: records => { menu = normalizeProductCatalog(records); },
      render: () => {
        renderMenu();
        renderDishesTable();
        renderStockListTable();
        renderInventoryReport();
        populateCategoryFilter();
      }
    },
    {
      collectionName: 'categories',
      entityType: 'categories',
      getRecords: () => dishCategories,
      setRecords: records => {
        dishCategories = normalizeCategoryList((records || []).map(getCategoryNameFromRecord));
      },
      render: () => {
        renderCategoryList();
        populateCategoryDropdown();
        populateCategoryFilter();
        updateDashboard();
      }
    },

    {
      collectionName: 'customers',
      entityType: 'customers',
      getRecords: () => customers,
      setRecords: records => { customers = records; },
      render: () => { renderCustomerList(); }
    },
    {
      collectionName: 'staff',
      entityType: 'staff',
      getRecords: () => staff,
      setRecords: records => { staff = records; },
      render: () => { renderStaffList(); populateReportFilters(); }
    },
    {
      collectionName: 'units',
      entityType: 'units',
      getRecords: () => units,
      setRecords: records => { units = records; },
      render: () => { renderUnitList(); populateUnitDropdown(); }
    }
    ,
    {
      collectionName: 'inventory_history',
      entityType: 'inventoryHistory',
      getRecords: () => restockHistory,
      setRecords: records => {
        restockHistory = records.sort((a, b) => new Date(b.date || b.updatedAt || 0) - new Date(a.date || a.updatedAt || 0)).slice(0, 100);
      },
      render: () => { renderRestockHistoryTable(); renderInventoryReport(); }
    }
  ];

  unsubscribeEnterpriseRecordSyncs = collectionConfigs.map(config => {
    const recordRef = collection(dbFirestore, 'users', uid, config.collectionName);

    return onSnapshot(
      recordRef,
      { includeMetadataChanges: true },
      async snapshot => {
        try {
          if (config.collectionName === 'products') {
            console.log(`[SYNC_PRODUCTS] snapshot received: docChanges=${snapshot.docChanges().length} remoteSize=${snapshot.size} localMenu=${Array.isArray(menu)?menu.length:0} trackedLocalAdded=${Array.from(lastLocallyAddedProductIds).slice(0,5)}`);
          }
        } catch (e) { /* ignore logging errors */ }

        if (snapshot.metadata.hasPendingWrites) return;

        let nextRecords = config.getRecords();

        snapshot.docChanges().forEach(change => {
          const record = {
            ...change.doc.data(),
            id: change.doc.data().id || change.doc.id,
            recordId: change.doc.data().recordId || change.doc.data().id || change.doc.id
          };

          if (change.type === 'removed' || isDeletedEnterpriseRecord(record)) {
            nextRecords = removeEnterpriseRecord(nextRecords, record);
          } else {
            nextRecords = upsertEnterpriseRecord(nextRecords, record, config.entityType);
          }
        });

        config.setRecords(nextRecords);
        try {
          if (config.collectionName === 'products') {
            const presentIds = (nextRecords || []).map(r => getEnterpriseRecordId(r));
            const missing = Array.from(lastLocallyAddedProductIds).filter(id => !presentIds.includes(id));
            if (missing.length > 0) {
              console.warn('[SYNC_PRODUCTS] Local-added product IDs missing after snapshot:', missing, 'presentIdsSample=', presentIds.slice(0,10));
            } else {
              console.log('[SYNC_PRODUCTS] Local-added products present after snapshot');
            }
          }
        } catch (e) { /* ignore */ }

        config.render();
        updateDashboard();

        await saveData(false, { skipEnterpriseMirror: true });
      },
      error => {
        console.warn(`[SYNC] ${config.collectionName} record listener failed:`, error);
      }
    );
  });
}
function setupRealTimeSync(uid) {
  if (!dbFirestore) {
    console.warn("🔴 Firestore not initialized, skipping real-time sync");
    isInitialLoadComplete = true; // Allow local-only operation
    return;
  }

  if (unsubscribeSync) unsubscribeSync();
  stopEnterpriseRecordSyncs();
  if (unsubscribeTransactionsSync) {
    unsubscribeTransactionsSync();
    unsubscribeTransactionsSync = null;
  }

  if ('BroadcastChannel' in window && !cloudSyncChannel) {
    cloudSyncChannel = new BroadcastChannel(cloudSyncChannelName);
    cloudSyncChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'YOSHOP_CLOUD_CHANGED' && event.data.uid === uid) {
        console.log('📡 [SYNC] Broadcast refresh requested by another tab');
        if (typeof loadTransactionsFromCloud === 'function') {
          loadTransactionsFromCloud(uid);
        }
        refreshCurrentView();
        updateDashboard();
      }
    };
  }

  try {
    console.log('🟢 [SYNC] Setting up real-time listener for cross-device sync...');
    setupRealTimeTransactionsSync(uid);
    setupEnterpriseRecordCollectionSync(uid);
    cleanupDuplicateProductRecordsInCloud(uid).catch(error => {
      console.warn('[DB_CLEANUP] Duplicate product cleanup skipped:', error);
    });
    backfillEnterpriseRecordCollectionsOnce(uid).catch(error => {
      console.warn('[MIGRATION] Enterprise record backfill skipped:', error);
    });

    // ===== PRODUCTION OPTIMIZATION: Debounced real-time updates =====
    let pendingUpdate = null;
    let updateTimer = null;

    unsubscribeSync = onSnapshot(
      doc(dbFirestore, "users", uid, "data", "shop_profile"),
      { includeMetadataChanges: true },
      (docSnap) => {
        if (docSnap.exists()) {
          const cloudData = docSnap.data();
          const cloudHash = getCloudDataHash(cloudData);

          // Only update if changes come from the cloud (server)
          // hasPendingWrites = true means this is our local change being reflected
          // hasPendingWrites = false means this is an update from another device
          if (!docSnap.metadata.hasPendingWrites) {
            const isNewRemoteData = cloudHash !== lastRemoteDataHash;
            const shouldApplyRemoteRefresh = isNewRemoteData && cloudHash;

            if (shouldApplyRemoteRefresh) {
              console.log('🔄 [SYNC] ✅ Immediate refresh triggered by new cloud data');
              notifyOtherTabsAboutCloudChange(uid);

              // DEBOUNCE: Collect updates and apply them in batch to prevent UI thrashing
              if (updateTimer) clearTimeout(updateTimer);

              // SAFE MERGE: Prefer cloud data only when it has actual content.
              // Never let an empty/null cloud field overwrite non-empty local data.
              // This prevents backgrounding sync races from wiping local state.
              const safeArray = (cloudVal, localVal) => {
                if (Array.isArray(cloudVal) && cloudVal.length > 0) return cloudVal;
                if (Array.isArray(cloudVal) && cloudVal.length === 0 && Array.isArray(localVal) && localVal.length === 0) return cloudVal;
                return Array.isArray(localVal) && localVal.length > 0 ? localVal : (cloudVal || localVal || []);
              };
              const safeObj = (cloudVal, localVal) => {
                if (cloudVal && typeof cloudVal === 'object' && Object.keys(cloudVal).length > 0) return cloudVal;
                return localVal || cloudVal || {};
              };
              pendingUpdate = {
                menu: hydrateEnterpriseRecords('products', safeArray(getCloudMenuItems(cloudData), menu)),
                activeOrders: safeObj(cloudData.activeOrders, activeOrders),
                settings: pickNewestSettingsRecord(settings, cloudData.settings, defaultSettings),
                staff: hydrateEnterpriseRecords('staff', safeArray(cloudData.staff, staff)),
                dishCategories: safeArray(getCloudCategoryList(cloudData), dishCategories),
                customers: hydrateEnterpriseRecords('customers', safeArray(cloudData.customers, customers)),
                units: hydrateEnterpriseRecords('units', safeArray(cloudData.units, units)),
                restockHistory: hydrateEnterpriseRecords('inventoryHistory', safeArray(cloudData.restockHistory, restockHistory)),
                appAdminSettings: pickNewestSettingsRecord(appAdminSettings, cloudData.appAdminSettings, defaultAppAdminSettings)
              };

              // ANTI-DATA-LOSS GUARD: If cloud has significantly fewer menu items than
              // current memory, it may be a stale/corrupted write. Log and skip.
              if (menu.length > 0 && pendingUpdate.menu.length === 0) {
                console.warn('[SYNC] ⚠️ Cloud has 0 menu items but local has', menu.length, '- skipping menu update to prevent data loss');
                pendingUpdate.menu = menu;
              }

              // Apply batched updates as soon as new remote data is detected.
              // This is intentionally faster so other devices feel instant.
              const applyDelay = 50;
              updateTimer = setTimeout(async () => {
                const updateData = pendingUpdate;
                if (!updateData) {
                  return;
                }
                try {
                  // Identify and clear changed images/logos from cache
                  if (Array.isArray(updateData.menu)) {
                    updateData.menu.forEach(cloudDish => {
                      if (!cloudDish || !cloudDish.name || !Array.isArray(menu)) return;
                      const localDish = menu.find(d => d && d.name === cloudDish.name);
                      if (localDish && localDish.image && cloudDish.image && localDish.image !== cloudDish.image) {
                        clearImageFromCache(localDish.image);
                        clearImageFromCache(cloudDish.image);
                      }
                    });
                  }
                  if (updateData.settings && settings && updateData.settings.logo && settings.logo && settings.logo !== updateData.settings.logo) {
                    clearImageFromCache(settings.logo);
                    clearImageFromCache(updateData.settings.logo);
                  }

                  // Update global state with cloud data
                  try {
                    if (Array.isArray(updateData.menu)) {
                      console.log('[SYNC_MENU_APPLY] remote menu length=', updateData.menu.length, 'local menu length=', menu.length, 'sample remote names=', updateData.menu.slice(0,5).map(m=>m.name), 'sample local names=', menu.slice(0,5).map(m=>m.name));
                    }
                  } catch(e) { /* ignore logging errors */ }
                  // Merge remote menu with local pending/new items to avoid overwriting recent local adds
                  if (Array.isArray(updateData.menu) && Array.isArray(menu)) {
                    const remoteById = new Map();
                    updateData.menu.forEach(r => {
                      try { remoteById.set(getEnterpriseRecordId(r), r); } catch (e) { }
                    });

                    const merged = [];

                    updateData.menu.forEach(remote => {
                      try {
                        const id = getEnterpriseRecordId(remote);
                        const local = menu.find(m => getEnterpriseRecordId(m) === id);
                        const copy = { ...(remote || {}) };

                        // Preserve images from local when remote lacks them
                        if (!isValidMenuImage(copy.image)) {
                          if (local && isValidMenuImage(local.image)) copy.image = local.image;
                          else {
                            const cached = getCachedDishImage(copy.name);
                            if (cached) copy.image = cached;
                          }
                        }

                        // Prefer local pending or newer updates
                        if (local) {
                          const localUpdated = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
                          const remoteUpdated = copy.updatedAt ? new Date(copy.updatedAt).getTime() : 0;
                          const localPending = local.syncStatus === 'pending' || (local.deviceId && local.deviceId === getSyncMetadataContext().deviceId);
                          if (localPending || localUpdated > remoteUpdated) {
                            merged.push(local);
                            return;
                          }
                        }

                        merged.push(copy);
                      } catch (e) { merged.push(remote); }
                    });

                    // Include any purely-local items that the remote doesn't know about (new adds)
                    menu.forEach(local => {
                      try {
                        const id = getEnterpriseRecordId(local);
                        if (!remoteById.has(id)) merged.push(local);
                      } catch (e) { merged.push(local); }
                    });

                    updateData.menu = merged;
                  }
                  menu = normalizeProductCatalog(updateData.menu || []);
                  activeOrders = updateData.activeOrders;
                  settings = updateData.settings;
                  staff = updateData.staff;
                  dishCategories = updateData.dishCategories;
                  customers = updateData.customers;
                  units = updateData.units;
                  restockHistory = updateData.restockHistory;
                  appAdminSettings = updateData.appAdminSettings;

                  // Fetch transactions separately from sub-collection
                  await loadTransactionsFromCloud(uid);

                  // Ensure settings UI is refreshed when cloud settings arrive
                  if (typeof loadSettings === 'function') {
                    loadSettings();
                  }

                  // Mark initial load as complete
                  isInitialLoadComplete = true;

                  // Persist cloud data to local IndexedDB only (skip cloud push and mirror to avoid loops)
                  await saveData(false, { skipEnterpriseMirror: true });

                  // Force a complete refresh of the current view so changes show immediately
                  // CRITICAL FIX: Prevent image flashing in ALL categories by using surgical updates
                  const activeTab = document.querySelector('section.active');
                  if (activeTab) {
                    if (activeTab.id === 'menuTab') {
                      // For menu tab: ALWAYS use surgical update instead of full refresh
                      // This works for ALL categories (Accessories, Electronics, Beverages, Dairy, etc)
                      if (document.querySelector('.menu-item[data-product-name]')) {
                        updateMenuUI(); // Surgical update - only updates changed properties, images stay visible
                      } else {
                        renderMenu(); // First time rendering
                      }
                    } else {
                      // For other tabs: normal refresh
                      refreshCurrentView();
                    }
                  }
                  updateDashboard();
                  applyTheme();

                  // Update login staff list if snapshot arrives while overlay is up
                  const list = document.getElementById('staffNamesList');
                  if (list) {
                    list.innerHTML = '<option value="Admin">' + (Array.isArray(staff) ? staff : []).filter(s => s && s.isActive !== false).map(s => `<option value="${s.name || ''}">`).join('');
                  }

                  // Visual feedback on the sync button
                  const statusEl = document.getElementById('connectivity-status');
                  if (statusEl && statusEl.classList) {
                    statusEl.classList.add('sync-pulse');
                    setTimeout(() => statusEl.classList.remove('sync-pulse'), 600);
                  }

                  pendingUpdate = null;
                } catch (error) {
                  captureError('SYNC_UPDATE', error, { uid });
                }
              }, applyDelay);
            }
          } else {
            console.log('📤 [SYNC] Local write pending server acknowledgement');
            lastRemoteDataHash = cloudHash;
          }
        } else {
          // Document doesn't exist on cloud yet
          console.log('📝 [SYNC] No cloud data found, user can create new data');
          isInitialLoadComplete = true;
        }
      },
      (error) => {
        captureError('SYNC_LISTENER', error, { uid });
        handleFirebaseError(error, "Real-Time Sync Listener", `users/${uid}/data/shop_profile`);
        console.log('Falling back to local-only mode. You can still use the app offline.');
        isInitialLoadComplete = true; // Don't block local work if cloud fails
      }
    );
  } catch (error) {
    captureError('SYNC_SETUP', error, { uid });
    console.warn("🟡 [SYNC] Error setting up real-time sync:", error.message);
    isInitialLoadComplete = true; // Allow offline operation
  }
}

/**
 * Re-renders the currently active tab to show fresh data.
 */
function refreshCurrentView() {
  const activeTab = document.querySelector('section.active');
  if (!activeTab) return;

  const renderMap = {
    'dashboardTab': updateDashboard,
    'transactionsTab': renderTransactions,
    'menuTab': renderMenu,
    'addDishTab': renderDishesTable,
    'categoryTab': renderCategoryList,
    'unitTab': renderUnitList,
    'staffTab': renderStaffList,
    'customerTab': renderCustomerList,
    'settingsTab': () => { loadSettings(); },
    'stockTab': () => { renderInventoryReport(); renderStockListTable(); renderUnitList(); renderRestockHistoryTable(); },
    'reportsTab': () => { populateReportFilters(); renderReport(); }
  };
  if (renderMap[activeTab.id]) renderMap[activeTab.id]();
}

/**
 * Fetches the current version string from sw.js and updates the UI
 */
async function updateVersionDisplay() {
  const displayEl = document.getElementById('app-version-display');
  if (!displayEl) return;
  try {
    const response = await fetch('./sw.js', { cache: 'no-store' });
    if (response.ok) {
      const text = await response.text();
      const match = text.match(/CACHE_NAME\s*=\s*['"]yoshop-(v\d+)['"]/);
      if (match) displayEl.textContent = match[1].toUpperCase();
    } else {
      displayEl.textContent = '1.0.4'; // Fallback on non-200 response
    }
  } catch (e) {
    console.warn('[Version] Failed to fetch service worker version:', e.message);
    displayEl.textContent = '1.0.4'; // Fallback
  }

  renderSubscriptionFooterInfo();
  renderFooterClock();
  if (!window.subscriptionFooterTimer) {
    window.subscriptionFooterTimer = setInterval(() => {
      renderSubscriptionFooterInfo();
      renderFooterClock();
    }, 1000);
  }
}
async function loadLocalBusinessDataForUid(uid, options = {}) {
  const effectiveUid = uid || localStorage.getItem('lastUserUid') || sessionStorage.getItem('currentUserUid') || 'guest';

  await initDB(effectiveUid);

  const localData = await Promise.all([
    loadState('menu'),
    loadState('activeOrders'),
    loadState('transactions'),
    loadState('settings'),
    loadState('staff'),
    loadState('dishCategories'),
    loadState('customers'),
    loadState('units'),
    loadState('restockHistory'),
    loadState('appAdminSettings'),
    loadState('auditTrail')
  ]);

  settings = normalizeSettings(localData[3], defaultSettings);
  menu = hydrateEnterpriseRecords('products', localData[0] || []);
  activeOrders = localData[1] || {};
  transactions = deduplicateTransactions(hydrateEnterpriseRecords('sales', localData[2] || []));
  staff = hydrateEnterpriseRecords('staff', localData[4] || []);
  dishCategories = localData[5] || [];
  customers = hydrateEnterpriseRecords('customers', localData[6] || []);
  units = hydrateEnterpriseRecords('units', localData[7] || [
    { full: 'Bottle', short: 'btl' },
    { full: 'Box', short: 'box' },
    { full: 'Can', short: 'can' },
    { full: 'Case', short: 'case' },
    { full: 'Each', short: 'each' },
    { full: 'Fluid Ounce', short: 'fl oz' },
    { full: 'Gallon', short: 'gal' },
    { full: 'Gram', short: 'g' },
    { full: 'Kilogram', short: 'kg' },
    { full: 'Litre', short: 'L' },
    { full: 'Millilitre', short: 'ml' },
    { full: 'Ounce', short: 'oz' },
    { full: 'Pack', short: 'pk' },
    { full: 'Piece', short: 'pc' },
    { full: 'Pint', short: 'pt' },
    { full: 'Pound', short: 'lb' }
  ]);
  restockHistory = hydrateEnterpriseRecords('inventoryHistory', localData[8] || []);
  appAdminSettings = {
    ...defaultAppAdminSettings,
    ...(localData[9] || {})
  };
  auditTrail = Array.isArray(localData[10]) ? localData[10] : [];

  settings = normalizeSettings(settings, defaultSettings);
  applyTheme();

  if (options.refresh !== false) {
    populateCurrencies();
    transactions = deduplicateTransactions(transactions);
    saveState('transactions', transactions, { enqueueSync: false }).catch(() => {});
    updateDashboard();
    renderDishesTable();
    renderMenu();
    renderTransactions();
    renderCategoryList();
    renderInventoryReport();
    renderStockListTable();
    renderCustomerList();
    renderStaffList();
    renderUnitList();
    renderRestockHistoryTable();
    populateCategoryDropdown();
    populateCategoryFilter();
    populateReportFilters();
    populateUnitDropdown();
    loadSettings();
    refreshCurrentView();
  }

  return localData;
}
// ===== Main App Initialization =====
function resetDashboardCartState() {
  activeOrders = resetActiveOrdersCart(activeOrders, CART_ID);
  if (activeOrders[CART_ID]) {
    delete activeOrders[CART_ID];
  }

  if (typeof updateOrders === 'function') {
    updateOrders(CART_ID, false);
  }

  if (typeof refreshCurrentView === 'function') {
    refreshCurrentView();
  }
}

async function mainInit() {
  try {
    // Check if we are opening in Mobile Scanner Client Mode
    if (checkMobileScannerMode()) {
      return; // Stop normal app initialization
    }

    // Determine which local DB to open based on session
    const lastUid = sessionStorage.getItem('currentUserUid') || localStorage.getItem('lastUserUid') || 'guest';
    await initDB(lastUid);

    // Request persistent storage to prevent browser from clearing data
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.log(`Persisted storage granted: ${isPersisted}`);
    }

    resetDashboardCartState();

    // Load data from local IndexedDB
    const localData = await Promise.all([
      loadState('menu'),
      loadState('activeOrders'),
      loadState('transactions'),
      loadState('settings'),
      loadState('staff'),
      loadState('dishCategories'),
      loadState('customers'),
      loadState('units'),
      loadState('restockHistory'),
      loadState('appAdminSettings'),
      loadState('auditTrail')
    ]);

    // Initialize Connectivity Status Indicator
    updateOnlineStatus().catch(console.warn);
    window.addEventListener('online', () => updateOnlineStatus().catch(console.warn));
    window.addEventListener('offline', () => updateOnlineStatus().catch(console.warn));

    // Assign local settings immediately so login overlay can use them for branding
    settings = normalizeSettings(localData[3], defaultSettings);
    resetDashboardCartState();

    // Populate state from local storage immediately
    menu = hydrateEnterpriseRecords('products', localData[0] || defaultMenu);
    activeOrders = localData[1] || {};
    transactions = deduplicateTransactions(hydrateEnterpriseRecords('sales', localData[2] || []));
    staff = hydrateEnterpriseRecords('staff', localData[4] || defaultStaff);
    dishCategories = localData[5] || defaultDishCategories;
    customers = hydrateEnterpriseRecords('customers', localData[6] || []);
    units = hydrateEnterpriseRecords('units', localData[7] || [
      { full: 'Bottle', short: 'btl' },
      { full: 'Box', short: 'box' },
      { full: 'Can', short: 'can' },
      { full: 'Case', short: 'case' },
      { full: 'Each', short: 'each' },
      { full: 'Fluid Ounce', short: 'fl oz' },
      { full: 'Gallon', short: 'gal' },
      { full: 'Gram', short: 'g' },
      { full: 'Kilogram', short: 'kg' },
      { full: 'Litre', short: 'L' },
      { full: 'Millilitre', short: 'ml' },
      { full: 'Ounce', short: 'oz' },
      { full: 'Pack', short: 'pk' },
      { full: 'Piece', short: 'pc' },
      { full: 'Pint', short: 'pt' },
      { full: 'Pound', short: 'lb' }
    ]);
    restockHistory = hydrateEnterpriseRecords('inventoryHistory', localData[8] || []);
    appAdminSettings = {
      ...defaultAppAdminSettings,
      ...(localData[9] || {})
    };
    auditTrail = Array.isArray(localData[10]) ? localData[10] : [];

    // START UI IMMEDIATELY
    settings = normalizeSettings(settings, defaultSettings);
    applyTheme();
    handleSplashScreen();
    populateCurrencies();

    // CRITICAL: Render dashboard FIRST while other tabs are hidden
    // This ensures charts initialize on visible canvas elements
    updateDashboard();

    renderDishesTable();
    renderMenu();
    loadSettings();
    updateVersionDisplay();
    checkShopStatus();

    mirrorEnterpriseRecordsToLocalStores().catch(error => {
      console.warn('[MIGRATION] Enterprise record mirror skipped:', error);
    });

    if (typeof localRepository?.getMetadata === 'function') {
      localRepository.getMetadata('restoredBackupPendingCloudSync')
        .then(pendingRestore => {
          if (pendingRestore) {
            addNotification(
              "A restored backup is still local-only. Review it, then sync it to cloud when ready.",
              "info",
              "syncRestoredBackupToCloud()"
            );
          }
        })
        .catch(error => console.warn('[RESTORE] Pending restore check failed:', error));
    }

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        syncUserPresence(false).catch(() => {});
      } else if (auth.currentUser) {
        syncUserPresence(true).catch(() => {});
      }
    });

    window.addEventListener('beforeunload', () => {
      syncUserPresence(false).catch(() => {});
    });

    window.addEventListener('online', () => {
      syncUserPresence(true).catch(() => {});
    });

    window.addEventListener('offline', () => {
      syncUserPresence(false).catch(() => {});
    });

    // Background Cloud Sync
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;

      // Detect if the logged in person is the Super Admin BEFORE updating UI
      if (user && isRecognizedAppAdminUser(user)) {
        console.log("👑 App Admin detected (" + user.email + "). Granting master access.");
        currentUserRole = 'appAdmin';
        isPinVerified = true;
        sessionStorage.setItem('currentUserRole', 'appAdmin');
        sessionStorage.setItem('isPinVerified', 'true');
        localStorage.setItem('currentUserRole', 'appAdmin');
        localStorage.setItem('isPinVerified', 'true');
        // Small delay to ensure Firestore rules pick up the auth token identity
        setTimeout(() => {
          const adminTabBtn = document.getElementById('nav-app-admin-btn');
          if (adminTabBtn) showTab('appAdminTab', adminTabBtn);
        }, 500);
      } else if (user) {
        currentUserRole = null;
        isPinVerified = false;
        sessionStorage.removeItem('currentUserRole');
        sessionStorage.removeItem('isPinVerified');
        localStorage.removeItem('currentUserRole');
        localStorage.removeItem('isPinVerified');
      }

      if (user) console.log("Your Firebase UID is:", user.uid);
      updateAuthUI(user);

      if (user) {
        console.log("Logged in, syncing cloud data in background...");
        syncUserPresence(true).catch(() => {});

        // Initialize root user document with PENDING status for new users
        try {
          const userRef = doc(dbFirestore, "users", user.uid);
          const userSnap = await getDoc(userRef);

          const data = userSnap.exists() ? userSnap.data() : {};
          const status = String(data.status || 'active').trim().toLowerCase();

          // Save metadata locally for permission checks
          userMetadata = { ...data, status, uid: user.uid };
          renderSubscriptionFooterInfo();
          renderFooterClock();

          await setDoc(doc(dbFirestore, "users", user.uid), {
            email: user.email,
            lastLogin: new Date().toISOString(),
            status: status
          }, { merge: true });
        } catch (e) {
          handleFirebaseError(e, "User Metadata Sync", `users/${user.uid}`);
        }

        // Persist current UID in session for cross-tab checks
        if (sessionStorage.getItem('currentUserUid') !== user.uid) {
          isInitialLoadComplete = false;
          menu = [];
          activeOrders = {};
          transactions = [];
          staff = [];
          dishCategories = [];
          customers = [];
          units = [];
          restockHistory = [];
          settings = { ...defaultSettings };
          auditTrail = [];
        }

        sessionStorage.setItem('currentUserUid', user.uid);
        localStorage.setItem('lastUserUid', user.uid);

        activeOrders = {};
        await loadLocalBusinessDataForUid(user.uid, { refresh: true });
        resetDashboardCartState();

        // Run tenant initialization for normal users to ensure private data exists
        try {
          const isRestrictedIdentity = isAppAdminRestrictedIdentity({
            email: user.email,
            uid: user.uid,
            configuredAdminEmails: getConfiguredAppAdminEmails(),
            masterAdminUid: MASTER_APP_ADMIN_UID
          });

          if (!isRestrictedIdentity) {
            await setupTenantShopParameters(user.uid);
          } else {
            // Admins may still need real-time sync for monitoring
            await setupRealTimeSync(user.uid);
            await scheduleBackgroundSync();
          }

          // IMPORTANT: Ensure transactions are loaded from cloud
          // This is a fallback in case the real-time listener hasn't triggered yet
          // Especially important for Codespace where network/timing may be different
          setTimeout(async () => {
            try {
              if (Array.isArray(transactions) && transactions.length === 0 && dbFirestore) {
                console.log("[LOGIN_INIT] Fallback: Transactions still empty after sync init, forcing reload from cloud");
                await loadTransactionsFromCloud(user.uid);
              }
            } catch (fallbackError) {
              console.warn("[LOGIN_INIT] Fallback transaction load failed:", fallbackError);
            }
          }, 2000); // 2 second delay to allow real-time listener to populate first

        } catch (e) {
          console.warn('Error during tenant initialization:', e);
        }

        try {
          if (window.checkForAdminNoticeForCurrentShop) {
            await window.checkForAdminNoticeForCurrentShop();
          } else {
            console.warn('Admin notice check function is not available');
          }
        } catch (noticeError) {
          console.warn('Admin notice check failed on startup:', noticeError);
        }
      } else {
        syncUserPresence(false).catch(() => {});

        // User signed out: fully flush session-local state to prevent cross-contamination
        try {
          // Clear session and local storage items used for identity and caches
          sessionStorage.removeItem('currentUserUid');
          sessionStorage.removeItem('currentUserRole');
          sessionStorage.removeItem('currentUserPermissions');
          sessionStorage.removeItem('isPinVerified');
          sessionStorage.removeItem('currentLoggedInStaffName');

          currentUser = null;
          userMetadata = null;
          currentUserRole = null;
          currentUserPermissions = [];
          isPinVerified = false;
          currentLoggedInStaffName = '';
          menu = [];
          activeOrders = {};
          transactions = [];
          staff = [];
          dishCategories = [];
          customers = [];
          restockHistory = [];
          settings = { ...defaultSettings };

          // Close IndexedDB connection without deleting local business data
          try {
            if (db) {
              db.close();
              db = null;
            }
            if (localRepository) {
              await localRepository.close();
              localRepository = null;
            }
            repositoryService = null;
            localRepositoryReady = false;
          } catch (e) {
            console.warn('IndexedDB cleanup failed:', e);
          }

          // Reset flags
          isInitialLoadComplete = false;
          isMonitoringMode = false;
        } catch (e) {
          console.warn('Error flushing session state on logout:', e);
        }
      }
    });

    renderCategoryList();
    renderInventoryReport();
    renderCustomerList();
    renderStaffList();
    toggleAddCustomerForm(false);
    renderUnitList();
    populateReportFilters();
    populateUnitDropdown();
    populateCategoryFilter();
    setupSettingsAccordion();
    updatePrinterStatus(false);

    // Wire up Product Form Automation (Price auto-fill and Barcode generation)
    const dishNameEl = document.getElementById('dishName');
    const dishCatEl = document.getElementById('dishCategory');
    if (dishNameEl) {
      dishNameEl.addEventListener('input', () => {
        // Auto-fill price and category from stock if creating a new entry
        if (document.getElementById('dishIndex').value === '') {
          const name = dishNameEl.value.trim();
          const stockMatch = menu.find(i => i.name.toLowerCase() === name.toLowerCase() && i.stock !== undefined);
          if (stockMatch) {
            if (stockMatch.category) dishCatEl.value = stockMatch.category;
            document.getElementById('dishSellingPrice').value = stockMatch.price || 0;
            updateRecipeTotals();
          }
        }
        generateAutoBarcode();
      });
    }
    if (dishCatEl) dishCatEl.addEventListener('change', generateAutoBarcode);

    // Save on visibility change (mobile app backgrounding/closing)
    // SAFETY: Only force-sync if initial load is complete to avoid overwriting
    // cloud data with an empty in-memory state during app startup
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (isInitialLoadComplete && !isLoggingOut && currentUser) {
          console.log('[SYNC] 📵 App backgrounding - saving data');
          saveData();
        } else {
          console.log('[SYNC] 📵 App backgrounding - skipping sync (initial load not complete yet)');
        }
      }
    });

    // Sync on online status change
    window.addEventListener('online', () => {
      const deviceId = new URLSearchParams(window.location.search).get('device') || '';
      console.log(`[SYNC] 🌐 Device ${deviceId || 'default'} back online - syncing all data`);
      if (currentUser && isInitialLoadComplete) {
        if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
        lastSyncTime = 0; // Reset to allow immediate sync
        saveData();
        flushLocalSyncQueue().catch((error) => console.warn('[SYNC] Queue flush failed:', error));
      }
    });

    // Listen for updates from other tabs/windows using storage events
    window.addEventListener('storage', (event) => {
      if (event.key && event.key.startsWith('posDB')) {
        const deviceId = new URLSearchParams(window.location.search).get('device') || '';
        // Only refresh if the change belongs to the same simulated device ID
        if (!deviceId || event.key.includes(`_${deviceId}`)) {
          console.log(`[SYNC] 📱 Data changed for device ${deviceId || 'default'} - refreshing`);
          setTimeout(() => {
            refreshCurrentView();
            updateDashboard();
          }, 100);
        }
      }
    });

  } catch (error) {
    console.error("Failed to initialize the application:", error);
    document.body.innerHTML = `
        <div style="padding: 40px; text-align: center; background: var(--primary); color: white; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <h1 style="font-size: 4em; margin-bottom: 20px;">⚠️</h1>
          <h2>App Initialization Failed</h2>
          <p style="max-width: 400px; margin-bottom: 30px;">This usually happens in strict Private Browsing modes or if the local database is corrupted.</p>
          <button onclick="location.reload()" class="btn" style="background: white; color: var(--primary); padding: 12px 30px;">Try Refreshing</button>
          <p style="margin-top: 20px; font-size: 0.8em; opacity: 0.8; cursor: pointer; text-decoration: underline;" onclick="resetLocalDatabase()">Reset Local Database</p>
        </div>
      `;
  }
}

function showLoginOverlay(mode = 'login') {
  let overlay = document.getElementById('login-overlay');
  const logoUrl = sanitizeLogoUrl(settings?.logo);
  const displayLogo = logoUrl || 'assets/icons/icon.png';
  const logoHtml = `<img src="${displayLogo}" crossorigin="anonymous" onerror="this.removeAttribute('crossorigin'); this.src='assets/icons/icon.png';" style="width: 100px; height: 100px; object-fit: contain; margin-top: -40px; margin-bottom: 12px;">`;

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, var(--primary) 0%, #d35400 100%), repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 15px); z-index: 10000; display: flex; color: white; transition: opacity 0.5s;';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';

  if (!currentUser) {
    if (window._marketingInterval) clearInterval(window._marketingInterval);
    const statusOverlay = document.getElementById('shop-status-overlay');
    if (statusOverlay) {
      statusOverlay.style.display = 'none';
    }

    const deviceId = new URLSearchParams(window.location.search).get('device');
    const deviceLabel = deviceId ? `<div style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.5); padding: 4px 10px; border-radius: 4px; font-size: 0.7em;">Device: ${deviceId}</div>` : '';

    // Stage 1: Email Auth / Google Login
    const isRegister = mode === 'register';
    const title = isRegister ? 'Create Account' : 'Account Login Required';
    const submitText = isRegister ? 'Register' : 'Login';
    const submitFn = isRegister ? 'registerWithEmail()' : 'loginWithEmail()';
    const toggleText = isRegister ? 'Already have an account? Login' : "Don't have an account? Register";
    const toggleMode = isRegister ? 'login' : 'register';
    const googleBtnText = isRegister ? 'Register with Google' : 'Login with Google';

    overlay.style.flexDirection = 'row';
    overlay.style.alignItems = 'stretch';
    overlay.style.justifyContent = 'center';

    overlay.innerHTML = `
        ${deviceLabel}
        <div class="marketing-side animate-panel-left" style="flex: 1.2; background: rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; padding: 0; border-right: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px); overflow: hidden;">
          <img src="assets/icons/market.png" crossorigin="anonymous" style="width: 100%; height: 100%; object-fit: cover;">
        </div>
        <div class="login-side animate-panel-right" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px;">
          <div style="margin-bottom: 20px; opacity: 0.8; transform: scale(0.8);">${logoHtml}</div>
          <p style="font-size: 1.5em; margin-bottom: 25px; font-weight: bold;">${title}</p>
          
          <div id="email-login-form" style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 320px; margin-bottom: 15px;">
            ${isRegister ? `<input type="text" id="authName" placeholder="Full Name" style="padding: 12px; border-radius: 8px; border: none; color: var(--text); background: white;">` : ''}
            ${isRegister ? `<input type="tel" id="authWhatsApp" placeholder="WhatsApp Number (e.g. +256...)" style="padding: 12px; border-radius: 8px; border: none; color: var(--text); background: white;">` : ''}
            <input type="email" id="authEmail" placeholder="Email Address" style="padding: 12px; border-radius: 8px; border: none; color: var(--text); background: white;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="password" id="authPassword" placeholder="Password" style="flex: 1; padding: 12px; border-radius: 8px; border: none; color: var(--text); background: white;">
              <button type="button" onclick="togglePINVisibility('authPassword')" class="btn" style="padding: 12px; margin: 0; background: transparent; border: 1px solid #ddd; border-radius: 8px; cursor: pointer; font-size: 1em;" title="Show/Hide Password">👁️</button>
            </div>
            ${isRegister ? `<div style="display: flex; gap: 8px; align-items: center;"><input type="password" id="authConfirmPassword" placeholder="Confirm Password" style="flex: 1; padding: 12px; border-radius: 8px; border: none; color: var(--text); background: white;"><button type="button" onclick="togglePINVisibility('authPassword')" class="btn" style="padding: 12px; margin: 0; background: transparent; border: 1px solid #ddd; border-radius: 8px; cursor: pointer; font-size: 1em;" title="Show/Hide Password">👁️</button></div>` : ''}
            <button onclick="${submitFn}" class="btn" style="background: #28a745; color: white; margin: 0; font-weight: bold; padding: 12px; border-radius: 8px; border: none; width: 100%;">${submitText}</button>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
              <a href="#" onclick="showLoginOverlay('${toggleMode}')" style="color: white; font-size: 0.8em; text-decoration: underline; opacity: 0.8;">${toggleText}</a>
              ${!isRegister ? `<a href="#" onclick="handleForgotPassword()" style="color: white; font-size: 0.8em; text-decoration: underline; opacity: 0.8;">Forgot Password?</a>` : ''}
            </div>
          </div>

          <div style="width: 100%; max-width: 320px; text-align: center; margin: 10px 0; position: relative;">
            <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.3);">
            <span style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: var(--primary); padding: 0 10px; font-size: 0.8em; opacity: 0.7;">OR</span>
          </div>

          <button onclick="login()" class="btn" style="background: white; color: var(--primary); padding: 12px 30px; font-size: 1.1em; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 15px; border-radius: 4px; border: none; box-shadow: 0 2px 4px rgba(0,0,0,0.2); width: 100%; max-width: 320px; margin: 0;">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 24px; height: 24px;">
            ${googleBtnText}
          </button>
          
          <div style="margin-top: 40px; font-size: 0.65em; opacity: 0.7; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
            <div style="display: flex; gap: 20px; font-size: 1.2em; margin-bottom: 2px;">
              <a href="#" style="color: white; text-decoration: none;">Privacy Policy</a>
              <a href="#" style="color: white; text-decoration: none;">Terms of Service</a>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; line-height: 1.4; text-align: center;">
              <span>📍 Uganda, Mbale Republic street</span>
              <span>📞 watsap/call +971562889428</span>
              <span>📧 sadikkirya@gmail.com</span>
            </div>
            <div style="margin-top: 5px; opacity: 0.8;">&copy; ${new Date().getFullYear()} ${settings?.name || 'YoShop'}. All rights reserved.</div>
          </div>
        </div>
      `;
    // Attach Enter key handlers for login forms (submit on Enter)
    (function attachLoginEnterHandler() {
      const onKey = (e) => {
        if (e.key !== 'Enter') return;
        const pinInput = document.getElementById('loginPIN');
        if (pinInput && document.activeElement && document.activeElement.id === 'loginPIN') {
          const pinBtn = overlay.querySelector('button[onclick*="loginWithPIN"]');
          if (pinBtn) pinBtn.click();
          return;
        }
        const emailInput = document.getElementById('authEmail');
        const pwdInput = document.getElementById('authPassword');
        if ((emailInput && document.activeElement === emailInput) || (pwdInput && document.activeElement === pwdInput)) {
          const submitBtn = overlay.querySelector('button[onclick*="loginWithEmail"] , button[onclick*="registerWithEmail"]');
          if (submitBtn) submitBtn.click();
        }
      };
      overlay.addEventListener('keydown', onKey);
    })();
  } else {
    if (window._marketingInterval) clearInterval(window._marketingInterval);

    const deviceId = new URLSearchParams(window.location.search).get('device');
    const deviceLabel = deviceId ? `<div style="position: absolute; top: 10px; left: 10px; background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 4px; font-size: 0.7em;">Simulated Device: ${deviceId}</div>` : '';

    // Stage 2: PIN Access
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const subInfo = getSubscriptionInfo();
    const promoEmoji = (subInfo.label === "PROMO PLAN") ? ' 🎉' : '';
    const promoMsgHtml = '';

    const statusDisplay = `
        <div style="background: rgba(255,255,255,0.1); padding: 8px 15px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid ${subInfo.color}; text-align: left; width: 100%; max-width: 300px;">
          <span style="font-size: 0.7em; opacity: 0.8; text-transform: uppercase;">Shop Status:</span>
          <strong style="color: ${subInfo.color}; font-size: 0.9em; margin-left: 5px;">${subInfo.label}${promoEmoji}</strong>
          ${promoMsgHtml}
          ${subInfo.subExpires ? `<div style="font-size: 0.7em; opacity: 0.7;">Valid until: ${subInfo.subExpires.toLocaleDateString()}</div>` : ''}
        </div>`;

    const loginSubStage = sessionStorage.getItem('loginSubStage') || 'choice';
    let pinStageHtml = '';

    if (loginSubStage === 'choice') {
      pinStageHtml = `
          <div style="width: 100%; max-width: 300px; display: flex; flex-direction: column; align-items: center;">
            <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
              <button onclick="prepareLogin('admin')" class="btn" style="background: rgba(255,255,255,0.15); border: 1px solid white; color: white; padding: 15px; font-weight: bold; width: 100%; border-radius: 8px; margin: 0; display: flex; align-items: center; justify-content: center; gap: 10px;">🛡️ Login as Admin</button>
              <button onclick="prepareLogin('staff')" class="btn" style="background: rgba(255,255,255,0.15); border: 1px solid white; color: white; padding: 15px; font-weight: bold; width: 100%; border-radius: 8px; margin: 0; display: flex; align-items: center; justify-content: center; gap: 10px;">👥 Login as Staff</button>
              <button onclick="logout()" class="btn" style="background: transparent; color: white; border: 1px solid white; padding: 12px; font-weight: bold; width: 100%; border-radius: 8px; margin: 10px 0 0 0; display: flex; align-items: center; justify-content: center; gap: 10px;">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 16px; height: 16px;">
                Logout Google Account
              </button>
            </div>
          </div>
        `;
    } else {
      const isAdmin = loginSubStage === 'admin';
      pinStageHtml = `
          <div id="pin-entry-stage" style="display: flex; width: 100%; flex-direction: column; align-items: center; max-width: 320px;">
            <p id="pin-instruction" style="margin-bottom: 12px; opacity: 0.9; text-align: center; font-weight: bold; width: 100%; font-size: 1.1em;">
              ${isAdmin ? '🛡️ Admin Login' : '👥 Staff Login'}
            </p>
            
            <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; margin-bottom: 12px;">
              <div id="staff-name-container" style="width: 100%;">
                <input type="text" id="loginStaffName" ${isAdmin ? 'readonly' : 'list="staffNamesList"'} value="${isAdmin ? 'Admin' : ''}" placeholder="Select Name" style="padding: 10px; border-radius: 8px; border: none; width: 100%; color: var(--text); background: white; font-size: 1.1em; height: 45px; box-sizing: border-box; ${isAdmin ? 'opacity: 0.8; cursor: default;' : ''}">
                <datalist id="staffNamesList">
                  ${isAdmin ? '' : (staff || []).filter(s => s.isActive !== false).map(s => `<option value="${s.name}">`).join('')}
                </datalist>
              </div>
              
              <div style="width: 100%; position: relative; height: 45px;">
                <input type="password" id="loginPIN" placeholder="PIN" maxlength="4" style="width: 100%; height: 100%; padding: 10px; border-radius: 8px; border: none; text-align: center; font-size: 1.5em; letter-spacing: 8px; color: var(--text); background: white; box-sizing: border-box;">
                <button type="button" onclick="togglePINVisibility('loginPIN')" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 1.2em; cursor: pointer; color: #888;">👁️</button>
              </div>
            </div>

            <div id="pin-actions-container" style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
              <button onclick="loginWithPIN()" class="btn" style="background: #28a745; color: white; padding: 10px; font-weight: bold; width: 100%; margin: 0; border-radius: 8px; font-size: 1em;">Unlock System</button>
              <button onclick="resetLoginStage()" class="btn" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; font-weight: bold; width: 100%; border-radius: 8px; margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px;">🔙 Switch Account Type</button>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; width: 100%; gap: 10px;">
                  <a href="#" onclick="forgotPIN()" style="color: white; font-size: 0.85em; text-decoration: underline; opacity: 0.8;">Forgot PIN?</a>
                  <button onclick="logout()" class="btn" style="background: transparent; color: white; border: 1px solid white; padding: 5px 12px; font-size: 0.8em; margin: 0; cursor: pointer; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 14px; height: 14px;">
                    Logout Google Account
                  </button>
              </div>
            </div>
          </div>
        `;
    }

    overlay.innerHTML = `
        ${deviceLabel}
        ${logoHtml}
        <h1 style="font-size: 3em; margin-top: 0px; margin-bottom: 0px;">${settings?.name || 'YoShop'}</h1>
        <p style="font-size: 1.2em; margin-top: 0px; margin-bottom: 12px;">Welcome, ${currentUser.displayName || currentUser.email.split('@')[0]}</p>
        
        ${statusDisplay}

        ${pinStageHtml}

        <div style="position: absolute; bottom: 20px; font-size: 0.65em; opacity: 0.7; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
          <div style="display: flex; gap: 20px; font-size: 1.2em; margin-bottom: 2px;">
            <a href="#" style="color: white; text-decoration: none;">Privacy Policy</a>
            <a href="#" style="color: white; text-decoration: none;">Terms of Service</a>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; line-height: 1.4; text-align: center;">
            <span>📍 Uganda, Mbale Republic street</span>
            <span>📞 watsap/call +256754350502</span>
            <span>📧 sadikkirya@gmail.com</span>
          </div>
          <div style="margin-top: 5px; opacity: 0.8;">&copy; ${new Date().getFullYear()} ${settings?.name || 'YoShop'}. All rights reserved.</div>
        </div>
      `;
  }

  // Auto-focus PIN field if on entry screen
  const pinInput = document.getElementById('loginPIN');
  if (pinInput) pinInput.focus();

  overlay.style.display = 'flex';
}

function applyRolePermissions() {
  const isShopAdmin = isShopAdminRole();
  const isAppAdmin = isAppAdminRole();
  const hasFullAccess = isShopAdmin || isAppAdmin;
  const normalizedPermissions = getEffectivePermissions(currentUserRole, currentUserPermissions);
  const nav = document.querySelector('nav');
  if (!nav) return;

  const activeTab = document.querySelector('section.active');
  const isInAdminTab = activeTab && activeTab.id === 'appAdminTab';

  nav.querySelectorAll('button').forEach(btn => {
    // Strictly hide App Admin specific buttons for non-AppAdmins
    const isAdminSpecific = btn.id === 'nav-app-admin-btn' || btn.id === 'nav-admin-shops' || btn.id === 'nav-admin-subscriptions' || btn.id === 'nav-admin-shops-list' || btn.id === 'nav-admin-settings';
    if (!isAppAdmin && isAdminSpecific) {
      btn.style.display = 'none';
      return;
    }

    const directButtonPermissions = {
      'nav-lock-btn': 'lockPin',
      'nav-logout-btn': 'logoutAccount'
    };

    const directPermission = directButtonPermissions[btn.id];
    if (directPermission) {
      btn.style.display = (hasFullAccess || normalizedPermissions.includes(directPermission)) ? 'flex' : 'none';
      return;
    }

    const onclick = btn.getAttribute('onclick') || '';
    const tabIdMatch = onclick ? onclick.match(/showTab\('([^']+)'/) : null;
    if (tabIdMatch) {
      const tabId = tabIdMatch[1];
      if (isAppAdmin) {
        // Hide shop navigation while looking at the Admin Management panel 
        // or if no monitoring session is active.
        const isAdminBtn = tabId === 'appAdminTab' || ['nav-admin-shops', 'nav-admin-shops-list', 'nav-admin-settings'].includes(btn.id);
        if (isInAdminTab || !isMonitoringMode) {
          btn.style.display = isAdminBtn ? 'flex' : 'none';
        } else {
          btn.style.display = 'flex';
        }
      } else if (isShopAdmin) {
        btn.style.display = tabId === 'appAdminTab' ? 'none' : 'flex';
      } else {
        btn.style.display = normalizedPermissions.includes(tabId) ? 'flex' : 'none';
      }
    }
  });

  // Hide ShopAdmin-specific settings groups
  const securityGroup = document.getElementById('securitySettingsGroup');
  if (securityGroup) securityGroup.style.display = isShopAdmin ? 'block' : 'none';

  const appAdminBtn = document.getElementById('nav-app-admin-btn');
  if (appAdminBtn) appAdminBtn.style.display = isAppAdmin ? 'flex' : 'none';

  // Tab restriction and redirection logic
  if (isAppAdmin && !isMonitoringMode && activeTab && activeTab.id !== 'appAdminTab') {
    // Force App Admin back to management screen if they attempt to view a shop tab without monitoring
    const adminBtn = document.getElementById('nav-app-admin-btn');
    if (adminBtn) showTab('appAdminTab', adminBtn);
  } else if (!isShopAdmin && !isAppAdmin && activeTab && !normalizedPermissions.includes(activeTab.id)) {
    const targetTab = getFirstAllowedTab(currentUserRole, normalizedPermissions, 'menuTab');
    if (targetTab) {
      const targetBtn = nav.querySelector(`button[onclick*="${targetTab}"]`);
      if (targetBtn) showTab(targetTab, targetBtn);
    }
  }
  checkShopStatus();
}

async function loginWithPIN() {
  const loginSubStage = sessionStorage.getItem('loginSubStage');
  const staffNameInput = document.getElementById('loginStaffName');
  const staffName = staffNameInput ? staffNameInput.value.trim() : '';
  const pinInput = document.getElementById('loginPIN');
  const enteredPin = pinInput?.value || '';

  if (loginSubStage === 'admin') {
    const shopAdminPin = settings.ShopAdminPIN || settings.managerPIN || settings.ShopAdmin;
    const isOwner = shopAdminPin && enteredPin === shopAdminPin;

    if (isOwner) {
      completePinLogin('shopAdmin', [], 'ShopAdmin');
    } else {
      await showAppAlert("Incorrect Admin PIN.", "Login Failed");
      if (pinInput) pinInput.value = '';
      if (typeof prepareLogin === 'function') prepareLogin('admin');
    }
    return;
  }

  if (!staffName || staffName.toLowerCase() === 'admin') {
    await showAppAlert("Identification Required: Please select your name.", "Login Failed");
    if (staffNameInput && staffNameInput.offsetParent !== null) {
      staffNameInput.focus();
      staffNameInput.style.boxShadow = '0 0 0 3px rgba(220, 53, 69, 0.5)';
    }
    return;
  }

  if (staffNameInput) staffNameInput.style.boxShadow = 'none';

  // 2. Check Staff Array
  const staffMember = staff.find(s => s.name.toLowerCase() === staffName.toLowerCase() && s.pin === enteredPin);

  if (staffMember) {
    if (staffMember.isActive === false) {
      await showAppAlert("This account is currently inactive. Please contact the admin.", "Account Inactive");
      return;
    }

    appendAuditEvent('staff_login', { staffName: staffMember.name, role: (staffMember.role || 'staff').toLowerCase() });
    persistAuditTrail().catch(() => { });

    // Determine Role (grant ShopAdmin role based on role field or if it's admin)
    const definedRole = getNormalizedRole(staffMember.role || 'staff');
    const loginRole = definedRole === 'shopAdmin' ? 'shopAdmin' : 'staff';

    completePinLogin(
      loginRole,
      loginRole === 'shopAdmin' ? [] : (staffMember.permissions || ['menuTab']),
      staffMember.name
    );
    console.log(`Unlocked as ${loginRole === 'shopAdmin' ? 'ShopAdmin' : 'Staff'}: ${staffMember.name}`);
    await showAppAlert("Incorrect Name or PIN. Please try again.", "Login Failed");
    if (document.getElementById('loginPIN')) document.getElementById('loginPIN').value = '';
    if (typeof prepareLogin === 'function') prepareLogin('staff');
  }
}
// Ensure early global availability for inline handlers
try { window.loginWithPIN = loginWithPIN; } catch (e) { /* ignore */ }

/**
 * Helper to set session storage and update UI after successful PIN verification
 */
function completePinLogin(role, permissions, staffName) {
  isPinVerified = true;
  currentUserRole = role;

  if (role === 'shopAdmin' || role === 'appAdmin') {
    currentUserPermissions = [];
  } else {
    currentUserPermissions = normalizePermissions(permissions);
  }

  currentLoggedInStaffName = staffName;
  savePinSession(role, currentUserPermissions, staffName);

  appendAuditEvent('pin_login', { role, staffName });
  persistAuditTrail().catch(() => { });

  setAppShellLocked(false);
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'none';

  const lockBtn = document.getElementById('nav-lock-btn');
  if (lockBtn) lockBtn.style.display = 'inline-block';

  updateAuthUI(currentUser);
  applyRolePermissions();
  checkShopStatus();
}

// Placeholder functions for backward compatibility or future use
function selectLoginRole(role) { console.log('selectLoginRole is deprecated'); }

function prepareLogin(role) {
  sessionStorage.setItem('loginSubStage', role);
  showLoginOverlay();
}

function resetLoginStage() {
  sessionStorage.removeItem('loginSubStage');
  showLoginOverlay();
}

async function forgotPIN() {
  if (!currentUser) return showAppAlert("Please sign in with Google first.", 'Login Required');

  const staffName = document.getElementById('loginStaffName')?.value.trim();

  if (staffName && staffName.toLowerCase() !== 'shopadmin') {
    return showAppAlert("Staff members should contact the ShopAdmin to reset their PIN.", 'PIN Reset');
  }

  const confirmed = await showAppConfirm(`Send a PIN reset code to ${currentUser.email}?`, 'Reset PIN', 'Send', 'Cancel');
  if (confirmed?.confirmed) {
    await showAppAlert(`A reset request has been simulated. In a production environment, an email would be sent to ${currentUser.email} with instructions.`, 'PIN Reset Sent');
  }
}

function checkShopStatus() {
  const isAppAdmin = isAppAdminRole();
  const shopStatus = appAdminSettings.shopStatus || 'active';
  const userStatus = userMetadata?.status || 'active';
  const subExpires = userMetadata?.subscriptionExpires ? new Date(userMetadata.subscriptionExpires) : null;
  const isExpired = subExpires && subExpires < new Date();

  const overlayId = 'shop-status-overlay';
  let overlay = document.getElementById(overlayId);

  // Priority block: 1. Pending Approval, 2. Subscription Expired, 3. Shop Status
  const isBlocked = (userStatus === 'pending' || isExpired || shopStatus !== 'active') && !isAppAdmin && isPinVerified;

  if (isBlocked) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:20000; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; text-align:center; padding:20px;';
      document.body.appendChild(overlay);
    }

    let title = "SHOP RESTRICTED";
    let message = "Access to this shop has been restricted by the App Administrator.";

    if (userStatus === 'pending') {
      title = "APPROVAL PENDING";
      message = "Your account is awaiting approval from the system administrator. Please contact support to activate your shop.";
    } else if (isExpired) {
      title = "SUBSCRIPTION EXPIRED";
      message = `Your subscription expired on ${subExpires.toLocaleDateString()}. Please renew your subscription to continue using YoShop.`;
    } else if (shopStatus !== 'active') {
      title = `SHOP ${shopStatus.toUpperCase()}`;
    }

    overlay.innerHTML = `
        <h1 style="color:#ff6b35; font-size:2.5em; margin-bottom:10px;">⚠️ ${title}</h1>
        <p style="font-size:1.1em; max-width:500px; line-height:1.5;">${message}</p>
        <button onclick="lockApp()" class="btn" style="margin-top:20px; padding:12px 30px;">Return to Login</button>
      `;
    overlay.style.display = 'flex';
  } else if (overlay) {
    overlay.style.display = 'none';
  }
}

function toggleAdminAccessForm(show = true) {
  const form = document.getElementById('appAdminFormContainer');
  if (!form) return;
  form.style.display = show ? 'block' : 'none';
  if (!show) {
    editingAdminEmail = null;
    document.getElementById('appAdminEmailInput').value = '';
    document.getElementById('appAdminPasswordInput').value = '';
  } else {
    const emailInput = document.getElementById('appAdminEmailInput');
    if (emailInput && !emailInput.value) {
      emailInput.value = normalizeEmailAddress(currentUser?.email || '');
    }
  }
}

function renderAppAdminEmailAccessList() {
  const container = document.getElementById('appAdminAuthorizedEmailsList');
  if (!container) return;

  const entries = getConfiguredAdminEntries();
  const currentEmail = normalizeEmailAddress(currentUser?.email || '');
  const rows = [];

  entries.forEach((entry) => {
    const isCurrentGoogle = entry.email === currentEmail && entry.type === 'google';
    const displayName = entry.name || currentUser?.displayName || entry.email.split('@')[0] || 'App Admin';
    const passwordDisplay = entry.type === 'google' ? 'Google Sign-In' : '••••••';
    const statusLabel = entry.status === 'inactive' ? 'Inactive' : 'Active';
    const actionButtons = [];

    actionButtons.push(`<button class="btn btn-info u-m-0" onclick="editAdminAccessEntry('${entry.email}')">Edit</button>`);
    if (!isCurrentGoogle) {
      actionButtons.push(`<button class="btn btn-warning u-m-0" onclick="toggleAdminAccessStatus('${entry.email}')">${entry.status === 'inactive' ? 'Activate' : 'Deactivate'}</button>`);
      actionButtons.push(`<button class="btn btn-danger u-m-0" onclick="deleteAdminAccessEntry('${entry.email}')">Delete</button>`);
    }

    rows.push(`<tr style="border-bottom: 1px solid var(--border-color);"><td style="padding:6px 8px;">${displayName}</td><td style="padding:6px 8px;">${entry.email}</td><td style="padding:6px 8px;">${passwordDisplay}</td><td style="padding:6px 8px;">${entry.type === 'google' ? 'Google' : 'Email/Password'}</td><td style="padding:6px 8px;">${statusLabel}</td><td style="padding:6px 8px;">${actionButtons.join(' ')}</td></tr>`);
  });

  if (!rows.length) {
    container.innerHTML = '<tr><td colspan="6" style="padding:8px; color: var(--text-muted);">No admin access configured yet.</td></tr>';
    return;
  }

  container.innerHTML = rows.join('');
}

function updateAppAdminCredentials() {
  const email = normalizeEmailAddress(currentUser?.email || '');
  if (!email) return showAppAlert("Please sign in with your Google account first.", 'Google Sign-In Required');

  appAdminSettings = touchSettingsRecord({
    ...appAdminSettings,
    username: email
  }, 'appAdminSettings');

  saveData();
  if (typeof showAppAlert === 'function') showAppAlert("App Admin identity updated.", 'Identity Updated');
  else alert("App Admin identity updated.");
}

async function saveAdminAccessEntry() {
  const email = document.getElementById('appAdminEmailInput')?.value?.trim();
  const password = document.getElementById('appAdminPasswordInput')?.value?.trim();

  if (!email || !password) return showAppAlert("Please enter the linked email address and password.", 'Admin Access Required');

  if (!auth.currentUser) {
    return showAppAlert("Please sign in to the app admin account first, then add the email/password login.", 'Login Required');
  }

  try {
    const normalizedEmail = normalizeEmailAddress(email);
    if (normalizeEmailAddress(auth.currentUser.email || '') !== normalizedEmail) {
      return showAppAlert("This feature links the password to the currently signed-in admin account. Please use the same email address as the account you are currently signed in with.", 'Account Mismatch');
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return showAppAlert("Password must be at least 8 characters long, and include uppercase, lowercase, a number, and a special character.", 'Invalid Password');
    }

    const credential = EmailAuthProvider.credential(normalizedEmail, password);
    await linkWithCredential(auth.currentUser, credential);

    appAdminSettings = touchSettingsRecord({
      ...appAdminSettings,
      username: normalizedEmail
    }, 'appAdminSettings');

    const existingEntries = getConfiguredAdminEntries();
    const targetEmail = editingAdminEmail || normalizedEmail;
    const entryExists = existingEntries.some((entry) => entry.email === targetEmail);
    const nextEntries = entryExists
      ? existingEntries.map((entry) => entry.email === targetEmail ? { ...entry, email: normalizedEmail, type: 'password', status: 'active' } : entry)
      : [...existingEntries, { email: normalizedEmail, status: 'active', type: 'password' }];

    appAdminSettings = touchSettingsRecord({
      ...appAdminSettings,
      adminEmails: nextEntries
    }, 'appAdminSettings');

    saveData();
    renderAppAdminEmailAccessList();
    toggleAdminAccessForm(false);

    currentUserRole = 'appAdmin';
    isPinVerified = true;
    sessionStorage.setItem('currentUserRole', 'appAdmin');
    localStorage.setItem('currentUserRole', 'appAdmin');
    sessionStorage.setItem('isPinVerified', 'true');
    localStorage.setItem('isPinVerified', 'true');

    updateAuthUI(auth.currentUser);
    applyRolePermissions();
    checkShopStatus();

    await showAppAlert("Admin access saved successfully.", 'Admin Access Updated');
  } catch (error) {
    console.error('Failed to save admin access:', error);
    let message = error?.message || 'Unable to save admin access.';
    if (error?.code === 'auth/email-already-in-use') {
      message = 'That email address is already registered to another account. Use a different email or sign in to that account first.';
    } else if (error?.code === 'auth/weak-password') {
      message = 'The password is too weak. Use at least 8 characters with uppercase, lowercase, a number, and a symbol.';
    } else if (error?.code === 'auth/credential-already-in-use') {
      message = 'This credential is already linked to another account.';
    }
    await showAppAlert(message, 'Admin Access Failed');
  }
}

function editAdminAccessEntry(email) {
  const normalizedEmail = normalizeEmailAddress(email);
  editingAdminEmail = normalizedEmail;
  document.getElementById('appAdminEmailInput').value = normalizedEmail;
  document.getElementById('appAdminPasswordInput').value = '';
  toggleAdminAccessForm(true);
}

function deleteAdminAccessEntry(email) {
  const normalizedEmail = normalizeEmailAddress(email);
  const filteredEntries = getConfiguredAdminEntries().filter((entry) => entry.email !== normalizedEmail);
  appAdminSettings = touchSettingsRecord({
    ...appAdminSettings,
    adminEmails: filteredEntries
  }, 'appAdminSettings');
  saveData();
  renderAppAdminEmailAccessList();
}

async function toggleAdminAccessStatus(email) {
  const normalizedEmail = normalizeEmailAddress(email);
  const entries = getConfiguredAdminEntries();
  const target = entries.find((entry) => entry.email === normalizedEmail);

  if (!target) {
    await showAppAlert('Admin account not found.', 'Status');
    return;
  }

  const nextStatus = target.status === 'inactive' ? 'active' : 'inactive';
  const nextEntries = entries.map((entry) => entry.email === normalizedEmail ? { ...entry, status: nextStatus } : entry);
  appAdminSettings = touchSettingsRecord({
    ...appAdminSettings,
    adminEmails: nextEntries
  }, 'appAdminSettings');
  saveData();
  renderAppAdminEmailAccessList();
  await showAppAlert(`${normalizedEmail} is now ${nextStatus}.`, 'Status Updated');
}


async function updateShopStatus(status) {
  if (typeof showAppConfirm === 'function') {
    const resp = await showAppConfirm(`Switch shop to ${status.toUpperCase()}?`, 'Update Shop Status', 'Continue', 'Cancel');
    if (!resp || !resp.confirmed) return;
  }
  appAdminSettings = touchSettingsRecord({
    ...appAdminSettings,
    shopStatus: status
  }, 'appAdminSettings');

  saveData();
  const display = document.getElementById('currentShopStatusDisplay');
  if (display) display.textContent = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  checkShopStatus();
}

if (
  ['localhost', '127.0.0.1'].includes(location.hostname) &&
  'serviceWorker' in navigator
) {
  navigator.serviceWorker.getRegistrations()
    .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
    .then(() => caches?.keys?.())
    .then(cacheNames => cacheNames ? Promise.all(cacheNames.map(name => caches.delete(name))) : null)
    .catch(error => console.warn('[DEV] Local service worker cleanup skipped:', error));
}

mainInit();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' forces the browser to check the server for sw.js changes on every check
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(registration => {
        console.log('Service Worker registered with scope:', registration.scope);

        // Check if there's already a waiting worker (update ready but not activated)
        if (registration.waiting) {
          showUpdateNotification();
        }

        // Listen for new updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
              showUpdateNotification();
            }
          });
        });

        // Check for updates every 30 seconds for "instant" feel
        const updateInterval = setInterval(() => {
          registration.update().catch(err => {
            // Handle update errors gracefully (may occur when browser is offline or closing)
            if (err.name !== 'InvalidStateError') {
              console.warn('Service Worker update check failed:', err);
            }
          });
        }, 30 * 60 * 1000);

        // Immediately check for updates when the window is focused or tab becomes visible
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(err => {
              if (err.name !== 'InvalidStateError') {
                console.warn('Service Worker update check failed:', err);
              }
            });
          }
        });
      })
      .catch(err => {
        console.error('Service Worker registration failed:', err);
      });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      const overlay = document.getElementById('update-overlay');
      const progressBar = document.getElementById('update-progress-bar');
      if (overlay) overlay.style.display = 'flex';

      if (progressBar) {
        // Trigger the white bar to slide across
        setTimeout(() => { progressBar.style.width = '100%'; }, 50);
      }

      // Clear all caches but preserve IndexedDB (persistent data)
      (async () => {
        // 1. Clear in-memory query cache
        if (typeof requestCache !== 'undefined' && requestCache.clear) {
          requestCache.clear();
        }

        // 2. Clear browser CacheStorage (App Shell assets)
        if ('caches' in window) {
          const cacheNames = await caches.keys();
        }
        setTimeout(() => { window.location.reload(); }, 1000);
      })();
    }
  });
}

function isCheckoutActive() {
  const paymentModal = document.getElementById('paymentModal');
  const splitModal = document.getElementById('billSplitModal');
  const isPaymentOpen = paymentModal && paymentModal.style.display === 'flex';
  const isSplitOpen = splitModal && splitModal.style.display === 'flex';
  return isPaymentOpen || isSplitOpen;
}

function showUpdateNotification() {
  // Prevent duplicate notifications in the center
  if (appNotifications.some(n => n.message.includes('new version of YoShop'))) return;

  // Add to notification center
  addNotification('A new version of YoShop is available.', 'info', 'triggerAppUpdate(true)');

  // Make the badge pulse specifically for the update
  const badge = document.getElementById('update-badge');
  if (badge) badge.classList.add('pulse-badge');

  playNotificationSound();

  // Show settings button
  const settingsBtn = document.getElementById('settingsUpdateBtn');
  if (settingsBtn) settingsBtn.style.display = 'inline-block';

  // Show toast
  const toast = document.getElementById('updateToast');
  if (toast) {
    toast.style.display = 'block';

    // Auto-hide toast after 10 seconds
    setTimeout(() => {
      if (toast.style.display === 'block') {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
      }
    }, 10000);
  }

  // Show system notification if enabled
  if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification('Update Available', {
        body: 'A new version of YoShop is available. Click to update.',
        icon: 'assets/icons/icon.png',
        tag: 'update-notification'
      });
    });
  }
}

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1); // C6

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.error("Audio play failed", e);
  }
}

function triggerAppUpdate(isManual = false) {
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return;

    // If an automatic update is found during checkout, show notification but postpone reload.
    // If it's a manual update (clicked "Update Now"), we reload regardless.
    if (!isManual && isCheckoutActive() && reg.waiting) {
      showUpdateNotification();
      console.log('[UPDATE] Checkout active, postponing automatic reload.');
      return;
    }

    if (reg && reg.waiting) {
      // Send message to SW to skip waiting and activate
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      if (isManual) alert("Checking for updates... If a new version is found, the app will update automatically.");
      if (reg) reg.update();
    }
  });
}

// ===== PWA Install Button Logic (Enhanced for Cross-Browser Support) =====
let deferredPrompt;
const installAppBtn = document.getElementById('installAppBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the default mini-infobar from appearing on mobile
  // e.preventDefault();
  console.log('👍 beforeinstallprompt fired. App is installable.');
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // The button is already visible, just ensure it's enabled.
  installAppBtn.disabled = false;
  installAppBtn.textContent = 'Install App';
});

// Handle manifest loading errors gracefully (common in development/tunnels)
if (document.currentScript && document.currentScript.onerror === undefined) {
  window.addEventListener('error', (event) => {
    if (event.message && event.message.includes('manifest')) {
      console.warn('[PWA] Manifest loading error - continuing without PWA manifest');
    }
  }, true);
}

installAppBtn.addEventListener('click', async () => {
  // Case 1: `beforeinstallprompt` was fired (Chrome, Edge)
  if (deferredPrompt) {
    console.log('📲 Triggering install prompt...');
    deferredPrompt.prompt();
    // The prompt can only be used once.
    deferredPrompt = null;
    return;
  }

  // Case 2: The app is already installed (check display mode)
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    alert('This app is already installed on your device!');
    return;
  }

  // Case 3: Fallback for browsers that don't support `beforeinstallprompt` (like Safari on iOS)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    alert("To install this app on your iPhone or iPad:\n\n1. Tap the 'Share' button in the browser menu.\n2. Scroll down and tap 'Add to Home Screen'.");
  } else {
    alert("This app can be installed, but your browser doesn't support the automatic prompt. Please look for an 'Install' or 'Add to Home Screen' option in your browser's menu.");
  }
});

window.addEventListener('appinstalled', () => {
  installAppBtn.textContent = 'Installed';
  installAppBtn.disabled = true;
});
// ===== Data Export/Import =====
function exportTransactionsToCSV() {
  if (transactions.length === 0) return alert("No transactions to export.");
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Date,Server,Item Name,Quantity,Price,Total,Payment Method,Notes\r\n";
  transactions.forEach(t => {
    t.items.forEach(item => {
      const row = [
        `"${new Date(t.date).toLocaleString()}"`, `"${t.customerName}"`,
        `"${item.name}"`, item.qty, item.price.toFixed(2), (item.qty * item.price).toFixed(2),
        t.paymentMethod, `"${item.notes || ''}"`
      ].join(",");
      csvContent += row + "\r\n";
    });
  });
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", `transactions_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function backupAllData() {
  const dataToBackup = {
    backupVersion: 3,
    exportedAt: new Date().toISOString(),
    businessId: getEffectiveUid?.() || currentUser?.uid || 'guest',
    menu,
    activeOrders,
    transactions,
    saleItems: (Array.isArray(transactions) ? transactions.flatMap(buildSaleItemRecords) : []),
    payments: (Array.isArray(transactions) ? transactions.map(buildPaymentRecord) : []),
    settings,
    staff,
    dishCategories,
    customers,
    units,
    restockHistory,
    appAdminSettings,
    auditTrail
  };

  const jsonString = JSON.stringify(dataToBackup, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `yoshop-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function restoreData() {
  const fileInput = document.getElementById('restoreFile');
  if (fileInput.files.length === 0) {
    await showAppAlert("Please select a backup file to restore.", "Missing File");
    return;
  }

  const confirmed = await showAppConfirm(
    "This will restore the backup on this device first. It will not push empty or raw backup data to cloud during restore. Continue?",
    "Restore Backup",
    "Restore",
    "Cancel"
  );
  if (!confirmed) return;

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (event) {
    try {
      const restoredData = JSON.parse(event.target.result || '{}');

      const restoredMenu = hydrateEnterpriseRecords('products', restoredData.menu || defaultMenu);
      const restoredTransactions = hydrateEnterpriseRecords('sales', restoredData.transactions || []);
      const restoredStaff = hydrateEnterpriseRecords('staff', restoredData.staff || defaultStaff);
      const restoredCustomers = hydrateEnterpriseRecords('customers', restoredData.customers || []);
      const restoredUnits = hydrateEnterpriseRecords('units', restoredData.units || [
        { full: 'Bottle', short: 'btl' },
        { full: 'Box', short: 'box' },
        { full: 'Can', short: 'can' },
        { full: 'Case', short: 'case' },
        { full: 'Each', short: 'each' },
        { full: 'Fluid Ounce', short: 'fl oz' },
        { full: 'Gallon', short: 'gal' },
        { full: 'Gram', short: 'g' },
        { full: 'Kilogram', short: 'kg' },
        { full: 'Litre', short: 'L' },
        { full: 'Millilitre', short: 'ml' },
        { full: 'Ounce', short: 'oz' },
        { full: 'Pack', short: 'pk' },
        { full: 'Piece', short: 'pc' },
        { full: 'Pint', short: 'pt' },
        { full: 'Pound', short: 'lb' }
      ]);
      const restoredRestockHistory = hydrateEnterpriseRecords('inventoryHistory', restoredData.restockHistory || []);

      menu = restoredMenu;
      activeOrders = restoredData.activeOrders || {};
      transactions = restoredTransactions;
      settings = touchSettingsRecord(
        normalizeSettings(restoredData.settings, defaultSettings),
        'settings'
      );
      staff = restoredStaff;
      dishCategories = Array.isArray(restoredData.dishCategories) ? restoredData.dishCategories : defaultDishCategories;
      customers = restoredCustomers;
      units = restoredUnits;
      restockHistory = restoredRestockHistory;
      appAdminSettings = touchSettingsRecord({
        ...defaultAppAdminSettings,
        ...(restoredData.appAdminSettings || {})
      }, 'appAdminSettings');
      auditTrail = Array.isArray(restoredData.auditTrail) ? hydrateEnterpriseRecords('auditLog', restoredData.auditTrail) : [];

      appendAuditEvent('backup_restored', {
        fileName: file.name,
        backupVersion: restoredData.backupVersion || 1,
        restoredAt: new Date().toISOString()
      });

      await saveData(false);
      await mirrorEnterpriseRecordsToLocalStores({ force: true });

      if (Array.isArray(transactions)) {
        await Promise.allSettled(transactions.map(transaction => mirrorSaleDetailsLocally(transaction)));
      }
      if (typeof localRepository?.setMetadata === 'function') {
        await localRepository.setMetadata('restoredBackupPendingCloudSync', {
          fileName: file.name,
          backupVersion: restoredData.backupVersion || 1,
          restoredAt: new Date().toISOString()
        });
      }

      renderDishesTable();
      renderMenu();
      renderTransactions();
      renderCategoryList();
      renderInventoryReport();
      renderStockListTable();
      renderCustomerList();
      renderStaffList();
      renderUnitList();
      renderRestockHistoryTable();
      populateCategoryDropdown();
      populateCategoryFilter();
      populateReportFilters();
      populateUnitDropdown();
      loadSettings();
      updateDashboard();

      fileInput.value = '';

      addNotification(
        "Backup restored on this device. Review it, then sync it to cloud when ready.",
        "info",
        "syncRestoredBackupToCloud()"
      );
      await showAppAlert("Backup restored on this device. Review the data before syncing to cloud.", "Restore Complete");
    } catch (error) {
      console.error("Restore failed:", error);
      await showAppAlert("Restore failed. Please check that the selected file is a valid YoShop backup.", "Restore Failed");
    }
  };

  reader.readAsText(file);
}
async function syncRestoredBackupToCloud() {
  const confirmed = await showAppConfirm(
    "This will upload the restored backup data from this device to Firebase cloud. Continue only after you have reviewed the restored data.",
    "Sync Restored Backup",
    "Sync to Cloud",
    "Cancel"
  );

  if (!confirmed) return;

  try {
    await mirrorEnterpriseRecordsToLocalStores({ force: true });

    const restoredSaleItems = Array.isArray(transactions) ? transactions.flatMap(buildSaleItemRecords) : [];
    const restoredPayments = Array.isArray(transactions) ? transactions.map(buildPaymentRecord) : [];

    await Promise.allSettled([
      ...(Array.isArray(menu) ? menu.map(record => enqueueEnterpriseRecordChange('products', record, 'upsert')) : []),
      ...(Array.isArray(dishCategories) ? getCategoryRecordsFromList(dishCategories).map(record => enqueueEnterpriseRecordChange('categories', record, 'upsert')) : []),
      ...(Array.isArray(customers) ? customers.map(record => enqueueEnterpriseRecordChange('customers', record, 'upsert')) : []),
      ...(Array.isArray(staff) ? staff.map(record => enqueueEnterpriseRecordChange('staff', record, 'upsert')) : []),
      ...(Array.isArray(units) ? units.map(record => enqueueEnterpriseRecordChange('units', record, 'upsert')) : []),
      ...(Array.isArray(restockHistory) ? restockHistory.map(record => enqueueEnterpriseRecordChange('inventory_history', record, 'upsert')) : []),
      ...restoredSaleItems.map(record => enqueueEnterpriseRecordChange('sale_items', record, 'upsert')),
      ...restoredPayments.map(record => enqueueEnterpriseRecordChange('payments', record, 'upsert'))
    ]);

    await saveData(true, {
      allowEmptyOverwriteFields: [
        'menu',
        'staff',
        'customers',
        'dishCategories',
        'units',
        'restockHistory'
      ]
    });

    appendAuditEvent('restored_backup_synced_to_cloud', {
      syncedAt: new Date().toISOString()
    });
    await persistAuditTrail();

    await showAppAlert("Restored backup has been queued and synced to cloud where possible.", "Cloud Sync Complete");
  } catch (error) {
    console.error("Restored backup cloud sync failed:", error);
    await showAppAlert("Could not sync restored backup to cloud. Please check your internet connection and try again.", "Cloud Sync Failed");
  }
}


// ===== Barcode Logic =====

// Global Barcode Listener
let barcodeBuffer = '';
let lastKeyTime = Date.now();

document.addEventListener('keydown', (e) => {
  // Ignore if user is typing in a regular input field (except the scanner test input)
  if (e.target.tagName === 'INPUT' && e.target.id !== 'scannerTestInput') return;
  if (e.target.tagName === 'TEXTAREA') return;

  const currentTime = Date.now();

  // If time between keys is long (>100ms), it's likely manual typing, reset buffer
  // Scanners usually type very fast (<20ms per char)
  if (currentTime - lastKeyTime > 100) {
    barcodeBuffer = '';
  }
  lastKeyTime = currentTime;

  if (e.key === 'Enter') {
    if (barcodeBuffer.length > 0) {
      handleBarcodeScan(barcodeBuffer);
      barcodeBuffer = '';
    }
  } else if (e.key.length === 1) { // Printable characters
    barcodeBuffer += e.key;
  }
});

// ===== Scan Sound (Web Audio API — no external files needed) =====
let _scanAudioCtx = null;

function playScanSound(type = 'success') {
  try {
    if (!_scanAudioCtx) {
      _scanAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = _scanAudioCtx;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    if (type === 'success') {
      // Two-tone ascending beep — classic scanner "got it" sound
      const frequencies = [1046, 1318]; // C6 → E6
      frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.07);
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.07);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + i * 0.07 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.07 + 0.12);
        osc.start(ctx.currentTime + i * 0.07);
        osc.stop(ctx.currentTime + i * 0.07 + 0.13);
      });
    } else {
      // Short low buzz — "not found" warning
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.23);
    }
  } catch (e) {
    // Silently fail if Web Audio is unavailable
    console.warn('playScanSound: Web Audio API unavailable', e);
  }
}

function handleBarcodeScan(code) {
  // 1. Check if in Settings -> Test
  const testInput = document.getElementById('scannerTestInput');
  if (testInput && document.activeElement === testInput) {
    document.getElementById('lastScannedCode').textContent = code;
    testInput.value = code;
    playScanSound('success');
    return;
  }

  // 2. Check if in Menu Tab -> Add to Order
  if (document.getElementById('menuTab').classList.contains('active')) {
    // Search by barcode property first, then fallback to name
    const dish = menu.find(d => (d.barcode && d.barcode === code) || d.name === code);
    if (dish) {
      addToOrder(CART_ID, dish.name);
      playScanSound('success');
    } else {
      playScanSound('error');
      alert(`Item with barcode "${code}" not found in menu.`);
    }
  }

  // 3. Check if in Stock/Dishes Tab -> Search
  if (document.getElementById('stockTab').classList.contains('active')) {
    const searchInput = document.getElementById('stockSearchInput');
    if (searchInput) {
      searchInput.value = code;
      renderStockListTable();
      playScanSound('success');
    }
  }
}

// ===== Mobile Scanner Logic (PeerJS) =====
let peer = null;
let conn = null;
let lastScannedCodeMobile = '';
let lastScannedTimeMobile = 0;

function startMobileConnection() {
  if (peer && !peer.destroyed) {
    showMobileConnectModal(peer.id);
    return;
  }

  // Initialize PeerJS
  peer = new Peer();

  peer.on('open', function (id) {
    showMobileConnectModal(id);
  });

  peer.on('connection', function (c) {
    if (conn) { c.close(); } // Close existing if any

    conn = c;
    setupConnectionHandlers();

    document.getElementById('mobileScannerStatus').textContent = "Phone Connected";
    document.getElementById('mobileScannerStatus').style.color = "#28a745";
    closeMobileConnectModal();
    alert("Mobile phone connected as scanner!");
  });

  peer.on('error', function (err) {
    console.error(err);
    alert("Mobile connection error: " + err.type);
  });
}

function showMobileConnectModal(id) {
  const modal = document.getElementById('mobileConnectModal');
  const qrContainer = document.getElementById('mobileConnectQR');
  const link = document.getElementById('mobileConnectLink');

  // Construct URL: current page + ?mobileScanner=ID
  const url = window.location.protocol + '//' + window.location.host + window.location.pathname + '?mobileScanner=' + id;

  qrContainer.innerHTML = "";
  new QRCode(qrContainer, {
    text: url,
    width: 200,
    height: 200
  });

  link.href = url;
  modal.style.display = 'flex';
}

function closeMobileConnectModal() {
  document.getElementById('mobileConnectModal').style.display = 'none';
}

function setupConnectionHandlers() {
  conn.on('data', function (data) {
    if (data.type === 'barcode') {
      handleBarcodeScan(data.code);
      // Send acknowledgement to flash the screen on mobile
      conn.send({ type: 'ack' });
    }
  });
  conn.on('close', function () {
    document.getElementById('mobileScannerStatus').textContent = "Phone Disconnected";
    document.getElementById('mobileScannerStatus').style.color = "red";
    conn = null;
  });
}

// Check for mobile scanner mode on load
function checkMobileScannerMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const hostId = urlParams.get('mobileScanner');

  if (hostId) {
    initMobileScannerClient(hostId);
    return true; // Stop normal app init
  }
  return false;
}

function initMobileScannerClient(hostId) {
  // Hide splash and main app
  document.getElementById('splash-screen').style.display = 'none';
  document.body.classList.remove('loading');

  // Show mobile scanner UI
  const ui = document.getElementById('mobile-scanner-ui');
  ui.style.display = 'flex';

  const statusEl = document.getElementById('ms-status');

  peer = new Peer();

  peer.on('open', function (id) {
    statusEl.textContent = "Connecting to POS...";
    conn = peer.connect(hostId);

    conn.on('open', function () {
      statusEl.textContent = "Connected to POS ✅";
      statusEl.style.color = "#28a745";
      startMobileCamera();
    });

    conn.on('data', function (data) {
      if (data.type === 'ack') {
        const feedback = document.getElementById('scan-feedback');
        feedback.style.opacity = '1';
        setTimeout(() => feedback.style.opacity = '0', 500);
      }
    });

    conn.on('close', function () {
      statusEl.textContent = "Disconnected from POS ❌";
      statusEl.style.color = "#dc3545";
      alert("Disconnected from POS.");
    });

    conn.on('error', function (err) {
      console.error(err);
      statusEl.textContent = "Connection Error";
    });
  });
}

function startMobileCamera() {
  const scanner = new Html5QrcodeScanner("ms-reader", { fps: 10, qrbox: 250, aspectRatio: 1.0 }, false);
  scanner.render((decodedText) => {
    const now = Date.now();
    // Simple debounce to prevent double scanning the same code instantly
    if (decodedText === lastScannedCodeMobile && now - lastScannedTimeMobile < 2000) {
      return;
    }
    lastScannedCodeMobile = decodedText;
    lastScannedTimeMobile = now;

    if (conn && conn.open) {
      conn.send({ type: 'barcode', code: decodedText });
    }
  });
}

// ===== Camera Scanner Logic =====
let html5QrcodeScanner = null;

function manualBarcodeInput() {
  (async () => {
    let code = null;
    if (typeof showAppPrompt === 'function') {
      code = await showAppPrompt('Enter Product Barcode:', 'Barcode');
    } else {
      code = prompt('Enter Product Barcode:');
    }
    if (code) {
      const trimmedCode = code.trim();
      if (document.getElementById('menuTab').classList.contains('active')) {
        const searchInput = document.getElementById('menuSearch');
        if (searchInput) {
          searchInput.value = trimmedCode;
          renderMenu();
        }
      } else {
        handleBarcodeScan(trimmedCode);
      }
    }
  })();
}

function startCameraScan() {
  document.getElementById('cameraScannerModal').style.display = 'flex';

  // Small delay to ensure modal is rendered
  setTimeout(() => {
    if (!html5QrcodeScanner) {
      html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: 250 },
                /* verbose= */ false);

      html5QrcodeScanner.render((decodedText, decodedResult) => {
        // Success callback
        handleBarcodeScan(decodedText);
        closeCameraScanner();
      }, (errorMessage) => {
        // parse error, ignore it.
      });
    }
  }, 100);
}

function closeCameraScanner() {
  document.getElementById('cameraScannerModal').style.display = 'none';
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().then(() => {
      html5QrcodeScanner = null;
      document.getElementById('reader').innerHTML = "";
    }).catch(error => console.error("Failed to clear scanner", error));
  }
}

function generateAndPrintBarcodes() {
  if (typeof JsBarcode === 'undefined' || typeof window.jspdf === 'undefined') {
    return alert("Barcode libraries not loaded. Please check internet connection.");
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let x = 10, y = 10;
  const width = 60, height = 30; // Label size
  const margin = 5;

  // Filter items that have a barcode or name
  const itemsToPrint = menu.filter(item => item.barcode || item.name);

  if (itemsToPrint.length === 0) return alert("No items to print.");

  itemsToPrint.forEach((item, index) => {
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, item.barcode || item.name, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14
      });
      const imgData = canvas.toDataURL("image/png");

      if (x + width > 200) { x = 10; y += height + margin; }
      if (y + height > 280) { doc.addPage(); x = 10; y = 10; }

      doc.addImage(imgData, 'PNG', x, y, width, height);
      x += width + margin;
    } catch (e) {
      console.warn(`Could not generate barcode for ${item.name}`, e);
    }
  });

  doc.save("barcodes.pdf");
  // To print, we open the PDF in a new tab (blob url)
  const pdfBlob = doc.output('bloburl');
  window.open(pdfBlob, '_blank');
}

function printDishLabel(index) {
  if (typeof JsBarcode === 'undefined' || typeof window.jspdf === 'undefined') {
    return alert("Barcode libraries not loaded. Please check internet connection.");
  }

  const item = menu[index];
  if (!item) return;

  const { jsPDF } = window.jspdf;
  // Create a small label PDF (60mm x 40mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [60, 40]
  });

  doc.setFontSize(10);
  const splitTitle = doc.splitTextToSize(item.name, 55);
  doc.text(splitTitle, 30, 5, { align: 'center' });

  doc.setFontSize(9);
  doc.text(`${settings.currency || '$'}${formatCurrency(item.price)}`, 30, 10 + (splitTitle.length - 1) * 4, { align: 'center' });

  if (item.barcode || item.name) {
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, item.barcode || item.name, { format: "CODE128", displayValue: true, fontSize: 14, margin: 0, height: 50, width: 2 });
      const imgData = canvas.toDataURL("image/png");
      const yPos = 12 + (splitTitle.length - 1) * 4;
      doc.addImage(imgData, 'PNG', 5, yPos, 50, 20);
    } catch (e) { console.warn(`Could not generate barcode for ${item.name}`, e); }
  }

  const pdfBlob = doc.output('bloburl');
  window.open(pdfBlob, '_blank');
}

// ===== Sound Effects (Web Audio API) =====
function playQtyChangeSound(isIncrement) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const startFreq = isIncrement ? 550 : 450;
    const endFreq = isIncrement ? 750 : 350;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + 0.08);

    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.09);
  } catch (e) {
    console.warn("Could not play sound effect:", e);
  }
}

function playCelebrationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Play C major arpeggio sequence (C5, E5, G5, C6)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.1);

      gain.gain.setValueAtTime(0, ctx.currentTime + index * 0.1);
      gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + index * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.1 + 0.25);

      osc.start(ctx.currentTime + index * 0.1);
      osc.stop(ctx.currentTime + index * 0.1 + 0.3);
    });
  } catch (e) {
    console.warn("Could not play celebration sound:", e);
  }
}

// ===== Sales Success Celebration Popup =====
let lastProcessedTransaction = null;

function triggerConfettiAnimation(container) {
  const colors = ['#ff6b35', '#ffb703', '#fb8500', '#219ebc', '#8ecae6', '#4caf50', '#e91e63'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = '50%';
    p.style.top = '50%';

    const angle = Math.random() * Math.PI * 2;
    const velocity = 50 + Math.random() * 120;
    const tx = Math.cos(angle) * velocity;
    const ty = Math.sin(angle) * velocity - (20 + Math.random() * 45); // slight upward bias

    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);

    const size = 5 + Math.random() * 8;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';

    p.style.animationDelay = `${Math.random() * 0.12}s`;
    p.style.animationDuration = `${0.7 + Math.random() * 0.8}s`;

    container.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
}

function showSaleSuccessCelebration(transaction, changeDue = 0) {
  lastProcessedTransaction = transaction;

  const syncState = navigator.onLine ? 'Synced to cloud when connection is available.' : 'Saved offline and will sync when the connection returns.';
  const syncNoticeEl = document.getElementById('successSyncNotice');
  if (syncNoticeEl) {
    syncNoticeEl.textContent = syncState;
    syncNoticeEl.style.display = 'block';
    syncNoticeEl.style.color = navigator.onLine ? '#166534' : '#b45309';
  }

  document.getElementById('successTotalAmount').textContent = formatCurrency(transaction.total);
  const changeRow = document.getElementById('successChangeRow');
  if (transaction.paymentMethod === 'Cash' && changeDue > 0) {
    document.getElementById('successChangeDue').textContent = formatCurrency(changeDue);
    changeRow.style.display = 'flex';
  } else {
    changeRow.style.display = 'none';
  }
  document.getElementById('successPaymentMethod').textContent = transaction.paymentMethod;

  // Silent load in receipt modal so standard printing functions work out of the box
  const receiptModal = document.getElementById('receiptModal');
  receiptModal._transactionData = transaction;
  populateReceiptContent(transaction);

  const modal = document.getElementById('saleSuccessModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // confettis
  const animWrapper = modal.querySelector('.celebration-animation-wrapper');
  animWrapper.querySelectorAll('.confetti-particle').forEach(p => p.remove());
  triggerConfettiAnimation(animWrapper);

  playCelebrationSound();
}

// ===== Real-time Transaction Notifications =====
const notifiedTransactions = new Set();
const appLoadedTime = Date.now();
let unsubscribeTransactionsSync = null;

function triggerPushNotification(title, body) {
  if (Notification.permission === 'granted') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body: body,
          icon: 'assets/icons/icon.png',
          badge: 'assets/icons/android192x192.png',
          vibrate: [200, 100, 200]
        });
      }).catch(err => {
        console.warn('SW push notification failed:', err);
        new Notification(title, { body, icon: 'assets/icons/icon.png' });
      });
    } else {
      new Notification(title, { body, icon: 'assets/icons/icon.png' });
    }
  }
}

function notifyTransaction(tx, isFromOtherDevice = false) {
  const formattedAmount = formatCurrency(tx.total);
  const method = tx.paymentMethod || 'Payment';
  const serverName = tx.customerName || 'Staff';

  const title = isFromOtherDevice ? `New Sale: ${formattedAmount}` : `Sale Processed: ${formattedAmount}`;
  const body = isFromOtherDevice
    ? `A transaction of ${formattedAmount} (${method}) was completed by ${serverName} on another device.`
    : `Transaction of ${formattedAmount} (${method}) processed successfully.`;

  triggerPushNotification(title, body);
  addNotification(body, 'success');
  playNotificationSound();
}

function setupRealTimeTransactionsSync(uid) {
  if (!dbFirestore) return;
  if (unsubscribeTransactionsSync) unsubscribeTransactionsSync();

  try {
    console.log('🟢 [SYNC] Setting up real-time listener for transaction notifications...');
    const txRef = collection(dbFirestore, "users", uid, "transactions");
    
    // Initially load ALL transactions (not just last 10) on first setup
    loadTransactionsFromCloud(uid).catch(e => {
      console.warn('[SYNC] Initial transaction cloud load failed:', e);
    });

    // Then set up listener for new transactions only (for notifications and real-time updates)
    const q = query(txRef, orderBy("date", "desc"), limit(10));

    unsubscribeTransactionsSync = onSnapshot(
      q,
      { includeMetadataChanges: true },
      async (snap) => {
        let hasNewChanges = false;
        snap.docChanges().forEach((change) => {
          if (change.type === "added") {
            const tx = change.doc.data();
            if (tx.date && !notifiedTransactions.has(tx.date)) {
              notifiedTransactions.add(tx.date);

              const txTime = new Date(tx.date).getTime();
              const isRecent = txTime > appLoadedTime - 30000;

              if (isRecent) {
                const isFromOtherDevice = !change.doc.metadata.hasPendingWrites;
                notifyTransaction(tx, isFromOtherDevice);
                hasNewChanges = true;
              }
            }
          }
        });

        if (hasNewChanges) {
          // Load and update state - loads recent transactions to keep dashboard current
          await loadTransactionsFromCloud(uid);
          renderTransactions();
          updateDashboard();
        }
      },
      (error) => {
        captureError('TX_SYNC_LISTENER', error, { uid });
        console.warn('[SYNC] Transaction listener error:', error.code, error.message);
      }
    );
  } catch (error) {
    captureError('TX_SYNC_SETUP', error, { uid });
    console.error('[SYNC] Transaction sync setup failed:', error);
  }
}

// ===== Notification Functions =====
function checkNotificationStatus() {
  const statusEl = document.getElementById('notificationStatus');
  const btn = document.getElementById('enableNotifBtn');
  if (!statusEl) return;

  if (!('Notification' in window)) {
    statusEl.textContent = "Not Supported";
    if (btn) btn.disabled = true;
    return;
  }

  statusEl.textContent = Notification.permission;
  if (btn) {
    if (Notification.permission === 'granted') {
      btn.textContent = "Notifications Enabled";
      btn.disabled = true;
    } else if (Notification.permission === 'denied') {
      btn.textContent = "Notifications Denied";
      btn.disabled = true;
    } else {
      btn.textContent = "Enable Notifications";
      btn.disabled = false;
    }
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return alert("Notifications not supported.");
  const permission = await Notification.requestPermission();
  checkNotificationStatus();
  if (permission === 'granted') {
    testLocalNotification();
  }
}

function testLocalNotification() {
  if (Notification.permission === 'granted') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification('YoShop Notification', {
          body: 'Notifications are working correctly!',
          icon: 'assets/icons/icon.png',
          vibrate: [100, 50, 100]
        });
      });
    } else {
      new Notification('YoShop Notification', {
        body: 'Notifications are working correctly!',
        icon: 'assets/icons/icon.png'
      });
    }
  } else {
    alert("Please enable notifications first.");
  }
}

// ===== Notification Center Logic =====
let appNotifications = [];

function addNotification(message, type = 'info', action = null) {
  const notif = { id: Date.now(), message, type, action, date: new Date() };
  appNotifications.unshift(notif);
  updateNotificationBadge();
  renderNotifications();
}

function addOrUpdateAdminNoticeNotification(message, sentAt, notices = []) {
  if (!message || !sentAt) return;
  const existingIndex = appNotifications.findIndex(n => n.type === 'admin-notice');
  const notif = {
    id: 'admin-notice',
    message,
    type: 'admin-notice',
    action: `openAdminNoticeFromNotification(${JSON.stringify('admin-notice')})`,
    date: new Date(),
    sentAt,
    notices
  };
  if (existingIndex >= 0) {
    appNotifications[existingIndex] = notif;
  } else {
    appNotifications.unshift(notif);
  }
  updateNotificationBadge();
  renderNotifications();
}

function removeAdminNoticeNotification() {
  const before = appNotifications.length;
  appNotifications = appNotifications.filter(n => n.type !== 'admin-notice');
  const banner = document.getElementById('admin-notice-banner');
  if (banner) banner.remove();
  if (appNotifications.length !== before) {
    updateNotificationBadge();
    renderNotifications();
  }
}

function openAdminNoticeFromNotification(id = 'admin-notice') {
  const notice = appNotifications.find(n => n.id === id);
  if (!notice) return;
  const payload = Array.isArray(notice.notices) && notice.notices.length ? notice.notices : [{ message: notice.message, sentAt: notice.sentAt }];
  showAdminNoticesOverlay(payload);
  if (currentUser && notice.sentAt) {
    markNoticeReadOnServer(currentUser.uid, notice.sentAt);
    removeAdminNoticeNotification();
  }
}

function updateNotificationBadge() {
  const badge = document.getElementById('update-badge');
  const btn = document.getElementById('update-notification-btn');
  if (appNotifications.length > 0) {
    badge.style.display = 'block';
    badge.textContent = appNotifications.length > 9 ? '9+' : appNotifications.length;
    badge.style.width = 'auto';
    badge.style.minWidth = '16px';
    badge.style.height = '16px';
    badge.style.padding = '0 4px';
    badge.style.fontSize = '10px';
    badge.style.lineHeight = '16px';
    badge.style.textAlign = 'center';
    badge.style.color = 'white';
    btn.classList.add('ringing');
  } else {
    badge.style.display = 'none';
    btn.classList.remove('ringing');
  }
}

function toggleNotifications() {
  const dropdown = document.getElementById('notificationDropdown');
  const isVisible = dropdown.style.display === 'block';
  dropdown.style.display = isVisible ? 'none' : 'block';
}

function renderNotifications() {
  const list = document.getElementById('notificationList');
  if (appNotifications.length === 0) {
    list.innerHTML = '<div style="padding: 15px; text-align: center; color: #888;">No notifications</div>';
    return;
  }

  list.innerHTML = appNotifications.map(n => {
    const actionBtn = n.action ? `<button class="btn" onclick="${n.action}" style="font-size: 0.8em; padding: 4px 8px; margin-top: 5px; background: var(--primary);">View</button>` : '';
    const background = n.type === 'alert' ? 'rgba(255,0,0,0.05)' : (n.type === 'admin-notice' ? 'rgba(255, 0, 0, 0.08)' : 'transparent');
    const encodedId = typeof n.id === 'string' ? JSON.stringify(n.id) : n.id;
    return `
            <div style="padding: 10px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: start; background: ${background};">
                <div style="font-size: 0.9em; flex-grow: 1;">
                    <div style="margin-bottom: 4px;">${n.message}</div>
                    <div style="font-size: 0.8em; color: #888;">${n.date.toLocaleTimeString()}</div>
                    ${actionBtn}
                </div>
                <button onclick="dismissNotification(${encodedId})" style="background: none; border: none; cursor: pointer; color: #888; font-size: 1.2em; padding: 0 5px;">&times;</button>
            </div>`;
  }).join('');
}

function dismissNotification(id) {
  const existing = appNotifications.find(n => n.id === id);
  if (existing && existing.type === 'admin-notice' && currentUser && existing.sentAt) {
    markNoticeReadOnServer(currentUser.uid, existing.sentAt);
    removeAdminNoticeNotification();
    return;
  }
  appNotifications = appNotifications.filter(n => n.id !== id);
  updateNotificationBadge();
  renderNotifications();
}

function clearAllNotifications() {
  appNotifications = [];
  updateNotificationBadge();
  renderNotifications();
}

function sendLowStockNotification(itemName, currentStock) {
  // Add to in-app notification center
  addNotification(`${itemName} is running low! Only ${Number(currentStock).toFixed(1)} remaining.`, 'alert');

  if (Notification.permission === 'granted') {
    const title = 'Low Stock Alert';
    const options = {
      body: `${itemName} is running low! Only ${Number(currentStock).toFixed(1)} remaining.`,
      icon: 'assets/icons/icon.png',
      tag: 'low-stock-' + itemName,
      vibrate: [200, 100, 200]
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, options);
      });
    } else {
      new Notification(title, options);
    }
  }
}

// Expose functions to global scope for inline event handlers (HTML onclick, etc.)
Object.assign(window, {
  // Data and State (Required for inline HTML references)
  menu, activeOrders, transactions, settings, staff, dishCategories, customers, units, auth, currentUser,
  db, CART_ID, analytics, app, dbFirestore,

  // Functions
  toggleNav, showTab, renderMenu, addDish, generateRandomBarcode, editDish,
  addNewRecipeItemFromForm, updateRecipeItemUnit, updateRecipeTotals,
  previewDishImage, previewLogo, toggleAddDishForm, openBillSplitModal, closeSplitBillModal, renderRestockHistoryTable,
  toggleSelectAllRows, updateSelectAllHeader, updateDeleteMarkedButtonVisibility, deleteMarkedProducts,
  addSplitBill, removeSplitBill, moveItemToFirstBill, moveItemToUnassigned,
  processSplitPayments, addToOrder, decreaseQty, processBill, clearCurrentOrder, updatePaymentTotals,
  toggleCashPaymentFields, calculateChange, finalizePayment, printDishLabel, getCurrentServerName,
  deleteMarkedProducts, deleteItem, previewOrder, downloadCurrentReceiptAsPDF, shareReceipt, convertToProduct, openReportPreview,
  printReceipt, connectUSBScanner, connectBluetoothScanner,
  connectUSBPrinter, connectBluetoothPrinter, disconnectPrinter, testPrint,
  directPrint, renderTransactions, downloadBillAsPDF, deleteTransaction, handleChangePassword,
  reopenTransaction, downloadReportPDF, renderReport, populateReportFilters, saveSettings, addStaff, deleteStaff, editStaff, toggleStaffStatus,
  openStaffPermissionsModal, saveStaffPermissions,
  resetApp, addCategory, editCategory, deleteCategory, addUnit, deleteUnit,
  toggleAddCustomerForm, addCustomer, editCustomer, deleteCustomer, toggleTheme, exportReportToCSV,
  renderStockListTable, editStockItem, toggleStockAdjustmentForm,
  saveStockAdjustment, toggleNewStockItemForm, saveNewStockItem,
  triggerAppUpdate, exportTransactionsToCSV, backupAllData, restoreData, syncRestoredBackupToCloud, prepareLogin,
  manualBarcodeInput, startCameraScan, closeCameraScanner, startMobileConnection, login, loginWithEmail, registerWithEmail, handleForgotPassword, logout, syncNow, renderSyncHealthPanel, closeMobileConnectModal, generateAndPrintBarcodes, requestNotificationPermission,
  showLoginOverlay, testLocalNotification, toggleNotifications, dismissNotification, selectLoginRole, resetLoginStage,
  renderShopNoticesInSettings, showNoticesPage, closeNoticesPage, addOrUpdateAdminNoticeNotification, removeAdminNoticeNotification, openAdminNoticeFromNotification, checkForAdminNoticeForCurrentShop,
  clearAllNotifications, refreshApp, handleSplashScreen, applyTheme, togglePINVisibility, loginWithPIN, lockApp, forgotPIN, searchTransactionsByRange, updateAppAdminCredentials, updateShopStatus, exportReportAsImage,
  toggleAdminAccessForm, saveAdminAccessEntry, editAdminAccessEntry, deleteAdminAccessEntry, toggleAdminAccessStatus, clearYoShopLocalData, resetLocalDatabase,
  refreshAppAdminShops, refreshAppAdminShopsTable, refreshAppAdminSubscriptions, setSubscriptionsFilter, toggleSelectAllSubscriptionRows, runBulkSubscriptionAction, monitorShop, fetchGlobalAnalytics, deleteShop, updateTargetShopStatus,
  switchAppAdminView, updateTargetUserStatus, updateTargetSubscription, updateTargetSubscriptionDate, setFreePlan, updateTargetShopSubscriptionState, generateAutoBarcode, toggleReportCategoryDropdown
  , toggleReportOptionsDropdown, changeReportZoom,

  // PRODUCTION: Monitoring & Debugging (Available in console)
  getAppHealthStatus, exportErrorLog, captureError, getCachedQuery, getShopsPageOptimized, requestCache, errorLog, clearImageFromCache
});
