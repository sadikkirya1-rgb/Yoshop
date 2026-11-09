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
const getQueueDisplay = httpsCallable(getFunctions(app, 'europe-west1'), 'getKioskServiceQueueDisplay');
const displayToken = new URLSearchParams(window.location.hash.slice(1)).get('display') || '';
const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
const message = document.getElementById('queueMessage');
const content = document.getElementById('queueContent');
const calledTickets = document.getElementById('queueCalledTickets');
const waitingTickets = document.getElementById('queueWaitingTickets');
const connection = document.getElementById('queueConnection');
const updated = document.getElementById('queueUpdated');
const announcementButton = document.getElementById('queueAnnouncements');
const demoStorageKey = 'yoshop-service-queue-demo-tickets';
let requestInProgress = false;
let announcementsEnabled = false;
let previousCalls = null;
let lastSuccessfulUpdateAt = 0;

function setConnection(state, label) {
  connection.className = `queue-connection is-${state}`;
  connection.textContent = label;
}

function speakTicket(ticket, stationLabel) {
  if (!announcementsEnabled || !('speechSynthesis' in window)) return;
  const phrase = `Ticket ${ticket.ticketNumber}, please proceed to ${ticket.destination || stationLabel}.`;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(phrase));
}

function saveDemoTicket(ticketId, status, destination = '') {
  if (!demoMode) return;
  let tickets = [];
  try {
    tickets = JSON.parse(localStorage.getItem(demoStorageKey) || '[]');
    if (!Array.isArray(tickets)) tickets = [];
  } catch (error) {
    tickets = [];
  }
  tickets = tickets.map(ticket => ticket.ticketId === ticketId
    ? {...ticket, status, destination, statusUpdatedAt: new Date().toISOString()}
    : ticket);
  localStorage.setItem(demoStorageKey, JSON.stringify(tickets));
  refreshDisplay();
}

function getDemoData() {
  let tickets = [];
  try {
    tickets = JSON.parse(localStorage.getItem(demoStorageKey) || '[]');
    if (!Array.isArray(tickets)) tickets = [];
  } catch (error) {
    tickets = [];
  }
  return {businessName: 'Demo Pharmacy', serviceName: 'Pharmacy queue', stationLabel: 'Counter', tickets};
}

function createCalledCard(ticket, stationLabel) {
  const card = document.createElement('article');
  card.className = 'queue-called-card';
  const label = document.createElement('span');
  label.textContent = 'Ticket number';
  const number = document.createElement('strong');
  number.className = 'queue-called-number';
  number.textContent = ticket.ticketNumber ? `#${ticket.ticketNumber}` : '—';
  const destination = document.createElement('div');
  destination.className = 'queue-called-destination';
  destination.textContent = `Please proceed to ${ticket.destination || stationLabel}`;
  card.append(label, number, destination);
  if (demoMode) {
    const complete = document.createElement('button');
    complete.type = 'button';
    complete.textContent = 'Mark complete';
    complete.addEventListener('click', () => saveDemoTicket(ticket.ticketId, 'completed'));
    card.appendChild(complete);
  }
  return card;
}

function createWaitingTicket(ticket) {
  const row = document.createElement('div');
  row.className = 'queue-waiting-ticket';
  const number = document.createElement('strong');
  number.textContent = ticket.ticketNumber ? `#${ticket.ticketNumber}` : '—';
  const createdAt = new Date(ticket.createdAt || '');
  const time = document.createElement('time');
  time.textContent = Number.isFinite(createdAt.valueOf())
    ? `Joined ${createdAt.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`
    : 'Waiting';
  row.append(number, time);
  if (demoMode) {
    const actions = document.createElement('div');
    actions.className = 'queue-demo-actions';
    [1, 2, 3].forEach(station => {
      const destination = `Counter ${station}`;
      const call = document.createElement('button');
      call.type = 'button';
      call.textContent = destination;
      call.addEventListener('click', () => saveDemoTicket(ticket.ticketId, 'called', destination));
      actions.appendChild(call);
    });
    row.appendChild(actions);
  }
  return row;
}

