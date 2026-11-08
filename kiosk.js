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
const functions = getFunctions(app, 'europe-west1');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
const table = (params.get('table') || '').trim().slice(0, 40);
const previewOnly = params.get('preview') === '1';
const cart = new Map();
let menuData = {items: [], currency: '$', allowAttendant: false};
let selectedCategory = 'All';
let pendingSubmissionId = '';
let pendingTrackingToken = '';
let deferredInstallPrompt = null;
const VIEW_MODE_STORAGE_KEY = 'yoshop-kiosk-view-mode';
let menuViewMode = 'grid';

const elements = {
  businessName: document.getElementById('businessName'),
  headerBusinessName: document.getElementById('kioskHeaderBusinessName'),
  installMenu: document.getElementById('kioskInstallMenu'),
  installHelp: document.getElementById('kioskInstallHelp'),
  installInstructions: document.getElementById('kioskInstallInstructions'),
  manifest: document.getElementById('kioskManifest'),
  appleTouchIcon: document.getElementById('kioskAppleTouchIcon'),
  appleTitle: document.getElementById('kioskAppleTitle'),
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
  total: document.getElementById('kioskTotal'),
  submit: document.getElementById('placeKioskOrder'),
  attendant: document.getElementById('requestAttendant'),
  retry: document.getElementById('kioskRetry'),
  cartPanel: document.querySelector('.kiosk-cart-panel'),
  cartBackdrop: document.getElementById('kioskCartBackdrop'),
  mobileCart: document.getElementById('kioskMobileCart'),
  mobileCartCount: document.getElementById('kioskMobileCartCount'),
  mobileCartTotal: document.getElementById('kioskMobileCartTotal'),
  cartClose: document.getElementById('kioskCartClose'),
  customerDetails: document.getElementById('kioskCustomerDetails'),
  orderMode: document.getElementById('kioskOrderMode'),
  paymentMode: document.getElementById('kioskPaymentMode'),
  customerTable: document.getElementById('kioskCustomerTable'),
  customerTableLabel: document.getElementById('kioskCustomerTableLabel'),
  deliveryAddress: document.getElementById('kioskDeliveryAddress'),
  deliveryAddressLabel: document.getElementById('kioskDeliveryAddressLabel'),
  deliveryAreaNote: document.getElementById('kioskDeliveryAreaNote'),
  customerName: document.getElementById('kioskCustomerName'),
  customerWhatsApp: document.getElementById('kioskCustomerWhatsApp'),
  waiterName: document.getElementById('kioskWaiterName'),
  detailsError: document.getElementById('kioskDetailsError'),
  backToCart: document.getElementById('kioskBackToCart'),
  confirmOrder: document.getElementById('kioskConfirmOrder'),
  trackOrder: document.getElementById('kioskTrackOrder')
};

function formatMoney(value) {
  return `${menuData.currency || '$'}${(Number(value) || 0).toFixed(2)}`;
}

function setKioskImageFallback(image, fallbackUrl, onFailure) {
  image.onerror = () => {
    if (fallbackUrl && image.dataset.fallbackAttempted !== 'true') {
      image.dataset.fallbackAttempted = 'true';
      image.src = fallbackUrl;
      return;
    }
    onFailure();
  };
}

function createTrackingToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function setMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle('kiosk-error', isError);
  elements.message.classList.toggle('kiosk-mobile-notice', isError || /\b(sending|sent)\b/i.test(message));
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
  const activeCard = document.activeElement?.dataset?.productId === item.id;
  const existing = cart.get(item.id);
  if (item.isAvailable === false || (existing?.quantity || 0) >= 20) return;
  cart.set(item.id, {item, quantity: (existing?.quantity || 0) + 1, notes: existing?.notes || ''});
  renderMenu();
  renderCart();
  if (activeCard) elements.menu.querySelector(`[data-product-id="${CSS.escape(item.id)}"]`)?.focus();
}

