// SafeRoute municipal portal: a map of active hazards plus the moderation queue.
// Backend: /api/moderation/hazards (queue), /api/hazards/in-bbox (map),
// POST /api/hazards/{id}/resolve|reopen and DELETE /api/hazards/{id} (moderator/official only).
// Point it at another backend with ?api=https://host/api

const API_BASE = new URLSearchParams(location.search).get('api') || 'http://localhost:8080/api';
const MODERATOR_ROLES = ['MODERATOR', 'MUNICIPAL_OFFICIAL'];
const CLOSED = ['RESOLVED', 'EXPIRED', 'REMOVED'];
const MAX_BBOX_DEGREES = 0.5; // the backend rejects larger boxes
const STATUS_COLORS = {
  REPORTED: '#ea580c', VERIFIED: '#dc2626', DISPUTED: '#7c3aed',
  RESOLVED: '#16a34a', EXPIRED: '#64748b', REMOVED: '#334155',
};

const store = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* private mode */ } },
  clear() { try { sessionStorage.clear(); } catch { /* private mode */ } },
};

let session = null; // { token, refreshToken, email, role }
let map;
let hazardLayer;
let hazardMarkers = new Map();
let mapRequest = 0;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  $('login-form').addEventListener('submit', onLogin);
  $('logout').addEventListener('click', logout);
  $('status-filter').addEventListener('change', loadQueue);
  const saved = store.get('session');
  if (saved) {
    session = JSON.parse(saved);
    showSession();
    refreshAll();
  }
});

// --- Map ---

function initMap() {
  map = L.map('map').setView([14.5547, 121.0244], 15); // Makati CBD
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  hazardLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => { if (session) loadMapHazards(); });
}

async function loadMapHazards() {
  const b = map.getBounds();
  const note = $('map-note');
  if (b.getNorth() - b.getSouth() > MAX_BBOX_DEGREES || b.getEast() - b.getWest() > MAX_BBOX_DEGREES) {
    hazardLayer.clearLayers();
    hazardMarkers.clear();
    showNote(note, 'Zoom in to see hazards.');
    return;
  }
  const request = ++mapRequest;
  const query = new URLSearchParams({
    minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast(), limit: 250,
  });
  try {
    const res = await api(`/hazards/in-bbox?${query}`);
    if (request !== mapRequest) return; // a newer pan/zoom already asked
    const hazards = await res.json();
    hazardLayer.clearLayers();
    hazardMarkers.clear();
    hazards.forEach(addMarker);
    const truncated = res.headers.get('X-Result-Truncated') === 'true';
    showNote(note, truncated ? 'Showing the 250 most recently updated hazards here. Zoom in to see all of them.' : '');
  } catch (err) {
    showNote(note, `Couldn't load map hazards: ${err.message}`);
  }
}

function addMarker(hazard) {
  const marker = L.circleMarker([hazard.latitude, hazard.longitude], {
    radius: 8, weight: 2, color: '#fff', fillColor: STATUS_COLORS[hazard.status] || '#0f172a', fillOpacity: 0.9,
  }).bindPopup(popupContent(hazard));
  marker.addTo(hazardLayer);
  hazardMarkers.set(hazard.id, marker);
  return marker;
}

function popupContent(hazard) {
  const div = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = label(hazard.type);
  div.append(title, document.createElement('br'), `${label(hazard.status)} · ${label(hazard.severity)} severity`);
  return div;
}

function focusHazard(hazard) {
  const marker = hazardMarkers.get(hazard.id) || addMarker(hazard);
  map.flyTo([hazard.latitude, hazard.longitude], Math.max(map.getZoom(), 17));
  marker.openPopup();
}

// --- Queue ---

async function loadQueue() {
  const list = $('hazard-list');
  const statuses = $('status-filter').value;
  const query = new URLSearchParams({ size: 50 });
  if (statuses) query.set('statuses', statuses);
  try {
    const res = await api(`/moderation/hazards?${query}`);
    const page = await res.json(); // PageResponse: { items, page, size, totalItems, hasMore }
    list.replaceChildren(...page.items.map(card));
    if (page.items.length === 0) list.replaceChildren(empty('Nothing to review here.'));
    $('queue-summary').textContent = page.hasMore
      ? `Showing ${page.items.length} of ${page.totalItems}.`
      : `${page.totalItems} hazard${page.totalItems === 1 ? '' : 's'}.`;
  } catch (err) {
    list.replaceChildren(empty(`Couldn't load the queue: ${err.message}`, true));
    $('queue-summary').textContent = '';
  }
}

