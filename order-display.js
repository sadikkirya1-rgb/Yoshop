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
  ready: {list: document.getElementById('readyOrders'), count: document.getElementById('readyCount')}
};
const message = document.getElementById('boardMessage');
const boardColumns = document.getElementById('boardColumns');
const updated = document.getElementById('boardUpdated');
let requestInProgress = false;

function createOrderCard(order) {
  const card = document.createElement('article');
  card.className = 'board-order';
  const number = document.createElement('strong');
  number.className = 'board-order-number';
  number.textContent = order.orderNumber ? `#${order.orderNumber}` : 'Order';
  const table = document.createElement('span');
  table.className = 'board-order-table';
  table.textContent = order.table || 'Counter order';
  card.append(number, table);
  return card;
}

function renderColumn(column, orders) {
  column.list.replaceChildren();
  column.count.textContent = String(orders.length);
  if (!orders.length) {
    const empty = document.createElement('p');
    empty.className = 'board-empty';
    empty.textContent = 'No orders';
    column.list.appendChild(empty);
    return;
  }
  orders.forEach(order => column.list.appendChild(createOrderCard(order)));
}

function renderDisplay(data) {
  document.getElementById('boardBusinessName').textContent = data.businessName || 'Order display';
  const orders = Array.isArray(data.orders) ? data.orders : [];
  renderColumn(columns.received, orders.filter(order => order.status === 'new'));
  renderColumn(columns.preparing, orders.filter(order => ['accepted', 'preparing', 'in_pos'].includes(order.status)));
  renderColumn(columns.ready, orders.filter(order => order.status === 'ready'));
  boardColumns.hidden = false;
  message.textContent = orders.length ? '' : 'No active orders right now.';
  updated.textContent = `Updated ${new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit'})}`;
  message.classList.remove('is-error');
}

async function refreshBoard() {
  if (requestInProgress) return;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(displayToken)) {
    message.textContent = 'This order display link is invalid. Reopen it from the owner kiosk page.';
    message.classList.add('is-error');
    return;
  }
  requestInProgress = true;
  try {
    const response = await getOrderDisplay({displayToken});
    renderDisplay(response.data || {});
  } catch (error) {
    message.textContent = error.message || 'Could not load active orders. Retrying shortly.';
    message.classList.add('is-error');
  } finally {
    requestInProgress = false;
  }
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
setInterval(() => {
  if (!document.hidden) refreshBoard();
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshBoard();
});
refreshBoard();
