#!/usr/bin/env node
// Event-driven (WebSocket) vs polling (GET /api/hazards/nearby every 1/3/5 s) — review §42.
//
//   node latency-compare.mjs [--events 30] [--gap 2000]
//
// For each synthetic hazard the reporter records T_submit (client clock). Then:
//   WebSocket latency     = T_ws_frame_received      - T_submit
//   Polling latency (Xs)  = T_first_poll_containing  - T_submit
// All clocks are the same process, so no clock-skew correction is needed.
import { writeFileSync } from 'node:fs';
import { api, createUsers, openSocket, sleep, now, stats, CENTER } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const EVENTS = opt('events', 30);
const GAP_MS = opt('gap', 2000);
const POLL_INTERVALS = [1000, 3000, 5000];

async function main() {
  const [reporter, wsUser, ...pollUsers] = await createUsers(2 + POLL_INTERVALS.length, 'latency');
  // Unique neighbourhood per run so earlier runs' hazards don't count as detections.
  const spot = { lat: CENTER.lat + (Math.random() - 0.5) * 0.08, lon: CENTER.lon + (Math.random() - 0.5) * 0.08 };
  const ws = await openSocket(wsUser.token, spot);

  const pending = new Map(); // submission index -> { sentAt, point }
  const wsLatency = [], pollLatency = Object.fromEntries(POLL_INTERVALS.map((p) => [p, []]));
  const pollStats = Object.fromEntries(POLL_INTERVALS.map((p) => [p, { requests: 0, emptyOrUnchanged: 0 }]));
  const seenBy = Object.fromEntries(POLL_INTERVALS.map((p) => [p, new Set()]));
  const hazardSentAt = new Map(); // hazardId -> sentAt (filled from WS frames / submission results)

  ws.listeners.push((f) => {
    if (f.type !== 'hazard_created') return;
    // Match the frame to the submission by position (each synthetic point is unique).
    for (const [key, p] of pending) {
      if (Math.abs(p.point.lat - f.latitude) < 1e-7 && Math.abs(p.point.lon - f.longitude) < 1e-7) {
        wsLatency.push(f._receivedAt - p.sentAt);
        hazardSentAt.set(f.hazardId, p.sentAt);
        pending.delete(key);
      }
    }
  });

  let polling = true;
  const pollers = POLL_INTERVALS.map((interval, i) => (async () => {
    const token = pollUsers[i].token;
    let previous = '';
    while (polling) {
      const started = now();
      const list = await api('GET', `/hazards/nearby?lat=${spot.lat}&lon=${spot.lon}&radiusMeters=1000`, undefined, token);
      const s = pollStats[interval];
      s.requests++;
      const ids = list.map((h) => h.id).sort().join(',');
      if (ids === previous) s.emptyOrUnchanged++;
      previous = ids;
      for (const h of list) {
        if (!seenBy[interval].has(h.id) && hazardSentAt.has(h.id)) {
          seenBy[interval].add(h.id);
          pollLatency[interval].push(now() - hazardSentAt.get(h.id));
        }
      }
      await sleep(Math.max(0, interval - (now() - started)));
    }
  })());

  for (let i = 0; i < EVENTS; i++) {
    // Points 45 m apart on a grid, so none fall inside the 30 m dedup radius of another
    // (a merge would correctly produce no hazard_created frame and skew the sample).
    const east = ((i % 10) - 5) * 45, north = (Math.floor(i / 10) - 2) * 45;
    const point = {
      lat: +(spot.lat + north / 111320).toFixed(7),
      lon: +(spot.lon + east / (111320 * Math.cos((spot.lat * Math.PI) / 180))).toFixed(7),
    };
    pending.set(i, { sentAt: now(), point });
    await api('POST', '/hazard-submissions', { type: 'OPEN_MANHOLE', latitude: point.lat, longitude: point.lon }, reporter.token);
    await sleep(GAP_MS);
  }
  await sleep(Math.max(...POLL_INTERVALS) + 3000); // let the slowest poller catch the last hazard
  polling = false;
  await Promise.all(pollers);
  ws.close();

  const summary = {
    scenario: 'event_driven_vs_polling', at: new Date().toISOString(), events: EVENTS,
    websocket: { deliveredEvents: wsLatency.length, latencyMs: stats(wsLatency) },
    polling: Object.fromEntries(POLL_INTERVALS.map((p) => [`${p / 1000}s`, {
      detectionLatencyMs: stats(pollLatency[p]),
      httpRequests: pollStats[p].requests,
      unchangedResponses: pollStats[p].emptyOrUnchanged,
      wastedRequestRatio: +(pollStats[p].emptyOrUnchanged / Math.max(1, pollStats[p].requests)).toFixed(3),
    }])),
  };
  const file = new URL(`../results/latency-compare-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved ${file.pathname}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
