#!/usr/bin/env node
// WebSocket scalability: thousands of concurrent subscribers, fan-out latency, memory/CPU per
// connection, optionally across several backend instances.
//
//   ulimit -n 65536   # macOS default is 256; each socket is one file descriptor on BOTH ends
//   node ws-scale.mjs [--steps 1000,2500,5000,10000] [--events 10] [--gap 1500]
//                     [--targets http://localhost:8080,http://localhost:8081] [--pids 1234,5678]
//
// For each step the tool grows the pool of open, subscribed sockets to that size, then submits
// --events hazards (one reporter, 45 m apart, so each is a new hazard_created) and records for
// every socket when the frame arrived. Reported per step:
//   - fan-out latency pooled over all (socket, event) pairs: avg/median/p95/p99/max, and the
//     time until the LAST subscriber received each event (the real fan-out completion time);
//   - delivery ratio (frames received / frames expected: every socket is inside the 5 km map-update
//     radius, so each should get every event);
//   - server cost: heap and process CPU from /actuator/prometheus, and resident memory per
//     connection from `ps` when --pids is given (heap alone hides native buffers).
// Sockets are spread round-robin over --targets (several instances behind one port also works:
// give the load balancer once). The load generator shares one machine with the server unless you
// point --targets elsewhere; its own CPU is reported so you can tell when IT is the bottleneck.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { api, createUsers, randomPoint, sleep, now, stats, CENTER } from './lib.mjs';
import { sourceRevision } from './analysis.mjs';

const argv = process.argv.slice(2);
const str = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const STEPS = str('steps', '1000,2500,5000').split(',').map(Number);
const EVENTS = Number(str('events', 10));
const GAP_MS = Number(str('gap', 1500));
const TARGETS = str('targets', process.env.SAFEROUTE_URL ?? 'http://localhost:8080').split(',');
const PIDS = str('pids', '').split(',').filter(Boolean).map(Number);
const SPREAD_M = Number(str('spread', 3000));
const CONNECT_CONCURRENCY = 50;
const failureReasons = new Map();
const noteFailure = (e) => failureReasons.set(e.message, (failureReasons.get(e.message) ?? 0) + 1);
async function connectWithRetry(target, token, point) {
  for (let attempt = 0; ; attempt++) {
    try { return await connect(target, token, point); }
    catch (e) { noteFailure(e); if (attempt >= 2) return null; await sleep(200 * (attempt + 1)); }
  }
}
const USERS = 40; // sockets share a pool of users; registration is rate limited per IP

const sockets = [];
const frames = new Map(); // hazardId -> array of receive timestamps
let totalFrames = 0;

function connect(target, token, point) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.replace(/^http/, 'ws') + '/ws/notifications', { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 15000);
    ws.onmessage = (e) => {
      const at = now();
      if (typeof e.data !== 'string' || !e.data.includes('"hazard_created"')) return;
      const f = JSON.parse(e.data);
      if (f.type !== 'hazard_created') return;
      let a = frames.get(f.hazardId);
      if (!a) frames.set(f.hazardId, (a = []));
      a.push(at);
      totalFrames++;
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(e?.message || e?.error?.message || 'ws error')); };
    ws.onopen = () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'subscribe', lat: point.lat, lon: point.lon }));
      resolve(ws);
    };
  });
}

async function growTo(n, tokens) {
  let failures = 0;
  while (sockets.length < n) {
    const batch = [];
    for (let i = 0; i < CONNECT_CONCURRENCY && sockets.length + batch.length < n; i++) {
      const k = sockets.length + batch.length;
      batch.push(connectWithRetry(TARGETS[k % TARGETS.length], tokens[k % tokens.length], randomPoint(CENTER, SPREAD_M)).then((ws) => { if (!ws) failures++; return ws; }));
    }
    const done = await Promise.all(batch);
    for (const ws of done) if (ws) sockets.push(ws);
    if (failures > 50) throw new Error(`Too many connection failures (${failures}); reasons: ${JSON.stringify([...failureReasons])}. Raise ulimit -n or check the server`);
  }
  await sleep(1500); // let the server apply the last subscribe frames
  return failures;
}

async function prom(target) {
  const text = await (await fetch(target + '/actuator/prometheus')).text();
  const sum = (re) => [...text.matchAll(re)].reduce((s, m) => s + Number(m[1]), 0);
  const one = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    heapBytes: sum(/^jvm_memory_used_bytes\{[^}]*area="heap"[^}]*\}\s+(\S+)/gm),
    cpu: one(/^process_cpu_usage\s+(\S+)/m),
    activeSessions: one(/^saferoute_websocket_active_sessions\s+(\S+)/m),
    threads: one(/^jvm_threads_live_threads\s+(\S+)/m),
  };
}
const rssKb = () => PIDS.map((p) => { try { return Number(execSync(`ps -o rss= -p ${p}`).toString().trim()); } catch { return null; } });
const sumNum = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0);

