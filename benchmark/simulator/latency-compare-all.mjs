#!/usr/bin/env node
// Delivery-mechanism comparison with MANY clients per mechanism:
//   WebSocket push | Server-Sent Events | long polling | plain polling 1 s/3 s | ETag polling 1 s/3 s
//
//   node latency-compare-all.mjs [--clients 20] [--events 30] [--gap 2000]
//
// Extends latency-compare.mjs (one client per mechanism) for the reviewer's concern that a single
// WebSocket client says nothing about concurrent subscribers. Every client records its own first
// sighting of each hazard id; latency = first sighting - submit time on this process's clock.
// Per mechanism it also reports server-side cost proxies: HTTP requests and response bytes in total,
// per client, and the share of conditional requests answered 304. All clients of a mechanism pool
// their latencies. Raw observations are saved next to the summary.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE, api, createUsers, openSocket, sleep, now, stats, CENTER } from './lib.mjs';
import { sourceRevision } from './analysis.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const CLIENTS = opt('clients', 20);
const EVENTS = opt('events', 30);
const GAP_MS = opt('gap', 2000);
const LIMIT = 250;

const MECHANISMS = ['websocket', 'sse', 'longpoll', 'poll-1s', 'poll-3s', 'etag-1s', 'etag-3s'];
const cost = Object.fromEntries(MECHANISMS.map((m) => [m, { requests: 0, bytes: 0, notModified: 0, errors: 0 }]));
const observations = []; // { mechanism, client, hazardId, at }
let running = true;

const seenBy = (mechanism, client) => (hazardId) => observations.push({ mechanism, client, hazardId, at: now() });

async function pollLoop(mechanism, client, token, spot, intervalMs, conditional) {
  const url = `${BASE}/api/hazards/nearby?lat=${spot.lat}&lon=${spot.lon}&radiusMeters=1000&limit=${LIMIT}`;
  const record = seenBy(mechanism, client);
  const seen = new Set();
  let etag = null;
  await sleep(Math.random() * intervalMs);
  while (running) {
    const started = now();
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...(conditional && etag ? { 'If-None-Match': etag } : {}) } });
      const text = await res.text();
      const at = now();
      cost[mechanism].requests++;
      cost[mechanism].bytes += text.length;
      if (res.status === 304) cost[mechanism].notModified++;
      else if (res.ok) {
        etag = res.headers.get('etag');
        for (const h of JSON.parse(text)) if (!seen.has(h.id)) { seen.add(h.id); observations.push({ mechanism, client, hazardId: h.id, at }); }
      } else cost[mechanism].errors++;
    } catch { cost[mechanism].errors++; }
    await sleep(Math.max(0, intervalMs - (now() - started)));
  }
}

async function longPollLoop(client, token, spot) {
  const record = seenBy('longpoll', client);
  const q = `lat=${spot.lat}&lon=${spot.lon}&radiusMeters=1000`;
  const get = async (since) => {
    const res = await fetch(`${BASE}/api/hazards/poll?${q}${since ? `&since=${since}` : ''}&holdSeconds=25`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    cost.longpoll.requests++;
    cost.longpoll.bytes += text.length;
    if (!res.ok) throw new Error(String(res.status));
    return JSON.parse(text);
  };
  let cursor = (await get(null)).cursor;
  while (running) {
    try {
      const r = await get(cursor);
      cursor = r.cursor;
      for (const c of r.changes) if (c.frame.type === 'hazard_created') record(c.frame.hazardId);
    } catch { cost.longpoll.errors++; await sleep(200); }
  }
}

async function sseLoop(client, token, spot, controller) {
  const record = seenBy('sse', client);
  try {
    const res = await fetch(`${BASE}/api/hazards/stream?lat=${spot.lat}&lon=${spot.lon}&radiusMeters=1000`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: controller.signal });
    cost.sse.requests++;
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      const text = decoder.decode(chunk, { stream: true });
      cost.sse.bytes += chunk.length;
      buf += text;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data:'));
        if (data) { const f = JSON.parse(data.slice(5)); if (f.type === 'hazard_created') record(f.hazardId); }
      }
    }
  } catch { if (running) cost.sse.errors++; }
}

