const API_BASE = 'http://localhost:8080/api';
let authToken = localStorage.getItem('token') || '';
let map, markers = {}, hazardChart = null;
let allHazards = [], db = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initIndexedDB();
  initMap();
  if (navigator.onLine) {
    if (authToken) fetchAndProcessHazards();
  } else {
    loadCachedHazards();
  }

  window.addEventListener('online', () => fetchAndProcessHazards());
  window.addEventListener('offline', () => loadCachedHazards());
});

function initIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('SafeRouteDB', 1);
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      db.createObjectStore('hazards', { keyPath: 'id' });
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(); };
    request.onerror = () => resolve();
  });
}

function cacheHazardsLocally(hazards) {
  if (!db) return;
  const tx = db.transaction('hazards', 'readwrite');
  const store = tx.objectStore('hazards');
  store.clear();
  hazards.forEach(h => store.put(h));
}

function loadCachedHazards() {
  if (!db) return;
  const tx = db.transaction('hazards', 'readonly');
  const store = tx.objectStore('hazards');
  const req = store.getAll();
  req.onsuccess = () => {
    allHazards = req.result || [];
    renderAllViews();
  };
}

function initMap() {
  map = L.map('map').setView([14.5547, 121.0244], 13); // Makati Center
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
}

async function fetchAndProcessHazards() {
  try {
    const res = await fetch(`${API_BASE}/moderation/hazards`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Failed to fetch hazards');
    allHazards = await res.json();
    cacheHazardsLocally(allHazards);
    renderAllViews();
  } catch (err) {
    loadCachedHazards();
  }
}

function renderAllViews() {
  renderMapMarkers();
  renderModerationQueue();
  renderDuplicatesTab();
  renderArchivedTab();
  renderAnalyticsChart();
}

function renderMapMarkers() {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  allHazards.filter(h => h.status !== 'ARCHIVED').forEach(hazard => {
    let color = '#ef4444'; 
    if (hazard.severity === 'LOW') color = '#eab308'; 
    else if (hazard.severity === 'MEDIUM') color = '#f97316';

    const circle = L.circleMarker([hazard.latitude, hazard.longitude], {
      color: color, fillColor: color, fillOpacity: 0.7, radius: 8
    }).addTo(map).bindPopup(`<b>${hazard.type}</b> (${hazard.severity})<br>Status: ${hazard.status}`);
    markers[hazard.id] = circle;
  });
}

function isOlderThanOneWeek(dateString) {
  const reportDate = new Date(dateString);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  return reportDate < oneWeekAgo;
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderModerationQueue() {
  const list = document.getElementById('moderation-list');
  list.innerHTML = '';
 
  const active = allHazards.filter(h => h.status === 'PENDING' && !isOlderThanOneWeek(h.createdAt));
  active.forEach(h => list.appendChild(createHazardCard(h)));
}

function renderDuplicatesTab() {
  const list = document.getElementById('duplicates-list');
  list.innerHTML = '';

  const duplicates = [];
  for (let i = 0; i < allHazards.length; i++) {
    for (let j = i + 1; j < allHazards.length; j++) {
      const h1 = allHazards[i], h2 = allHazards[j];
      if (h1.type === h2.type && calculateDistanceMeters(h1.latitude, h1.longitude, h2.latitude, h2.longitude) < 50) {
        duplicates.push({ primary: h1, duplicate: h2 });
      }
    }
  }

  if (duplicates.length === 0) { list.innerHTML = '<p>No duplicate reports detected within 50m.</p>'; return; }
  duplicates.forEach(pair => {
    const card = document.createElement('div');
    card.className = 'hazard-card severity-medium';
    card.innerHTML = `
      <h3>Collated Duplicate: ${pair.primary.type}</h3>
      <p>Report 1 ID: ${pair.primary.id} | Report 2 ID: ${pair.duplicate.id}</p>
      <p>Proximity: Within 50 meters</p>
      <div class="actions">
        <button class="btn btn-resolve" onclick="moderateAction('${pair.primary.id}', 'resolve')">Merge & Resolve</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function renderArchivedTab() {
  const list = document.getElementById('archived-list');
  list.innerHTML = '';

  const archived = allHazards.filter(h => h.status === 'ARCHIVED' || (h.status === 'PENDING' && isOlderThanOneWeek(h.createdAt)));
  if (archived.length === 0) { list.innerHTML = '<p>No unreviewed hazards older than 1 week.</p>'; return; }

  archived.forEach(h => list.appendChild(createHazardCard(h, true)));
}

function createHazardCard(hazard, isArchived = false) {
  const card = document.createElement('div');
  card.className = `hazard-card severity-${hazard.severity ? hazard.severity.toLowerCase() : 'low'}`;
  card.innerHTML = `
    <h3>${hazard.type} (${hazard.severity || 'LOW'})</h3>
    <p>Status: <strong>${isArchived ? 'ARCHIVED (Expired)' : hazard.status}</strong></p>
    <p>Reported: ${new Date(hazard.createdAt || Date.now()).toLocaleDateString()}</p>
    <div class="actions">
      <button class="btn btn-resolve" onclick="moderateAction('${hazard.id}', 'resolve')">Resolve</button>
      <button class="btn btn-remove" onclick="moderateAction('${hazard.id}', 'remove')">Remove</button>
    </div>
  `;
  return card;
}

function showRegisterModal() { document.getElementById('register-modal').style.display = 'flex'; }
function closeRegisterModal() { document.getElementById('register-modal').style.display = 'none'; }

async function registerAgent() {
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-pass').value;
  const city = document.getElementById('reg-city').value;

  const res = await fetch(`${API_BASE}/auth/register-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, city, role: 'MUNICIPAL_OFFICIAL' })
  });
  if (res.ok) {
    alert('Agent registered successfully!');
    closeRegisterModal();
  } else {
    alert('Failed to register agent.');
  }
}

