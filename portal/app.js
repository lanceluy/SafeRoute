const API_BASE = 'http://localhost:8080/api';
let authToken = localStorage.getItem('token') || '';
let map, markers = {};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  if (authToken) fetchQueue();
});

function initMap() {
  
  map = L.map('map').setView([14.5547, 121.0244], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
}

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      authToken = data.token;
      localStorage.setItem('token', authToken);
      document.getElementById('auth-status').innerHTML = `<span>Logged in as <b>${email}</b></span>`;
      fetchQueue();
    } else {
      alert('Login failed: ' + (data.message || 'Check credentials'));
    }
  } catch (err) {
    alert('Backend connection error: ' + err.message);
  }
}

async function fetchQueue() {
  try {
    const res = await fetch(`${API_BASE}/moderation/hazards`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Unauthorized or failed fetching queue');
    const hazards = await res.json();
    renderHazards(hazards);
  } catch (err) {
    document.getElementById('hazard-list').innerHTML = `<p style="color:red">${err.message}</p>`;
  }
}

function renderHazards(hazards) {
  const listContainer = document.getElementById('hazard-list');
  listContainer.innerHTML = '';
  
  
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  hazards.forEach(hazard => {
    
    const marker = L.marker([hazard.latitude, hazard.longitude])
      .addTo(map)
      .bindPopup(`<b>${hazard.type}</b><br>Status: ${hazard.status}`);
    markers[hazard.id] = marker;

    
    const card = document.createElement('div');
    card.className = 'hazard-card';
    card.innerHTML = `
      <h3>${hazard.type} (${hazard.severity})</h3>
      <p>Status: <strong>${hazard.status}</strong> | ID: ${hazard.id}</p>
      <p>Location: ${hazard.latitude.toFixed(4)}, ${hazard.longitude.toFixed(4)}</p>
      <div class="actions">
        <button class="btn btn-resolve" onclick="moderateAction('${hazard.id}', 'resolve')">Resolve</button>
        <button class="btn btn-reopen" onclick="moderateAction('${hazard.id}', 'reopen')">Reopen</button>
        <button class="btn btn-remove" onclick="moderateAction('${hazard.id}', 'remove')">Remove</button>
      </div>
    `;
    listContainer.appendChild(card);
  });
}

async function moderateAction(id, action) {
  let endpoint = `${API_BASE}/hazards/${id}/${action}`;
  let method = 'POST';
  if (action === 'remove') method = 'DELETE';

  try {
    const res = await fetch(endpoint, {
      method: method,
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      fetchQueue();
    } else {
      alert(`Failed to ${action} hazard.`);
    }
  } catch (err) {
    alert('Action error: ' + err.message);
  }
}
