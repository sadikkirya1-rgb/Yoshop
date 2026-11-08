import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-functions.js';

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
const getOrderDisplay = httpsCallable(getFunctions(app, 'europe-west1'), 'getKioskOrderDisplay');
const displayToken = new URLSearchParams(window.location.hash.slice(1)).get('display') || '';
const columns = {
  received: {list: document.getElementById('receivedOrders'), count: document.getElementById('receivedCount')},
  preparing: {list: document.getElementById('preparingOrders'), count: document.getElementById('preparingCount')},
  ready: {list: document.getElementById('readyOrders'), count: document.getElementById('readyCount')},
  completed: {list: document.getElementById('completedOrders'), count: document.getElementById('completedCount')},
  cancelled: {list: document.getElementById('cancelledOrders'), count: document.getElementById('cancelledCount')}
};
const message = document.getElementById('boardMessage');
const boardColumns = document.getElementById('boardColumns');
const updated = document.getElementById('boardUpdated');
const connection = document.getElementById('boardConnection');
const prepTarget = document.getElementById('boardPrepTarget');
const soundButton = document.getElementById('boardSound');
const compactButton = document.getElementById('boardCompact');
let requestInProgress = false;
let knownOrderIds = null;
let alertAudio = null;
let soundEnabled = false;
let prepTargetMinutes = 15;
let lastSuccessfulUpdateAt = 0;
const highlightedOrderIds = new Set();

function updateConnectionStatus(state, label) {
  connection.className = `board-connection is-${state}`;
  connection.lastChild.textContent = ` ${label}`;
}

function formatWaitTime(createdAt, now = Date.now()) {
  const ageMinutes = Math.max(0, Math.floor((now - createdAt) / 60000));
  return ageMinutes < 60
    ? `${ageMinutes} min waiting`
    : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m waiting`;
}

function updateWaitTimes() {
  const now = Date.now();
  document.querySelectorAll('.board-order-wait[data-created-at]').forEach(wait => {
    const createdAt = new Date(wait.dataset.createdAt).valueOf();
    if (!Number.isFinite(createdAt)) return;
    wait.textContent = formatWaitTime(createdAt, now);
    const card = wait.closest('.board-order');
    const isActive = ['new', 'accepted', 'preparing', 'in_pos'].includes(card.dataset.status);
    const overTarget = isActive && (now - createdAt) / 60000 >= prepTargetMinutes;
    card.classList.toggle('is-over-target', overTarget);
    wait.classList.toggle('is-over-target', overTarget);
  });
  if (lastSuccessfulUpdateAt) {
    const ageSeconds = Math.floor((now - lastSuccessfulUpdateAt) / 1000);
    const isStale = ageSeconds > 30;
    updated.classList.toggle('is-stale', isStale);
    updated.textContent = `Last successful update ${new Date(lastSuccessfulUpdateAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit'})}${isStale ? ' · connection may be stale' : ''}`;
    if (isStale && !connection.classList.contains('is-error')) updateConnectionStatus('stale', 'Connection stale');
    else if (!isStale && connection.classList.contains('is-stale')) updateConnectionStatus('connected', 'Connected');
  }
}

function playNewOrderAlert() {
  if (!soundEnabled || !alertAudio) return;
  const now = alertAudio.currentTime;
  [880, 660].forEach((frequency, index) => {
    const oscillator = alertAudio.createOscillator();
    const gain = alertAudio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, now + index * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.2, now + index * 0.2 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.2 + 0.16);
    oscillator.connect(gain);
    gain.connect(alertAudio.destination);
    oscillator.start(now + index * 0.2);
    oscillator.stop(now + index * 0.2 + 0.17);
  });
}