async function serverSnapshot() {
  const per = await Promise.all(TARGETS.map(prom));
  return { heapBytes: sumNum(per.map((p) => p.heapBytes)), cpuPerInstance: per.map((p) => p.cpu), sessions: sumNum(per.map((p) => p.activeSessions)),
           threads: sumNum(per.map((p) => p.threads)), rssBytes: PIDS.length ? sumNum(rssKb()) * 1024 : null };
}

async function main() {
  const users = await createUsers(USERS, 'wsscale');
  const [reporter] = await createUsers(1, 'wsscale-rep');
  const tokens = users.map((u) => u.token);
  const results = [];
  const baseline = await serverSnapshot();
  const cpuCount = os.cpus().length;
  let prevIdle = baseline, prevConnections = 0;

  for (const step of STEPS) {
    const before = await serverSnapshot();
    const t0 = now();
    const connectFailures = await growTo(step, tokens);
    const connectSeconds = (now() - t0) / 1000;
    const idle = await serverSnapshot();

    // Fan-out: sample server CPU while the events are in flight.
    const cpuSamples = [];
    let sampling = true;
    const sampler = (async () => { while (sampling) { const s = await serverSnapshot().catch(() => null); if (s) cpuSamples.push(Math.max(...s.cpuPerInstance.filter((x) => x != null))); await sleep(250); } })();
    const submissions = [];
    for (let i = 0; i < EVENTS; i++) {
      // Random spot inside the subscribers' area each time: fixed coordinates would merge with the
      // hazards of earlier steps/runs (30 m dedup) and produce no hazard_created frame.
      const point = randomPoint(CENTER, SPREAD_M);
      point.lat = +point.lat.toFixed(7); point.lon = +point.lon.toFixed(7);
      const sentAt = now();
      const s = await api('POST', '/hazard-submissions', { type: 'OPEN_MANHOLE', latitude: point.lat, longitude: point.lon }, reporter.token);
      submissions.push({ submissionId: s.submissionId, sentAt, hazardId: null });
      await sleep(GAP_MS);
    }
    await sleep(3000);
    sampling = false;
    await sampler;

    const latencies = [], lastReceive = [];
    let expected = 0, received = 0, created = 0;
    for (const s of submissions) {
      const r = await api('GET', `/hazard-submissions/${s.submissionId}`, undefined, reporter.token).catch(() => null);
      if (r?.status !== 'CREATED') continue;
      created++;
      const arr = frames.get(r.hazardId) ?? [];
      expected += sockets.length;
      received += arr.length;
      for (const at of arr) latencies.push(at - s.sentAt);
      if (arr.length) lastReceive.push(Math.max(...arr) - s.sentAt);
    }
    frames.clear(); totalFrames = 0;
    const after = await serverSnapshot();
    const marginalRss = prevIdle?.rssBytes != null && idle.rssBytes != null && sockets.length > prevConnections
      ? Math.round((idle.rssBytes - prevIdle.rssBytes) / (sockets.length - prevConnections)) : null;
    prevIdle = idle; prevConnections = sockets.length;
    const rssPerConn = idle.rssBytes != null && baseline.rssBytes != null ? (idle.rssBytes - baseline.rssBytes) / sockets.length : null;
    const row = {
      connections: sockets.length, targets: TARGETS.length, connectFailures, connectSeconds: +connectSeconds.toFixed(1),
      serverSessions: idle.sessions, eventsSent: submissions.length, eventsCreated: created,
      connectFailureReasons: Object.fromEntries(failureReasons),
      deliveryRatio: expected ? +(received / expected).toFixed(4) : null,
      fanoutLatencyMs: stats(latencies), lastSubscriberLatencyMs: stats(lastReceive),
      server: {
        heapMBIdle: +(idle.heapBytes / 1048576).toFixed(0),
        rssMBIdle: idle.rssBytes != null ? +(idle.rssBytes / 1048576).toFixed(0) : null,
        rssBytesPerConnection: rssPerConn != null ? Math.round(rssPerConn) : null, // vs. empty-server baseline
        rssMarginalBytesPerConnection: marginalRss,
        threads: idle.threads,
        cpuIdle: idle.cpuPerInstance, cpuDuringFanoutPeak: cpuSamples.length ? +Math.max(...cpuSamples).toFixed(3) : null,
        cpuDuringFanoutMean: cpuSamples.length ? +(cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length).toFixed(3) : null,
      },
      loadGenerator: { loadAvg1m: +os.loadavg()[0].toFixed(2), cpuCount, rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0) },
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  sockets.forEach((w) => { try { w.close(); } catch { /* already closed */ } });
  const out = { scenario: 'ws_scale', at: new Date().toISOString(), revision: sourceRevision(),
                config: { steps: STEPS, events: EVENTS, gapMs: GAP_MS, targets: TARGETS, spreadMeters: SPREAD_M }, baseline, results };
  const file = new URL(`../results/ws-scale-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Saved ${fileURLToPath(file)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