function card(hazard) {
  const el = document.createElement('article');
  el.className = 'hazard-card';
  el.tabIndex = 0;
  el.addEventListener('click', (e) => { if (!e.target.closest('button, input')) focusHazard(hazard); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) focusHazard(hazard); });

  const h3 = document.createElement('h3');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = STATUS_COLORS[hazard.status] || '#0f172a';
  h3.append(dot, `${label(hazard.type)} (${label(hazard.severity)})`);

  const meta = document.createElement('p');
  meta.textContent = `${label(hazard.status)} · ${hazard.confirmationCount} confirmed, ${hazard.disputeCount} disputed · `
    + `reported ${new Date(hazard.createdAt).toLocaleString()}`;
  el.append(h3, meta);

  if (hazard.description) {
    const desc = document.createElement('p');
    desc.className = 'description';
    desc.textContent = hazard.description;
    el.append(desc);
  }

  // Recorded in the audit log: the note for resolve/reopen, the reason for remove.
  const note = document.createElement('input');
  note.className = 'note';
  note.maxLength = 500;
  note.placeholder = CLOSED.includes(hazard.status) ? 'Note (optional)' : 'Note or removal reason (optional)';
  note.setAttribute('aria-label', 'Note for the audit log');

  const actions = document.createElement('div');
  actions.className = 'actions';
  if (CLOSED.includes(hazard.status)) {
    actions.append(button('Reopen', 'btn-reopen', () => reopen(hazard, note.value.trim())));
  } else {
    actions.append(button('Resolve', 'btn-resolve', () => resolve(hazard, note.value.trim())),
      confirmButton('Remove', 'Confirm remove', 'btn-remove', () => remove(hazard, note.value.trim())));
  }
  el.append(note, actions);
  return el;
}

/** Removing penalises the reporter's reputation, so it takes a second click within 4 seconds. */
function confirmButton(text, confirmText, className, onConfirm) {
  let armed = false;
  let timer;
  const b = button(text, className, async () => {
    if (!armed) {
      armed = true;
      b.textContent = confirmText;
      timer = setTimeout(() => { armed = false; b.textContent = text; }, 4000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    b.textContent = text;
    await onConfirm();
  });
  return b;
}

function button(text, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${className}`;
  b.textContent = text;
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await onClick(); } finally { b.disabled = false; }
  });
  return b;
}

// --- Moderation actions ---

async function resolve(hazard, note) {
  await act(`/hazards/${hazard.id}/resolve`, { method: 'POST', json: { note: note || null } },
    `Resolved ${label(hazard.type).toLowerCase()}.`);
}

async function reopen(hazard, note) {
  await act(`/hazards/${hazard.id}/reopen`, { method: 'POST', json: { note: note || null } },
    `Reopened ${label(hazard.type).toLowerCase()}.`);
}

async function remove(hazard, reason) {
  const query = reason ? `?${new URLSearchParams({ reason })}` : '';
  await act(`/hazards/${hazard.id}${query}`, { method: 'DELETE' }, `Removed ${label(hazard.type).toLowerCase()}.`);
}

async function act(path, options, successMessage) {
  try {
    await api(path, options);
    showBanner(successMessage, 'success');
    // Resolve is processed asynchronously (202 Accepted); give the event a moment before re-reading.
    setTimeout(refreshAll, 800);
  } catch (err) {
    showBanner(err.message, 'error');
  }
}

// --- Auth ---

async function onLogin(event) {
  event.preventDefault();
  const email = $('email').value.trim();
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: $('password').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Check your email and password.');
    if (!MODERATOR_ROLES.includes(data.role)) {
      throw new Error('This account is not a moderator or municipal official.');
    }
    session = { token: data.token, refreshToken: data.refreshToken, email: data.email, role: data.role };
    store.set('session', JSON.stringify(session));
    $('password').value = '';
    showSession();
    showBanner('', '');
    refreshAll();
  } catch (err) {
    showBanner(`Login failed: ${err.message}`, 'error');
  }
}

function logout() {
  if (session?.refreshToken) {
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => {});
  }
  session = null;
  store.clear();
  hazardLayer.clearLayers();
  hazardMarkers.clear();
  $('session').hidden = true;
  $('login-form').hidden = false;
  $('queue-summary').textContent = '';
  $('hazard-list').replaceChildren(empty('Log in with a moderator or municipal official account to view hazards.'));
}

function showSession() {
  $('login-form').hidden = true;
  $('session').hidden = false;
  $('signed-in-as').textContent = `${session.email} · ${label(session.role)}`;
}

function refreshAll() {
  loadQueue();
  loadMapHazards();
}

/** Authenticated fetch. Access tokens last 30 minutes: on a 401 it refreshes once and retries. */
async function api(path, { method = 'GET', json } = {}, retried = false) {
  if (!session) throw new Error('Not logged in');
  const headers = { Authorization: `Bearer ${session.token}` };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers, body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  if (res.status === 401 && !retried && await refreshToken()) {
    return api(path, { method, json }, true);
  }
  if (res.status === 401) {
    logout();
    throw new Error('Your session expired. Please log in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res;
}

async function refreshToken() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    session = { ...session, token: data.token, refreshToken: data.refreshToken };
    store.set('session', JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

// --- Helpers ---

/** OPEN_MANHOLE -> "Open manhole" */
function label(value) {
  if (!value) return 'Unknown';
  const words = String(value).replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function empty(text, isError = false) {
  const p = document.createElement('p');
  p.className = isError ? 'empty error' : 'empty';
  p.textContent = text;
  return p;
}

function showNote(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function showBanner(text, kind) {
  const banner = $('banner');
  banner.textContent = text;
  banner.className = kind;
  banner.hidden = !text;
  if (kind === 'success') setTimeout(() => { if (banner.textContent === text) banner.hidden = true; }, 4000);
}
