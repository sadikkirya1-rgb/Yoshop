import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-functions.js';
import {getAuth} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAYvXfCDMzylmevTAoePLW84KhxLHAX9SA',
  authDomain: 'yoshop-b502f.firebaseapp.com',
  projectId: 'yoshop-b502f',
  storageBucket: 'yoshop-b502f.firebasestorage.app',
  messagingSenderId: '860076092806',
  appId: '1:860076092806:web:1a83971ae7637ef2cd1007',
  measurementId: 'G-5PETKNBCNF'
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
const table = (params.get('table') || '').trim().slice(0, 40);
const previewOnly = params.get('preview') === '1';
const cart = new Map();
let menuData = {items: [], currency: '$', taxRate: 0, allowAttendant: false};
let selectedCategory = 'All';
let pendingSubmissionId = '';
const VIEW_MODE_STORAGE_KEY = 'yoshop-kiosk-view-mode';
let menuViewMode = 'grid';

const elements = {
  businessName: document.getElementById('businessName'),
  tableLabel: document.getElementById('kioskTableLabel'),
  message: document.getElementById('kioskMessage'),
  previewNotice: document.getElementById('kioskPreviewNotice'),
  search: document.getElementById('kioskSearch'),
  sort: document.getElementById('kioskSort'),
  categories: document.getElementById('kioskCategories'),
  menu: document.getElementById('kioskMenuItems'),
  resultsCount: document.getElementById('kioskResultsCount'),
  listView: document.getElementById('kioskListView'),
  gridView: document.getElementById('kioskGridView'),
  cartItems: document.getElementById('kioskCartItems'),
  cartCount: document.getElementById('kioskCartCount'),
  subtotal: document.getElementById('kioskSubtotal'),
  tax: document.getElementById('kioskTax'),
  total: document.getElementById('kioskTotal'),
  submit: document.getElementById('placeKioskOrder'),
  attendant: document.getElementById('requestAttendant')
};

function formatMoney(value) {
  return `${menuData.currency || '$'}${(Number(value) || 0).toFixed(2)}`;
}

function setMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle('kiosk-error', isError);
}

function createButton(text, className, handler, label = text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', handler);
  return button;
}

function renderCategories() {
  const categories = ['All', ...new Set(menuData.items.map(item => item.category || 'Menu'))];
  elements.categories.replaceChildren();
  categories.forEach(category => {
    const button = createButton(category, 'kiosk-category-button', () => {
      selectedCategory = category;
      renderCategories();
      renderMenu();
    });
    button.setAttribute('aria-pressed', String(category === selectedCategory));
    elements.categories.appendChild(button);
  });
}

function setMenuViewMode(mode, persist = true) {
  menuViewMode = mode === 'list' ? 'list' : 'grid';
  elements.menu.dataset.viewMode = menuViewMode;
  elements.listView.setAttribute('aria-pressed', String(menuViewMode === 'list'));
  elements.gridView.setAttribute('aria-pressed', String(menuViewMode === 'grid'));
  if (persist) {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, menuViewMode);
    } catch (error) {
      // The selected layout still applies for this page session.
    }
  }
}

function addItem(item) {
  const existing = cart.get(item.id);
  cart.set(item.id, {item, quantity: Math.min(20, (existing?.quantity || 0) + 1), notes: existing?.notes || ''});
  renderCart();
}

function renderMenu() {
  const search = elements.search.value.trim().toLowerCase();
  const sort = elements.sort.value;
  const items = menuData.items.filter(item => {
    const matchesCategory = selectedCategory === 'All' || (item.category || 'Menu') === selectedCategory;
    const matchesSearch = `${item.name} ${item.description || ''}`.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });
  if (sort === 'name') items.sort((left, right) => left.name.localeCompare(right.name));
  if (sort === 'price-low') items.sort((left, right) => Number(left.price) - Number(right.price));
  if (sort === 'price-high') items.sort((left, right) => Number(right.price) - Number(left.price));
  elements.resultsCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  elements.menu.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'kiosk-cart-empty';
    empty.textContent = 'No menu items match this search.';
    elements.menu.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const card = document.createElement('article');
    card.className = 'kiosk-menu-item';
    if (item.image) {
      const image = document.createElement('img');
      image.src = item.image;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.fetchPriority = 'low';
      image.referrerPolicy = 'no-referrer';
      image.onerror = () => image.remove();
      card.appendChild(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'kiosk-item-image-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      card.appendChild(placeholder);
    }
    const detail = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = item.name;
    const description = document.createElement('p');
    description.textContent = item.description || item.category || '';
    const price = document.createElement('span');
    price.className = 'kiosk-item-price';
    price.textContent = formatMoney(item.price);
    detail.append(title, description, price);
    card.appendChild(detail);
    if (!previewOnly) {
      card.appendChild(createButton('+', 'kiosk-add-button', () => addItem(item), `Add ${item.name} to order`));
    }
    elements.menu.appendChild(card);
  });
}