function exportFormalReport(tab) {
  const headers = ["Hazard ID", "City/LGU", "Type", "Severity", "Latitude", "Longitude", "Status", "Date Reported"];
  const rows = allHazards.map(h => [
    `"${h.id}"`, `"Makati City"`, `"${h.type}"`, `"${h.severity}"`,
    h.latitude, h.longitude, `"${h.status}"`, `"${new Date(h.createdAt || Date.now()).toISOString()}"`
  ]);

  let csvContent = "data:text/csv;charset=utf-8," 
    + "OFFICIAL MUNICIPAL HAZARD REPORT - MAKATI CITY LGU\n"
    + `Generated On: ${new Date().toLocaleString()}\n\n`
    + headers.join(",") + "\n"
    + rows.map(e => e.join(",")).join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `SafeRoute_Hazard_Report_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function renderAnalyticsChart() {
  const barangay = document.getElementById('barangay-select').value;
  const ctx = document.getElementById('hazardChart').getContext('2d');

  const types = ['Obstruction', 'Flooding', 'Infrastructure Damage', 'Poor Lighting'];
  const counts = types.map(type => {
    return allHazards.filter(h => {
      const matchType = h.type === type;
      const matchBarangay = (barangay === 'ALL') || (h.barangay === barangay);
      return matchType && matchBarangay;
    }).length;
  });

  if (hazardChart) hazardChart.destroy();

  hazardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: types,
      datasets: [{
        label: `Hazard Frequency (${barangay})`,
        data: counts,
        backgroundColor: ['#eab308', '#3b82f6', '#ef4444', '#8b5cf6']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  event.target.classList.add('active');
  if (tabId === 'map-tab') setTimeout(() => map.invalidateSize(), 200);
}

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (res.ok && data.token) {
    authToken = data.token;
    localStorage.setItem('token', authToken);
    fetchAndProcessHazards();
  }
}

async function moderateAction(id, action) {
  const res = await fetch(`${API_BASE}/hazards/${id}/${action}`, {
    method: action === 'remove' ? 'DELETE' : 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (res.ok) fetchAndProcessHazards();
}
