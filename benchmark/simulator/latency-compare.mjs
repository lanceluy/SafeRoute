#!/usr/bin/env node
// Event-driven (WebSocket) vs polling (GET /api/hazards/nearby every 1/3/5 s).
//
//   node latency-compare.mjs [--events 30] [--gap 2000]
//
// Every client — the WebSocket subscriber and each poller — records its own first sighting of
// each hazard id, independently. Submissions are matched to hazard ids through their own outcome
// (GET /api/hazard-submissions/{id}), never through another client, so a slow or dropped
// WebSocket frame can't change or hide a polling measurement. Latency = first sighting − submit
// time, all on this process's clock (no skew correction needed). Reports are sent at randomized
// intervals (gap × 0.5–1.5) so polls are not phase-locked to them. Raw observations are saved.
import { writeFileSync } from 'node:fs';
import { api, createUsers, openSocket, sleep, now, CENTER } from './lib.mjs';
import { correlateDetections, sourceRevision } from './analysis.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const EVENTS = opt('events', 30);
const GAP_MS = opt('gap', 2000);
const POLL_INTERVALS = [1000, 3000, 5000];
const POLL_LIMIT = 250; // server maximum; a full page means the sample may be incomplete

async function main() {
  if (EVENTS > 200) throw new Error('Use at most 200 events per run: the nearby query returns at most 250 hazards.');
  const [reporter, wsUser, ...pollUsers] = await createUsers(2 + POLL_INTERVALS.length, 'latency');
  // Unique neighbourhood per run so earlier runs' hazards don't count as detections.
  const spot = { lat: CENTER.lat + (Math.random() - 0.5) * 0.08, lon: CENTER.lon + (Math.random() - 0.5) * 0.08 };
  const ws = await openSocket(wsUser.token, spot);

  const observations = []; // { client, hazardId, at }
  ws.listeners.push((f) => {
    if (f.type === 'hazard_created') observations.push({ client: 'websocket', hazardId: f.hazardId, at: f._receivedAt });
  });

  const pollStats = Object.fromEntries(POLL_INTERVALS.map((p) => [p, { requests: 0, unchanged: 0, fullPages: 0, errors: 0 }]));
  let polling = true;
  const pollers = POLL_INTERVALS.map((interval, i) => (async () => {
    const token = pollUsers[i].token;
    const client = `poll${interval / 1000}s`;
    const seen = new Set();
    let previous = '';
    await sleep(Math.random() * interval); // random phase
    while (polling) {
      const started = now();
      const s = pollStats[interval];
      try {
        const list = await api('GET', `/hazards/nearby?lat=${spot.lat}&lon=${spot.lon}&radiusMeters=1000&limit=${POLL_LIMIT}`, undefined, token);
        const at = now();
        s.requests++;
        if (list.length >= POLL_LIMIT) s.fullPages++;
        const ids = list.map((h) => h.id).sort().join(',');
        if (ids === previous) s.unchanged++;
        previous = ids;
        for (const h of list) {
          if (!seen.has(h.id)) { seen.add(h.id); observations.push({ client, hazardId: h.id, at }); }
        }
      } catch { s.errors++; }
      await sleep(Math.max(0, interval - (now() - started)));
    }
  })());

  const submissions = []; // { submissionId, sentAt, hazardId, status }
  for (let i = 0; i < EVENTS; i++) {
    // Points 45 m apart on a grid, so none fall inside the 30 m dedup radius of another
    // (a merge would correctly produce no hazard_created frame and skew the sample).
    const east = ((i % 10) - 5) * 45, north = (Math.floor(i / 10) - 2) * 45;
    const point = {
      lat: +(spot.lat + north / 111320).toFixed(7),
      lon: +(spot.lon + east / (111320 * Math.cos((spot.lat * Math.PI) / 180))).toFixed(7),
    };
    const sentAt = now();
    const s = await api('POST', '/hazard-submissions', { type: 'OPEN_MANHOLE', latitude: point.lat, longitude: point.lon }, reporter.token);
    submissions.push({ submissionId: s.submissionId, sentAt, hazardId: null, status: 'QUEUED' });
    await sleep(GAP_MS * (0.5 + Math.random()));
  }
  await sleep(Math.max(...POLL_INTERVALS) + 3000); // let the slowest poller catch the last hazard
  polling = false;
  await Promise.all(pollers);
  ws.close();

  // Resolve each submission's hazard id from its own outcome.
  for (const s of submissions) {
    const r = await api('GET', `/hazard-submissions/${s.submissionId}`, undefined, reporter.token).catch(() => null);
    s.status = r?.status ?? 'UNKNOWN';
    s.hazardId = r?.status === 'CREATED' ? r.hazardId : null;
  }

  const clients = ['websocket', ...POLL_INTERVALS.map((p) => `poll${p / 1000}s`)];
  const detections = correlateDetections({ submissions, observations, clients });
  const summary = {
    scenario: 'event_driven_vs_polling', at: new Date().toISOString(), revision: sourceRevision(),
    config: { events: EVENTS, meanGapMs: GAP_MS, pollIntervalsMs: POLL_INTERVALS },
    submissions: { sent: submissions.length, created: detections.resolvedSubmissions,
                   notCreated: detections.unresolvedSubmissions },
    websocket: detections.clients.websocket,
    polling: Object.fromEntries(POLL_INTERVALS.map((p) => [`${p / 1000}s`, {
      ...detections.clients[`poll${p / 1000}s`],
      httpRequests: pollStats[p].requests,
      unchangedResponses: pollStats[p].unchanged,
      wastedRequestRatio: +(pollStats[p].unchanged / Math.max(1, pollStats[p].requests)).toFixed(3),
      fullPages: pollStats[p].fullPages, // > 0: some responses hit the cap and may have hidden hazards
      pollErrors: pollStats[p].errors,
    }])),
    raw: { submissions, observations },
  };
  const file = new URL(`../results/latency-compare-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  const { raw, ...printable } = summary;
  console.log(JSON.stringify(printable, null, 2));
  console.log(`Saved ${file.pathname}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
