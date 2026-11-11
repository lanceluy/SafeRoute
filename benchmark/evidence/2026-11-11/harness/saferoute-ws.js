import http from 'k6/http';
import { sleep } from 'k6';
import { WebSocket } from 'k6/websockets';
import { Counter, Trend } from 'k6/metrics';
import encoding from 'k6/encoding';

// External harness only. No server timestamps, patches, or configuration changes.
const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const N = Number(__ENV.CONNECTIONS || 2000);
const EVENTS = Number(__ENV.EVENTS || 4);
const RAMP = Number(__ENV.RAMP_SECONDS || 60);
const GAP = Number(__ENV.EVENT_GAP_SECONDS || 10);
const TIMEOUT = Number(__ENV.EVENT_TIMEOUT_SECONDS || 30);
const LIFE = RAMP + 60 + EVENTS * GAP + TIMEOUT + 15;
const AUTH = JSON.parse(open(__ENV.AUTH_FILE || './auth.json'));
if (!Number.isInteger(N) || N < 2 || N > 5000) throw Error('CONNECTIONS must be 2..5000');
if (!Number.isInteger(EVENTS) || EVENTS < 1 || EVENTS > 10) throw Error('EVENTS must be 1..10');
if (!(RAMP > 0 && GAP > 0 && TIMEOUT > 0)) throw Error('Timing values must be positive');
if (!AUTH.reporterToken || !AUTH.listenerTokens?.length) throw Error('Provide reporterToken and listenerTokens in auth.json');

const opened = new Counter('connections_opened');
const closedEarly = new Counter('connections_closed_early');
const wsErrors = new Counter('socket_errors');
const loopLag = new Trend('generator_timer_lag_ms', true);
const txStart = new Trend('report_start_epoch_ms');
const rxAt = new Trend('hazard_receive_epoch_ms');
const accepted = new Counter('reports_accepted');
const outcomes = new Counter('report_outcome');
const failed = new Counter('report_failures');
const ownE2E = new Trend('reporter_hazard_e2e_ms', true);
const ownCompletion = new Trend('reporter_completion_e2e_ms', true);
const reporterMatched = new Counter('reporter_matched');
const full = new Counter('target_connections_verified');
const duplicate = new Counter('duplicate_hazard_frames');

export const options = {
  scenarios: {
    sockets: { executor: 'per-vu-iterations', vus: N, iterations: 1,
      maxDuration: `${LIFE + 120}s`, gracefulStop: '5s' },
  },
  setupTimeout: '60s',
  summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    connections_opened: [`count==${N}`],
    connections_closed_early: ['count==0'],
    socket_errors: ['count==0'],
    target_connections_verified: ['count==1'],
    reports_accepted: [`count==${EVENTS}`],
    reporter_matched: [`count==${EVENTS}`],
    report_failures: ['count==0'],
  },
};

