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
const getOrderStatus = httpsCallable(getFunctions(app, 'europe-west1'), 'getKioskOrderStatus');
const trackingToken = new URLSearchParams(window.location.hash.slice(1)).get('tracking') || '';
const elements = {
  message: document.getElementById('orderStatusMessage'),
  content: document.getElementById('orderStatusContent'),
  number: document.getElementById('orderNumber'),
  table: document.getElementById('orderTable'),
  timeline: document.getElementById('orderTimeline'),
  updated: document.getElementById('orderUpdated'),
  refresh: document.getElementById('refreshOrderStatus')
};
const stages = [
  {label: 'Order received', statuses: ['new']},
  {label: 'Order confirmed', statuses: ['accepted']},
  {label: 'Being prepared', statuses: ['preparing']},
  {label: 'Ready for you', statuses: ['ready', 'in_pos']},
  {label: 'Completed', statuses: ['paid']}
];
let pollTimer;
let requestInProgress = false;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!document.hidden) refreshStatus();
  }, 15000);
}

function renderOrderStatus(order) {
  elements.number.textContent = order.orderNumber ? `Order #${order.orderNumber}` : 'Your order';
  elements.table.textContent = order.table ? `Table ${order.table}` : '';
  elements.timeline.replaceChildren();
  const stageIndex = stages.findIndex(stage => stage.statuses.includes(order.status));
  stages.forEach((stage, index) => {
    const item = document.createElement('li');
    item.className = 'order-step';
    if (order.status === 'paid' || index < stageIndex) item.classList.add('is-complete');
    if (index === stageIndex && order.status !== 'paid') item.classList.add('is-current');
    const marker = document.createElement('span');
    marker.className = 'order-step-marker';
    marker.textContent = item.classList.contains('is-complete') ? '✓' : String(index + 1);
    const label = document.createElement('span');
    label.className = 'order-step-label';
    label.textContent = stage.label;
    item.append(marker, label);
    elements.timeline.appendChild(item);
  });
  if (order.status === 'rejected') {
    elements.message.textContent = 'The business could not accept this order. Please speak with a staff member.';
    elements.message.classList.add('is-error');
  } else {
    const currentStage = stages[stageIndex];
    elements.message.textContent = order.status === 'paid'
      ? 'Your order is complete. Thank you!'
      : currentStage?.label || 'Your order has been received.';
    elements.message.classList.remove('is-error');
  }
  const updatedAt = order.updatedAt ? new Date(order.updatedAt) : null;
  elements.updated.textContent = updatedAt && !Number.isNaN(updatedAt.valueOf())
    ? `Last updated ${updatedAt.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`
    : '';
  elements.content.hidden = false;
  const isFinal = ['paid', 'rejected'].includes(order.status);
  if (isFinal) clearInterval(pollTimer);
  else startPolling();
}

async function refreshStatus() {
  if (requestInProgress) return;
  if (!/^[a-f0-9]{64}$/i.test(trackingToken)) {
    elements.message.textContent = 'This tracking link is incomplete. Please reopen it from the digital menu.';
    elements.message.classList.add('is-error');
    elements.refresh.hidden = true;
    return;
  }
  requestInProgress = true;
  elements.refresh.disabled = true;
  try {
    const response = await getOrderStatus({trackingToken});
    renderOrderStatus(response.data || {});
  } catch (error) {
    elements.message.textContent = error.message || 'We could not load your order status. Please try again.';
    elements.message.classList.add('is-error');
    startPolling();
  } finally {
    requestInProgress = false;
    elements.refresh.disabled = false;
  }
}

elements.refresh.addEventListener('click', refreshStatus);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStatus();
});
refreshStatus();