async function main() {
  if (EVENTS > 200) throw new Error('Use at most 200 events per run: the nearby query returns at most 250 hazards.');
  const [reporter, ...users] = await createUsers(1 + MECHANISMS.length, 'cmpall');
  const token = Object.fromEntries(MECHANISMS.map((m, i) => [m, users[i].token]));
  const spot = { lat: CENTER.lat + (Math.random() - 0.5) * 0.08, lon: CENTER.lon + (Math.random() - 0.5) * 0.08 };
  const sseController = new AbortController();
  const loops = [];
  const sockets = [];

  for (let c = 0; c < CLIENTS; c++) {
    const ws = await openSocket(token.websocket, spot);
    const record = seenBy('websocket', c);
    ws.listeners.push((f) => { if (f.type === 'hazard_created') record(f.hazardId); });
    sockets.push(ws);
    loops.push(sseLoop(c, token.sse, spot, sseController));
    loops.push(longPollLoop(c, token.longpoll, spot));
    loops.push(pollLoop('poll-1s', c, token['poll-1s'], spot, 1000, false));
    loops.push(pollLoop('poll-3s', c, token['poll-3s'], spot, 3000, false));
    loops.push(pollLoop('etag-1s', c, token['etag-1s'], spot, 1000, true));
    loops.push(pollLoop('etag-3s', c, token['etag-3s'], spot, 3000, true));
  }
  await sleep(1500); // let streams and long polls attach before the first report

  const submissions = [];
  for (let i = 0; i < EVENTS; i++) {
    // 45 m grid: outside the 30 m merge radius, so every report is a new hazard_created.
    const east = ((i % 10) - 5) * 45, north = (Math.floor(i / 10) - 2) * 45;
    const point = { lat: +(spot.lat + north / 111320).toFixed(7), lon: +(spot.lon + east / (111320 * Math.cos((spot.lat * Math.PI) / 180))).toFixed(7) };
    const sentAt = now();
    const s = await api('POST', '/hazard-submissions', { type: 'OPEN_MANHOLE', latitude: point.lat, longitude: point.lon }, reporter.token);
    submissions.push({ submissionId: s.submissionId, sentAt, hazardId: null });
    await sleep(GAP_MS * (0.5 + Math.random()));
  }
  await sleep(6000);
  running = false;
  sseController.abort();
  sockets.forEach((w) => w.close());
  await Promise.allSettled(loops);

  for (const s of submissions) {
    const r = await api('GET', `/hazard-submissions/${s.submissionId}`, undefined, reporter.token).catch(() => null);
    s.hazardId = r?.status === 'CREATED' ? r.hazardId : null;
  }
  const resolved = submissions.filter((s) => s.hazardId);
  const firstSeen = new Map();
  for (const o of observations) {
    const k = `${o.mechanism}|${o.client}|${o.hazardId}`;
    if (!firstSeen.has(k) || firstSeen.get(k) > o.at) firstSeen.set(k, o.at);
  }
  const summary = {
    scenario: 'delivery_mechanisms_many_clients', at: new Date().toISOString(), revision: sourceRevision(),
    config: { clientsPerMechanism: CLIENTS, events: EVENTS, meanGapMs: GAP_MS },
    submissions: { sent: submissions.length, created: resolved.length },
    mechanisms: Object.fromEntries(MECHANISMS.map((m) => {
      const lat = []; let missed = 0;
      for (let c = 0; c < CLIENTS; c++) for (const s of resolved) {
        const at = firstSeen.get(`${m}|${c}|${s.hazardId}`);
        if (at === undefined) missed++; else lat.push(at - s.sentAt);
      }
      const k = cost[m];
      return [m, {
        latencyMs: stats(lat), detected: lat.length, missed,
        httpRequests: k.requests, requestsPerClient: +(k.requests / CLIENTS).toFixed(1),
        responseBytes: k.bytes, bytesPerClient: Math.round(k.bytes / CLIENTS),
        notModifiedShare: k.requests ? +(k.notModified / k.requests).toFixed(3) : 0, errors: k.errors,
      }];
    })),
    raw: { submissions, observations },
  };
  const file = new URL(`../results/delivery-mechanisms-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  const { raw, ...printable } = summary;
  console.log(JSON.stringify(printable, null, 2));
  console.log(`Saved ${fileURLToPath(file)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