function params(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

function pointKey(lat, lon) { return `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`; }
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
function claims(token) {
  return JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's'));
}
function metricConnections(response) {
  if (response.status !== 200) throw Error(`Session gauge returned HTTP ${response.status}`);
  return response.json().measurements.find(m => m.statistic === 'VALUE').value;
}
function sessionURL() { return `${BASE}/actuator/metrics/saferoute.websocket.active_sessions`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function setup() {
  const reporter = claims(AUTH.reporterToken);
  for (const token of [AUTH.reporterToken, ...AUTH.listenerTokens]) {
    const c = claims(token);
    if (c.exp * 1000 < Date.now() + (LIFE + 120) * 1000) throw Error('Refresh tokens: insufficient JWT lifetime for test');
  }
  if (AUTH.listenerTokens.some(t => claims(t).sub === reporter.sub)) {
    throw Error('Reporter and listener accounts must differ, so completion frames reach only the reporter');
  }
  const initial = metricConnections(http.get(sessionURL()));
  if (initial !== 0) throw Error(`Close existing application WebSockets first; active=${initial}`);
  // New, >30m-separated points prevent deduplication from invalidating event matching.
  const lat = Number(__ENV.CENTER_LAT || (14.54 + Math.random() * 0.035));
  const lon = Number(__ENV.CENTER_LON || (121.01 + Math.random() * 0.025));
  const points = Array.from({ length: EVENTS }, (_, i) => ({
    lat: Number((lat + Math.floor(i / 5) * 60 / 111320).toFixed(6)),
    lon: Number((lon + (i % 5) * 60 / 107760).toFixed(6)),
  }));
  for (const p of points) {
    const r = http.get(`${BASE}/api/hazards/nearby?lat=${p.lat}&lon=${p.lon}&radiusMeters=50&limit=250`, params(AUTH.reporterToken));
    if (r.status !== 200) throw Error(`Preflight nearby query HTTP ${r.status}`);
    if (r.json().some(h => h.type === 'OPEN_MANHOLE' || h.hazardType === 'OPEN_MANHOLE')) {
      throw Error('Existing OPEN_MANHOLE within 50m: use another CENTER_LAT/CENTER_LON');
    }
  }
  console.log(JSON.stringify({ kind: 'config', connections: N, events: EVENTS,
    rampSeconds: RAMP, lifeSeconds: LIFE, listenerAccounts: AUTH.listenerTokens.length,
    sharedListenerIdentity: AUTH.listenerTokens.length < N - 1,
    note: 'connection concurrency; not necessarily distinct user accounts' }));
  return { start: Date.now(), points };
}

export default async function (data) {
  const reporter = __VU === 1;
  const token = reporter ? AUTH.reporterToken : AUTH.listenerTokens[(__VU - 2) % AUTH.listenerTokens.length];
  const stop = data.start + LIFE * 1000;
  const scheduled = data.start + (__VU - 1) / Math.max(1, N - 1) * RAMP * 1000;
  if (Date.now() < scheduled) sleep((scheduled - Date.now()) / 1000);
  const known = new Map(data.points.map((p, i) => [pointKey(p.lat, p.lon), String(i)]));
  const seen = new Set();
  const hazardFrames = new Map();
  const completionFrames = new Map();
  const pending = [];
  let normalClose = false;
  let alive = false;
  let openedAt = null;
  let nextTick = Date.now() + 1000;
  const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/notifications`, [], params(token));

  function reconcile(p) {
    if (!p.submissionId || p.done) return;
    const c = completionFrames.get(p.submissionId);
    if (!c) return;
    if (c.frame.status !== 'CREATED') {
      p.done = true; failed.add(1);
      outcomes.add(1, { event: p.event, status: c.frame.status, hazard: c.frame.hazardId || '' });
      console.error(JSON.stringify({ kind: 'invalid_outcome', event: p.event, status: c.frame.status }));
      return;
    }
    if (!p.outcomeRecorded) {
      outcomes.add(1, { event: p.event, status: 'CREATED', hazard: c.frame.hazardId });
      p.outcomeRecorded = true;
    }
    const h = hazardFrames.get(c.frame.hazardId);
    if (!h || h.event !== p.event) return;
    p.done = true;
    ownE2E.add(h.at - p.t0);
    ownCompletion.add(c.at - p.t0);
    reporterMatched.add(1);
    console.log(JSON.stringify({ kind: 'matched', event: p.event, submissionId: p.submissionId,
      hazardId: c.frame.hazardId, startedEpochMs: p.t0, receivedEpochMs: h.at,
      hazardE2EMs: h.at - p.t0, completionE2EMs: c.at - p.t0 }));
  }

  socket.onmessage = e => {
    const at = Date.now(); // timestamp on callback entry, before JSON parsing
    let f;
    try { f = JSON.parse(e.data); } catch (_) { return; }
    if (reporter && f.type === 'submission_processed') {
      completionFrames.set(f.submissionId, { frame: f, at });
      pending.forEach(reconcile);
    }
    if (f.type !== 'hazard_created' || f.hazardType !== 'OPEN_MANHOLE') return;
    const event = known.get(pointKey(f.latitude, f.longitude));
    if (event === undefined) return;
    const key = `${event}:${f.hazardId}`;
    if (seen.has(key)) { duplicate.add(1); return; }
    seen.add(key);
    rxAt.add(at, { event, hazard: f.hazardId, listener: String(__VU) });
    if (reporter) {
      hazardFrames.set(f.hazardId, { event, at });
      pending.forEach(reconcile);
    }
  };
  socket.onerror = () => { wsErrors.add(1); };
  socket.onclose = () => {
    alive = false;
    if (!normalClose) closedEarly.add(1);
  };
  socket.onopen = () => {
    alive = true; openedAt = Date.now(); opened.add(1);
    socket.send(JSON.stringify({ type: 'subscribe', lat: data.points[0].lat, lon: data.points[0].lon }));
  };
  const tick = __VU <= 10 ? setInterval(() => {
    const now = Date.now(); loopLag.add(Math.max(0, now - nextTick)); nextTick = now + 1000;
  }, 1000) : null;
  const heartbeat = setInterval(() => {
    if (alive) socket.send(JSON.stringify({ type: 'subscribe', lat: data.points[0].lat, lon: data.points[0].lon }));
  }, 30000);
  const closing = setTimeout(() => {
    normalClose = true; clearInterval(tick); clearInterval(heartbeat); socket.close();
  }, Math.max(1, stop - Date.now()));

  if (!reporter) return; // k6 keeps this VU's event loop alive while socket/timers exist
  failed.add(0); reporterMatched.add(0); accepted.add(0); full.add(0);
  wsErrors.add(0); closedEarly.add(0);
  try {
    // Require measured server concurrency N continuously for >=10s after ramp.
    await delay(Math.max(1, data.start + RAMP * 1000 + 10000 - Date.now()));
    let stableSince = null;
    const deadline = data.start + (RAMP + 60) * 1000;
    while (Date.now() < deadline) {
      const r = await http.asyncRequest('GET', sessionURL(), null, { timeout: '5s' });
      const count = metricConnections(r);
      if (count === N && alive && openedAt !== null) {
        if (stableSince === null) stableSince = Date.now();
        if (Date.now() - stableSince >= 10000) break;
      } else stableSince = null;
      await delay(1000);
    }
    if (stableSince === null || Date.now() - stableSince < 10000) throw Error('Target concurrent connections not sustained; no hazard requests sent');
    full.add(1);
    console.log(JSON.stringify({ kind: 'target_verified', connections: N, at: Date.now() }));
    for (let i = 0; i < EVENTS; i++) {
      const p = { event: String(i), t0: 0, done: false, submissionId: null };
      const point = data.points[i];
      const r = await http.asyncRequest('GET', sessionURL(), null, { timeout: '5s' });
      if (metricConnections(r) !== N || !alive) throw Error('Connection count changed before event; aborting further reports');
      const body = JSON.stringify({ type: 'OPEN_MANHOLE', latitude: point.lat, longitude: point.lon,
        description: `Synthetic external k6 test event ${i}`, clientRequestId: uuid() });
      pending.push(p);
      p.t0 = Date.now();
      const request = http.asyncRequest('POST', `${BASE}/api/hazard-submissions`, body, params(token));
      txStart.add(p.t0, { event: p.event });
      const response = await request;
      if (response.status !== 202) throw Error(`Report HTTP ${response.status}: ${response.body?.slice(0, 200)}`);
      accepted.add(1);
      p.submissionId = response.json().submissionId;
      if (!p.submissionId) throw Error('Accepted response lacks submissionId');
      reconcile(p); // supports WebSocket outcomes arriving before HTTP response
      setTimeout(() => {
        if (!p.done) {
          p.done = true; failed.add(1);
          console.error(JSON.stringify({ kind: 'event_timeout', event: p.event, submissionId: p.submissionId }));
        }
      }, Math.max(1, p.t0 + TIMEOUT * 1000 - Date.now()));
      await delay(Math.max(1, p.t0 + GAP * 1000 - Date.now()));
    }
  } catch (e) {
    failed.add(1); console.error(String(e));
    // Keep other sockets alive for evidence; threshold failure makes run unsuccessful.
  }
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY_FILE || 'summary.json']: JSON.stringify(data, null, 2) };
}