function renderDisplay(data) {
  document.getElementById('queueBusinessName').textContent = data.businessName || 'SERVICE QUEUE';
  document.getElementById('queueServiceName').textContent = data.serviceName || 'Now serving';
  const stationLabel = String(data.stationLabel || 'Counter');
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const called = tickets.filter(ticket => ticket.status === 'called');
  const waiting = tickets.filter(ticket => ticket.status === 'new');
  const nextCalls = new Map(called.map(ticket => [ticket.ticketId, ticket.destination]));
  if (previousCalls) {
    called.forEach(ticket => {
      if (previousCalls.get(ticket.ticketId) !== ticket.destination) speakTicket(ticket, stationLabel);
    });
  }
  previousCalls = nextCalls;
  calledTickets.replaceChildren(...called.map(ticket => createCalledCard(ticket, stationLabel)));
  waitingTickets.replaceChildren(...waiting.map(createWaitingTicket));
  if (!called.length) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent = waiting.length ? 'No tickets are being called right now.' : 'There are no active tickets.';
    calledTickets.appendChild(empty);
  }
  if (!waiting.length) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent = 'No tickets waiting.';
    waitingTickets.appendChild(empty);
  }
  document.getElementById('queueCalledCount').textContent = String(called.length);
  document.getElementById('queueWaitingCount').textContent = String(waiting.length);
  content.hidden = false;
  message.textContent = '';
  message.classList.remove('is-error');
  setConnection('connected', 'Connected');
  lastSuccessfulUpdateAt = Date.now();
  updated.textContent = `Updated ${new Date(lastSuccessfulUpdateAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`;
  updated.classList.remove('is-stale');
}

async function refreshDisplay() {
  if (requestInProgress) return;
  if (!demoMode && !/^[A-Za-z0-9_-]{32,100}$/.test(displayToken)) {
    message.textContent = 'This service display link is invalid. Reopen it from the kiosk settings.';
    message.classList.add('is-error');
    setConnection('error', 'Invalid display link');
    return;
  }
  requestInProgress = true;
  try {
    const response = demoMode ? {data: getDemoData()} : await getQueueDisplay({displayToken});
    renderDisplay(response.data || {});
  } catch (error) {
    message.textContent = error.message || 'Could not load tickets. Retrying shortly.';
    message.classList.add('is-error');
    setConnection('error', 'Connection issue');
  } finally {
    requestInProgress = false;
  }
}

announcementButton.addEventListener('click', () => {
  announcementsEnabled = !announcementsEnabled;
  announcementButton.setAttribute('aria-pressed', String(announcementsEnabled));
  announcementButton.textContent = announcementsEnabled ? 'Announcements on' : 'Enable announcements';
  if (!announcementsEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
});

if (demoMode) {
  document.getElementById('queueDemoNotice').hidden = false;
  document.getElementById('queueResetDemo').hidden = false;
  document.getElementById('queueResetDemo').addEventListener('click', () => {
    localStorage.removeItem(demoStorageKey);
    previousCalls = new Map();
    refreshDisplay();
  });
  window.addEventListener('storage', event => {
    if (event.key === demoStorageKey) refreshDisplay();
  });
}

document.getElementById('queueFullscreen').addEventListener('click', async event => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
    event.currentTarget.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  } catch (error) {
    message.textContent = 'Full screen is unavailable in this browser.';
  }
});

function updateClock() {
  document.getElementById('queueClock').textContent = new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

updateClock();
setInterval(updateClock, 10000);
setInterval(() => {
  if (lastSuccessfulUpdateAt && Date.now() - lastSuccessfulUpdateAt > 30000) {
    updated.classList.add('is-stale');
    updated.textContent = 'Display connection may be stale';
  }
}, 10000);
setInterval(() => { if (!document.hidden) refreshDisplay(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDisplay(); });
refreshDisplay();