function changeCartQuantity(item, change) {
  const existing = cart.get(item.id);
  if (!existing) return;
  const nextQuantity = existing.quantity + change;
  if (nextQuantity <= 0) cart.delete(item.id);
  else cart.set(item.id, {...existing, quantity: Math.min(20, nextQuantity)});
  renderMenu();
  renderCart();
  const nextAction = change > 0 ? 'increment' : 'decrement';
  const row = [...elements.cartItems.querySelectorAll('.kiosk-cart-line')]
    .find(cartRow => cartRow.dataset.productId === item.id);
  const nextControl = row?.querySelector(`[data-quantity-action="${nextAction}"]`);
  if (nextControl && !nextControl.disabled) nextControl.focus();
  else document.getElementById('cartHeading').focus();
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
  items.forEach((item, index) => {
    const imageUrl = item.image || item.fallbackImage;
    const quantity = cart.get(item.id)?.quantity || 0;
    const card = document.createElement('article');
    card.className = `menu-item kiosk-menu-item${quantity > 0 ? ' active' : ''}`;
    card.dataset.productId = item.id;
    if (!previewOnly && item.isAvailable !== false) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${item.name}, ${formatMoney(item.price)}. Tap to add one. ${quantity} selected.`);
      card.addEventListener('click', () => addItem(item), {capture: true});
      card.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        addItem(item);
      });
    } else if (item.isAvailable === false) {
      card.classList.add('is-sold-out');
    }
    const imageWrap = document.createElement('div');
    imageWrap.className = 'kiosk-item-image-wrap';
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.fetchPriority = index < 4 ? 'high' : 'auto';
      setKioskImageFallback(image, item.image && item.fallbackImage !== item.image ? item.fallbackImage : '', () => {
        const placeholder = document.createElement('span');
        placeholder.className = 'kiosk-item-image-placeholder';
        placeholder.textContent = 'No photo';
        image.replaceWith(placeholder);
      });
      imageWrap.appendChild(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'kiosk-item-image-placeholder';
      placeholder.textContent = 'No photo';
      imageWrap.appendChild(placeholder);
    }
    card.appendChild(imageWrap);
    card.classList.add('has-image');
    let selectedCount = null;
    if (!previewOnly && quantity > 0) {
      selectedCount = document.createElement('span');
      selectedCount.className = 'kiosk-selected-count';
      selectedCount.textContent = String(quantity);
      selectedCount.setAttribute('aria-live', 'polite');
      selectedCount.setAttribute('aria-label', `${quantity} selected`);
      imageWrap.appendChild(selectedCount);
    }
    const detail = document.createElement('div');
    detail.className = 'menu-item-body kiosk-item-details';
    const heading = document.createElement('div');
    heading.className = 'menu-item-header menu-item-header-inline';
    const title = document.createElement('h4');
    title.textContent = item.name;
    const price = document.createElement('p');
    price.className = 'kiosk-item-price';
    price.textContent = formatMoney(item.price);
    heading.append(title, price);
    detail.appendChild(heading);
    if (item.isAvailable === false) {
      const availability = document.createElement('span');
      availability.className = 'kiosk-sold-out';
      availability.textContent = 'Sold out';
      availability.setAttribute('aria-label', 'Currently unavailable');
      detail.appendChild(availability);
    }
    card.appendChild(detail);
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
  cart.forEach(({item, quantity}) => {
    quantityTotal += quantity;
    subtotalCents += Math.round(Number(item.price) * 100) * quantity;
    const row = document.createElement('div');
    row.className = `kiosk-cart-line${item.image ? ' has-image' : ''}`;
    row.dataset.productId = item.id;
    const imageBox = document.createElement('div');
    imageBox.className = 'kiosk-cart-line-image-box';
    const imageUrl = item.image || item.fallbackImage;
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      setKioskImageFallback(image, item.image && item.fallbackImage !== item.image ? item.fallbackImage : '', () => {
        imageBox.remove();
        row.classList.remove('has-image');
      });
      imageBox.appendChild(image);
      row.appendChild(imageBox);
    }
    const info = document.createElement('div');
    const titleRow = document.createElement('div');
    titleRow.className = 'kiosk-cart-line-heading';
    const title = document.createElement('div');
    title.className = 'kiosk-cart-line-title';
    title.textContent = item.name;
    const linePrice = document.createElement('div');
    linePrice.className = 'kiosk-cart-line-price';
    linePrice.textContent = formatMoney(item.price * quantity);
    titleRow.append(title, linePrice);
    info.appendChild(titleRow);
    const quantityControls = document.createElement('div');
    quantityControls.className = 'kiosk-cart-quantity-controls';
    quantityControls.setAttribute('role', 'group');
    quantityControls.setAttribute('aria-label', `${item.name} quantity`);
    const decrease = createButton('−', 'kiosk-cart-quantity-button', event => {
      event.preventDefault();
      event.stopPropagation();
      changeCartQuantity(item, -1);
    }, `Remove one ${item.name}`);
    decrease.dataset.quantityAction = 'decrement';
    const count = document.createElement('span');
    count.className = 'kiosk-cart-line-quantity';
    count.textContent = String(quantity);
    count.setAttribute('aria-live', 'polite');
    count.setAttribute('aria-label', `${quantity} selected`);
    const increase = createButton('+', 'kiosk-cart-quantity-button', event => {
      event.preventDefault();
      event.stopPropagation();
      changeCartQuantity(item, 1);
    }, `Add one ${item.name}`);
    increase.dataset.quantityAction = 'increment';
    increase.disabled = quantity >= 20;
    quantityControls.append(decrease, count, increase);
    row.append(info, quantityControls);
    elements.cartItems.appendChild(row);
  });
  elements.cartCount.textContent = String(quantityTotal);
  elements.mobileCartCount.textContent = String(quantityTotal);
  elements.subtotal.textContent = formatMoney(subtotalCents / 100);
  const total = formatMoney(subtotalCents / 100);
  elements.total.textContent = total;
  elements.mobileCartTotal.textContent = total;
  elements.mobileCart.hidden = previewOnly || quantityTotal === 0;
  elements.mobileCart.setAttribute('aria-label', `View cart, ${quantityTotal} ${quantityTotal === 1 ? 'item' : 'items'}, total ${total}`);
  elements.submit.disabled = previewOnly || cart.size === 0;
}

function setCartSheetOpen(open, restoreFocus = true) {
  const isMobile = window.matchMedia('(max-width: 800px)').matches;
  if (!isMobile) open = false;
  const isHidden = isMobile && !open;
  elements.cartPanel.classList.toggle('is-open', open);
  elements.cartPanel.setAttribute('role', open ? 'dialog' : 'complementary');
  elements.cartPanel.setAttribute('aria-hidden', String(isHidden));
  elements.cartPanel.setAttribute('aria-modal', String(open));
  elements.cartPanel.inert = isHidden;
  elements.cartBackdrop.hidden = !open;
  elements.mobileCart.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('kiosk-cart-open', open);
  if (open) {
    elements.cartClose.focus();
  } else if (restoreFocus) {
    if (!elements.mobileCart.hidden) elements.mobileCart.focus();
    else elements.businessName.focus();
  }
}

function openCustomerDetails() {
  if (!cart.size || previewOnly) return;
  elements.customerTable.value = table;
  elements.detailsError.hidden = true;
  elements.customerDetails.hidden = false;
  elements.cartPanel.classList.add('is-entering-details');
  elements.submit.hidden = true;
  if (!window.matchMedia('(max-width: 800px)').matches) {
    elements.customerName.focus({preventScroll: true});
  }
}

function closeCustomerDetails() {
  elements.customerDetails.hidden = true;
  elements.cartPanel.classList.remove('is-entering-details');
  elements.submit.hidden = false;
  elements.submit.focus();
}

function updateOrderModeFields() {
  const isDineIn = elements.orderMode.value === 'dine_in';
  const isDelivery = elements.orderMode.value === 'delivery';
  elements.customerTable.required = isDineIn;
  elements.customerTable.hidden = !isDineIn;
  elements.customerTableLabel.hidden = !isDineIn;
  elements.customerTableLabel.textContent = 'Table number';
  elements.deliveryAddress.hidden = !isDelivery;
  elements.deliveryAddressLabel.hidden = !isDelivery;
  elements.deliveryAreaNote.hidden = !isDelivery;
  elements.deliveryAddress.required = isDelivery;
}

function isInstalledMenu() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function updateInstallButton() {
  elements.installMenu.hidden = previewOnly || isInstalledMenu();
}

function showInstallInstructions() {
  elements.installInstructions.textContent = isIosDevice()
    ? 'In Safari, tap Share, then choose “Add to Home Screen”. The shortcut will use this restaurant’s name and logo.'
    : 'Open your browser menu and choose “Install app” or “Add to Home screen”. If that option is missing, your browser may not support installing this menu.';
  elements.installHelp.showModal();
}

async function installKioskMenu() {
  if (!deferredInstallPrompt) {
    showInstallInstructions();
    return;
  }
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') elements.installMenu.hidden = true;
  } catch (error) {
    console.error('Could not open the kiosk installation prompt:', error);
    showInstallInstructions();
  }
}

function getCustomerOrderDetails() {
  return {
    table: elements.orderMode.value === 'dine_in' ? elements.customerTable.value.trim() : '',
    orderMode: elements.orderMode.value,
    paymentMode: elements.paymentMode.value,
    deliveryAddress: elements.orderMode.value === 'delivery' ? elements.deliveryAddress.value.trim() : '',
    customerName: elements.customerName.value.trim(),
    whatsappNumber: elements.customerWhatsApp.value.trim(),
    waiterName: elements.waiterName.value.trim()
  };
}

async function submitRequest(requestType, customerDetails = null) {
  if (previewOnly) return;
  if (requestType === 'order' && cart.size === 0) return;
  elements.submit.disabled = true;
  elements.attendant.disabled = true;
  elements.confirmOrder.disabled = true;
  elements.trackOrder.hidden = true;
  setMessage(requestType === 'attendant' ? 'Sending your request...' : 'Sending your order...');
  try {
    pendingSubmissionId ||= crypto.randomUUID();
    if (requestType === 'order') pendingTrackingToken ||= createTrackingToken();
    const payload = {
      token,
      requestType,
      ...(requestType === 'order' ? customerDetails : {table}),
      ...(requestType === 'order' ? {trackingToken: pendingTrackingToken} : {}),
      idempotencyKey: pendingSubmissionId,
      items: requestType === 'order' ? [...cart.values()].map(({item, quantity, notes}) => ({productId: item.id, quantity, notes})) : []
    };
    const response = await httpsCallable(functions, 'submitKioskRequest')(payload);
    const orderNumber = String(response.data?.orderNumber || '');
    const orderModeLabel = {
      dine_in: 'dine-in',
      takeaway: 'takeaway',
      delivery: 'delivery'
    }[customerDetails?.orderMode] || 'your';
    if (requestType === 'order' && pendingTrackingToken) {
      const trackingUrl = new URL('order-status.html', window.location.href);
      trackingUrl.hash = new URLSearchParams({tracking: pendingTrackingToken}).toString();
      elements.trackOrder.href = trackingUrl.toString();
      elements.trackOrder.textContent = orderNumber ? `Track order #${orderNumber}` : 'Track your order';
      elements.trackOrder.hidden = false;
    }
    cart.clear();
    pendingSubmissionId = '';
    pendingTrackingToken = '';
    renderCart();
    elements.customerDetails.hidden = true;
    elements.cartPanel.classList.remove('is-entering-details');
    elements.submit.hidden = false;
    setCartSheetOpen(false, false);
    setMessage(requestType === 'attendant'
      ? 'Request sent. A staff member will be with you shortly.'
      : `Order${orderNumber ? ` #${orderNumber}` : ''} sent for ${orderModeLabel}. Your team will prepare it shortly.`);
  } catch (error) {
    if (requestType === 'order') {
      elements.detailsError.textContent = error.message || 'We could not send that order. Please try again.';
      elements.detailsError.hidden = false;
    } else {
      setMessage(error.message || 'We could not send that request. Please try again.', true);
    }
  } finally {
    elements.submit.disabled = previewOnly || cart.size === 0;
    elements.attendant.disabled = previewOnly;
    elements.confirmOrder.disabled = false;
  }
}

async function initialize() {
  document.body.classList.toggle('kiosk-preview-mode', previewOnly);
  elements.businessName.setAttribute('tabindex', '-1');
  elements.retry.addEventListener('click', () => window.location.reload());
  elements.installMenu.addEventListener('click', installKioskMenu);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    elements.installMenu.hidden = true;
  });
  elements.orderMode.addEventListener('change', updateOrderModeFields);
  elements.mobileCart.addEventListener('click', () => setCartSheetOpen(true));
  elements.cartClose.addEventListener('click', () => setCartSheetOpen(false));
  elements.cartBackdrop.addEventListener('click', () => setCartSheetOpen(false));
  elements.submit.addEventListener('click', openCustomerDetails);
  elements.backToCart.addEventListener('click', closeCustomerDetails);
  elements.customerDetails.addEventListener('submit', event => {
    event.preventDefault();
    if (!elements.customerDetails.reportValidity()) return;
    submitRequest('order', getCustomerOrderDetails());
  });
  document.addEventListener('keydown', event => {
    if (!elements.cartPanel.classList.contains('is-open')) return;
    if (event.key === 'Escape') {
      if (!elements.customerDetails.hidden) return;
      setCartSheetOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...elements.cartPanel.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  setCartSheetOpen(false, false);
  if (!token) {
    setMessage('This menu link is incomplete. Please scan the QR code again.', true);
    elements.menu.replaceChildren();
    return;
  }
  elements.manifest.href = `/kiosk-manifest?token=${encodeURIComponent(token)}`;
  updateInstallButton();
  if (table) elements.tableLabel.textContent = `ORDER AT ${table.toUpperCase()}`;
  elements.customerTable.value = table;
  if (!table) elements.orderMode.value = 'takeaway';
  updateOrderModeFields();
  elements.previewNotice.hidden = !previewOnly;
  elements.attendant.hidden = previewOnly;
  const loadingCards = Array.from({length: 3}, () => {
    const card = document.createElement('div');
    card.className = 'kiosk-loading-card';
    card.setAttribute('aria-hidden', 'true');
    return card;
  });
  elements.menu.replaceChildren(...loadingCards);
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
  elements.attendant.addEventListener('click', () => submitRequest('attendant'));
  try {
    if (previewOnly) await getAuth(app).authStateReady();
    const response = await httpsCallable(functions, 'getKioskMenu')({token, preview: previewOnly});
    menuData = {...menuData, ...(response.data || {})};
    if (!menuData.items?.length) {
      setMessage('This menu has no items available yet. Please check back soon.', true);
      elements.menu.replaceChildren();
      elements.retry.hidden = true;
      return;
    }
    elements.businessName.textContent = menuData.businessName || 'Menu';
    elements.headerBusinessName.textContent = menuData.businessName || 'Menu';
    document.title = `${menuData.businessName || 'Restaurant'} Digital Menu`;
    elements.appleTitle.content = (menuData.businessName || 'Digital Menu').slice(0, 30);
    elements.appleTouchIcon.href = `/kiosk-icon?token=${encodeURIComponent(token)}&size=192`;
    updateInstallButton();
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
    elements.retry.hidden = false;
  }
}

initialize();