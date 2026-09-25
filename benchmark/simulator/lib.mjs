// Shared helpers for the SafeRoute synthetic event generator. Node >= 22 (built-in fetch + WebSocket).
export const BASE = process.env.SAFEROUTE_URL ?? 'http://localhost:8080';
export const WS_URL = BASE.replace(/^http/, 'ws') + '/ws/notifications';
// Makati CBD — inside the Metro Manila coverage area.
export const CENTER = { lat: 14.5547, lon: 121.0244 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => performance.timeOrigin + performance.now(); // ms, sub-ms precision

export async function api(method, path, body, token) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${json?.error ?? ''}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function createUsers(n, prefix = 'sim') {
  const run = Date.now().toString(36);
  const users = [];
  for (let i = 0; i < n; i++) {
    const email = `${prefix}-${run}-${i}@bench.local`;
    const r = await api('POST', '/auth/register', { email, password: 'password123', displayName: `${prefix}${i}` });
    users.push({ id: r.userId, token: r.token, email });
  }
  return users;
}

export async function login(email, password = 'password123') {
  return (await api('POST', '/auth/login', { email, password })).token;
}

/** Random point within `radiusMeters` of `center`. */
export function randomPoint(center = CENTER, radiusMeters = 3000) {
  const r = radiusMeters * Math.sqrt(Math.random());
  const t = Math.random() * 2 * Math.PI;
  return {
    lat: center.lat + (r * Math.cos(t)) / 111320,
    lon: center.lon + (r * Math.sin(t)) / (111320 * Math.cos((center.lat * Math.PI) / 180)),
  };
}

export const TYPES = ['FLOODING', 'BROKEN_SIDEWALK', 'OPEN_MANHOLE', 'POOR_LIGHTING', 'ACCESSIBILITY_BARRIER', 'CONSTRUCTION', 'PATH_OBSTRUCTION'];
export const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function openSocket(token, at) {
  return new Promise((resolve, reject) => {
    // Node's WebSocket accepts headers through the second-argument options object.
    const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${token}` } });
    ws.frames = [];
    ws.listeners = [];
    ws.onmessage = (e) => {
      const f = JSON.parse(e.data);
      f._receivedAt = now();
      ws.frames.push(f);
      ws.listeners.forEach((l) => l(f));
    };
    ws.onerror = reject;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', lat: at.lat, lon: at.lon }));
      setTimeout(() => resolve(ws), 200);
    };
  });
}

export async function prometheus() {
  const text = await (await fetch(BASE + '/actuator/prometheus')).text();
  const pick = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    accepted: pick(/^saferoute_hazard_report_accepted_total\s+(\S+)/m),
    created: pick(/^saferoute_hazard_report_processed_total\{outcome="created"\}\s+(\S+)/m),
    merged: pick(/^saferoute_hazard_report_processed_total\{outcome="merged"\}\s+(\S+)/m),
    failed: pick(/^saferoute_hazard_report_failed_total\s+(\S+)/m),
    consumerErrors: pick(/^saferoute_kafka_consumer_errors_total\s+(\S+)/m),
    processingP50: pick(/^saferoute_hazard_processing_latency_seconds\{quantile="0\.5"\}\s+(\S+)/m),
    processingP95: pick(/^saferoute_hazard_processing_latency_seconds\{quantile="0\.95"\}\s+(\S+)/m),
    processingP99: pick(/^saferoute_hazard_processing_latency_seconds\{quantile="0\.99"\}\s+(\S+)/m),
    notifyP50: pick(/^saferoute_notification_delivery_latency_seconds\{quantile="0\.5"\}\s+(\S+)/m),
    notifyP95: pick(/^saferoute_notification_delivery_latency_seconds\{quantile="0\.95"\}\s+(\S+)/m),
  };
}

/** avg / median / p95 / p99 / max, as the paper requires. */
export function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const r = (x) => Math.round(x * 10) / 10;
  return { n: s.length, avg: r(s.reduce((a, b) => a + b, 0) / s.length), median: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) };
}