function createOrderCard(order, currency = '$') {
  const card = document.createElement('article');
  card.className = 'board-order';
  card.dataset.status = order.status;
  if (order.orderId && highlightedOrderIds.has(order.orderId)) card.classList.add('is-new-order');
  const number = document.createElement('strong');
  number.className = 'board-order-number';
  number.textContent = order.orderNumber ? `#${order.orderNumber}` : 'Order number unavailable';
  const orderMode = document.createElement('span');
  orderMode.className = 'board-order-mode';
  orderMode.textContent = {
    dine_in: 'Dine-in',
    takeaway: 'Takeaway',
    delivery: 'Delivery'
  }[order.orderMode] || 'Takeaway';
  const paymentMode = document.createElement('span');
  paymentMode.className = 'board-order-payment';
  paymentMode.textContent = {
    cash: 'Cash',
    card_at_counter: 'Card at counter',
    pay_on_delivery: 'Pay on delivery',
    online_payment: 'Online payment',
    not_specified: 'Payment not specified'
  }[order.paymentMode] || 'Payment not specified';
  const paymentStatus = document.createElement('span');
  paymentStatus.className = `board-order-payment-status${order.paymentStatus === 'paid' ? ' is-paid' : ''}`;
  paymentStatus.textContent = order.paymentStatus === 'paid' ? 'Paid' : 'Payment pending';
  const location = document.createElement('span');
  location.className = `board-order-address${order.orderMode === 'delivery' ? ' is-delivery' : ''}`;
  location.textContent = order.orderMode === 'delivery'
    ? `Deliver to: ${order.deliveryAddress || 'Address not provided'}`
    : order.orderMode === 'dine_in' && order.table ? `Table ${order.table}` : 'Takeaway';
  const itemList = Array.isArray(order.items) ? order.items : [];
  const details = document.createElement('details');
  details.className = 'board-order-items';
  const summary = document.createElement('summary');
  summary.textContent = itemList.length
    ? `${itemList.length} ${itemList.length === 1 ? 'item' : 'items'} · ${itemList.map(item => `${item.quantity}× ${item.name}`).join(', ')}`
    : 'No item details';
  details.appendChild(summary);
  if (itemList.length) {
    const list = document.createElement('ul');
    itemList.forEach(item => {
      const line = document.createElement('li');
      line.textContent = `${item.quantity}× ${item.name}${item.notes ? ` — ${item.notes}` : ''}`;
      list.appendChild(line);
    });
    details.appendChild(list);
  }
  const total = document.createElement('span');
  total.className = 'board-order-total';
  total.textContent = Number.isFinite(order.total) ? `${currency}${order.total.toFixed(2)}` : 'Total unavailable';
  const time = document.createElement('time');
  time.className = 'board-order-time';
  const createdAt = new Date(order.createdAt);
  time.dateTime = Number.isNaN(createdAt.valueOf()) ? '' : createdAt.toISOString();
  time.textContent = Number.isNaN(createdAt.valueOf())
    ? ''
    : createdAt.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  const wait = document.createElement('time');
  wait.className = 'board-order-wait';
  if (Number.isFinite(createdAt.valueOf())) {
    wait.dateTime = createdAt.toISOString();
    wait.dataset.createdAt = createdAt.toISOString();
    wait.textContent = formatWaitTime(createdAt.valueOf());
  }
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${number.textContent}, ${orderMode.textContent}, ${paymentMode.textContent}, ${paymentStatus.textContent}, ${location.textContent}, ${summary.textContent}, ${total.textContent}, ${wait.textContent}, ${time.textContent}`);
  const heading = document.createElement('div');
  heading.className = 'board-order-heading';
  heading.append(number, orderMode, paymentMode, paymentStatus);
  const content = document.createElement('div');
  content.className = 'board-order-content';
  const timing = document.createElement('span');
  timing.className = 'board-order-timing';
  timing.append(wait, time);
  content.append(location, details, total, timing);
  card.append(heading, content);
  return card;
}

function renderColumn(column, orders, currency) {
  column.list.replaceChildren();
  column.count.textContent = String(orders.length);
  if (!orders.length) {
    const empty = document.createElement('p');
    empty.className = 'board-empty';
    empty.textContent = 'No orders';
    column.list.appendChild(empty);
    return;
  }
  orders.forEach(order => column.list.appendChild(createOrderCard(order, currency)));
}

function renderDisplay(data) {
  document.getElementById('boardBusinessName').textContent = data.businessName || 'Order display';
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const nextOrderIds = new Set(orders.map(order => order.orderId).filter(Boolean));
  if (knownOrderIds) {
    const arrivingOrders = orders.filter(order => order.status === 'new' && order.orderId && !knownOrderIds.has(order.orderId));
    arrivingOrders.forEach(order => {
      highlightedOrderIds.add(order.orderId);
      setTimeout(() => highlightedOrderIds.delete(order.orderId), 30000);
    });
    if (arrivingOrders.length) playNewOrderAlert();
  }
  knownOrderIds = nextOrderIds;
  const currency = String(data.currency || '$');
  renderColumn(columns.received, orders.filter(order => order.status === 'new'), currency);
  renderColumn(columns.preparing, orders.filter(order => ['accepted', 'preparing', 'in_pos'].includes(order.status)), currency);
  renderColumn(columns.ready, orders.filter(order => order.status === 'ready'), currency);
  renderColumn(columns.completed, orders.filter(order => ['paid', 'completed'].includes(order.status)), currency);
  renderColumn(columns.cancelled, orders.filter(order => ['rejected', 'cancelled', 'canceled'].includes(order.status)), currency);
  boardColumns.hidden = false;
  message.textContent = '';
  lastSuccessfulUpdateAt = Date.now();
  message.classList.remove('is-error');
  updateConnectionStatus('connected', 'Connected');
  updateWaitTimes();
}

async function refreshBoard() {
  if (requestInProgress) return;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(displayToken)) {
    message.textContent = 'This order display link is invalid. Reopen it from the owner kiosk page.';
    message.classList.add('is-error');
    updateConnectionStatus('error', 'Invalid display link');
    return;
  }
  requestInProgress = true;
  try {
    const response = await getOrderDisplay({displayToken});
    renderDisplay(response.data || {});
  } catch (error) {
    message.textContent = error.message || 'Could not load active orders. Retrying shortly.';
    message.classList.add('is-error');
    updateConnectionStatus('error', 'Connection issue · retrying');
  } finally {
    requestInProgress = false;
  }
}

soundButton.addEventListener('click', async () => {
  try {
    if (!alertAudio) alertAudio = new AudioContext();
    await alertAudio.resume();
    soundEnabled = !soundEnabled;
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
    soundButton.textContent = soundEnabled ? 'Alerts on' : 'Enable alerts';
    if (soundEnabled) playNewOrderAlert();
  } catch (error) {
    message.textContent = 'Sound alerts are unavailable in this browser.';
    message.classList.add('is-error');
  }
});

compactButton.addEventListener('click', () => {
  const compact = document.body.classList.toggle('is-compact');
  compactButton.setAttribute('aria-pressed', String(compact));
  compactButton.textContent = compact ? 'Comfortable view' : 'Compact view';
  try {
    localStorage.setItem('yoshop-order-display-compact', String(compact));
  } catch (error) {
    console.warn('[ORDER DISPLAY] Could not save compact view preference:', error);
  }
});

prepTarget.addEventListener('change', () => {
  prepTargetMinutes = Number(prepTarget.value) || 15;
  try {
    localStorage.setItem('yoshop-order-display-prep-target', String(prepTargetMinutes));
  } catch (error) {
    console.warn('[ORDER DISPLAY] Could not save prep target preference:', error);
  }
  updateWaitTimes();
});

try {
  const savedTarget = localStorage.getItem('yoshop-order-display-prep-target');
  if (['10', '15', '20', '30'].includes(savedTarget)) prepTarget.value = savedTarget;
  prepTargetMinutes = Number(prepTarget.value) || 15;
  const compact = localStorage.getItem('yoshop-order-display-compact') === 'true';
  document.body.classList.toggle('is-compact', compact);
  compactButton.setAttribute('aria-pressed', String(compact));
  compactButton.textContent = compact ? 'Comfortable view' : 'Compact view';
} catch (error) {
  console.warn('[ORDER DISPLAY] Could not restore display preferences:', error);
}

document.getElementById('boardFullscreen').addEventListener('click', async event => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
    event.currentTarget.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  } catch (error) {
    message.textContent = 'Full screen is unavailable in this browser.';
  }
});
document.getElementById('boardClock').textContent = new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
setInterval(() => {
  document.getElementById('boardClock').textContent = new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}, 10000);
setInterval(updateWaitTimes, 15000);
setInterval(() => {
  if (!document.hidden) refreshBoard();
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshBoard();
});
refreshBoard();
