// Shared k6 helpers. Run the backend with SPRING_PROFILES_ACTIVE=benchmark (rate limiting off).
import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.SAFEROUTE_URL || 'http://localhost:8080';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const TYPES = ['FLOODING', 'BROKEN_SIDEWALK', 'OPEN_MANHOLE', 'POOR_LIGHTING', 'ACCESSIBILITY_BARRIER', 'CONSTRUCTION', 'PATH_OBSTRUCTION'];

/** Registers `n` users once in setup(); VUs share them round-robin. */
export function registerUsers(n) {
  const run = Date.now().toString(36);
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const res = http.post(`${BASE}/api/auth/register`, JSON.stringify({
      email: `k6-${run}-${i}@bench.local`, password: 'password123', displayName: `k6-${i}`,
    }), { headers: JSON_HEADERS });
    check(res, { 'registered': (r) => r.status === 201 });
    tokens.push(res.json('token'));
  }
  return tokens;
}

export function auth(token) {
  return { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } };
}

/** Random point within ~3 km of Makati CBD (inside the coverage area). */
export function randomPoint() {
  const r = 3000 * Math.sqrt(Math.random()), t = Math.random() * 2 * Math.PI;
  return { lat: 14.5547 + (r * Math.cos(t)) / 111320, lon: 121.0244 + (r * Math.sin(t)) / 107760 };
}

export function submitHazard(token) {
  const p = randomPoint();
  const res = http.post(`${BASE}/api/hazard-submissions`, JSON.stringify({
    type: TYPES[Math.floor(Math.random() * TYPES.length)], latitude: p.lat, longitude: p.lon,
  }), { ...auth(token), tags: { name: 'submit' } });
  check(res, { 'submission accepted (202)': (r) => r.status === 202 });
  return res;
}

export function queryNearby(token) {
  const p = randomPoint();
  const res = http.get(`${BASE}/api/hazards/nearby?lat=${p.lat}&lon=${p.lon}&radiusMeters=1000`, { ...auth(token), tags: { name: 'nearby' } });
  check(res, { 'nearby ok': (r) => r.status === 200 });
  return res;
}