function renderCart() {
  elements.cartItems.replaceChildren();
  let quantityTotal = 0;
  let subtotalCents = 0;
  if (!cart.size) {
    const empty = document.createElement('p');
    empty.className = 'kiosk-cart-empty';
    empty.textContent = previewOnly ? 'Preview does not place orders.' : 'Your order is empty. Add items from the menu.';
    elements.cartItems.appendChild(empty);
  }
  cart.forEach(({item, quantity, notes}) => {
    quantityTotal += quantity;
    subtotalCents += Math.round(Number(item.price) * 100) * quantity;
    const row = document.createElement('div');
    row.className = 'kiosk-cart-line';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'kiosk-cart-line-title';
    title.textContent = item.name;
    const linePrice = document.createElement('div');
    linePrice.className = 'kiosk-cart-line-price';
    linePrice.textContent = formatMoney(item.price * quantity);
    info.append(title, linePrice);
    const controls = document.createElement('div');
    controls.className = 'kiosk-quantity-controls';
    controls.appendChild(createButton('-', '', () => {
      if (quantity <= 1) cart.delete(item.id);
      else cart.set(item.id, {item, quantity: quantity - 1, notes});
      renderCart();
    }, `Remove one ${item.name}`));
    const count = document.createElement('span');
    count.textContent = String(quantity);
    controls.append(count, createButton('+', '', () => {
      cart.set(item.id, {item, quantity: Math.min(20, quantity + 1), notes});
      renderCart();
    }, `Add one ${item.name}`));
    row.append(info, controls);
    if (!previewOnly) {
      const notesInput = document.createElement('textarea');
      notesInput.maxLength = 200;
      notesInput.placeholder = 'Special request (optional)';
      notesInput.value = notes;
      notesInput.setAttribute('aria-label', `Special request for ${item.name}`);
      notesInput.addEventListener('change', () => cart.set(item.id, {item, quantity, notes: notesInput.value.trim()}));
      row.appendChild(notesInput);
    }
    elements.cartItems.appendChild(row);
  });
  const taxCents = Math.round(subtotalCents * Math.min(30, Math.max(0, Number(menuData.taxRate) || 0)) / 100);
  elements.cartCount.textContent = String(quantityTotal);
  elements.subtotal.textContent = formatMoney(subtotalCents / 100);
  elements.tax.textContent = formatMoney(taxCents / 100);
  elements.total.textContent = formatMoney((subtotalCents + taxCents) / 100);
  elements.submit.disabled = previewOnly || cart.size === 0;
}

async function submitRequest(requestType) {
  if (previewOnly) return;
  if (requestType === 'order' && cart.size === 0) return;
  elements.submit.disabled = true;
  elements.attendant.disabled = true;
  setMessage(requestType === 'attendant' ? 'Sending your request...' : 'Sending your order...');
  try {
    pendingSubmissionId ||= crypto.randomUUID();
    const payload = {
      token,
      requestType,
      table,
      idempotencyKey: pendingSubmissionId,
      items: requestType === 'order' ? [...cart.values()].map(({item, quantity, notes}) => ({productId: item.id, quantity, notes})) : []
    };
    await httpsCallable(functions, 'submitKioskRequest')(payload);
    cart.clear();
    pendingSubmissionId = '';
    renderCart();
    setMessage(requestType === 'attendant' ? 'Your request has been sent. A staff member will be with you shortly.' : 'Your order has been sent. Please pay your server or cashier when it is ready.');
  } catch (error) {
    setMessage(error.message || 'We could not send that request. Please try again.', true);
  } finally {
    elements.submit.disabled = previewOnly || cart.size === 0;
    elements.attendant.disabled = previewOnly;
  }
}

async function initialize() {
  if (!token) {
    setMessage('This menu link is incomplete. Please scan the QR code again.', true);
    elements.menu.replaceChildren();
    return;
  }
  if (table) elements.tableLabel.textContent = `ORDER AT ${table.toUpperCase()}`;
  elements.previewNotice.hidden = !previewOnly;
  elements.attendant.hidden = previewOnly;
  elements.search.addEventListener('input', renderMenu);
  elements.sort.addEventListener('change', renderMenu);
  elements.listView.addEventListener('click', () => setMenuViewMode('list'));
  elements.gridView.addEventListener('click', () => setMenuViewMode('grid'));
  try {
    const storedMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (storedMode === 'list' || storedMode === 'grid') menuViewMode = storedMode;
  } catch (error) {
    menuViewMode = window.matchMedia('(max-width: 700px)').matches ? 'list' : 'grid';
  }
  setMenuViewMode(menuViewMode, false);
  elements.submit.addEventListener('click', () => submitRequest('order'));
  elements.attendant.addEventListener('click', () => submitRequest('attendant'));
  try {
    if (previewOnly) await getAuth(app).authStateReady();
    const response = await httpsCallable(functions, 'getKioskMenu')({token, preview: previewOnly});
    menuData = {...menuData, ...(response.data || {})};
    if (!menuData.items?.length) throw new Error('This menu is not available right now.');
    elements.businessName.textContent = menuData.businessName || 'Menu';
    elements.attendant.hidden = previewOnly || menuData.allowAttendant === false;
    setMessage(table ? `Choose your items for ${table}.` : 'Choose your items and send your order to the team.');
    renderCategories();
    renderMenu();
    renderCart();
  } catch (error) {
    const details = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    const message = /functions\/internal|\binternal\b|cors|failed to fetch|networkerror/.test(details)
      ? 'The digital menu service is temporarily unavailable. Please try again later.'
      : error.message || 'This digital menu is unavailable.';
    setMessage(message, true);
    elements.menu.replaceChildren();
  }
}

initialize();