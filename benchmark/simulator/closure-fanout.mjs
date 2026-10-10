#!/usr/bin/env node
// Road-closure fan-out: how fast a staff member's closure reaches commuters' phones, and that it
// reaches only the commuters it should.
//
//   node closure-fanout.mjs [--closures 20] [--near 50] [--far 20] [--gap 500]
//
// A moderator blocks a short road, then lifts it, `--closures` times. `--near` commuter sockets sit
// within ~150 m of the road and `--far` sit ~11 km away. Every closure_changed frame is timestamped
// on arrival; latency = arrival − the moment before the HTTP call, on this process's clock (no skew
// correction). Delivery is checked both ways: every near socket should get each CREATED and LIFTED
// frame exactly once, and no far socket should get any. Requires mod@saferoute.local (see README).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, createUsers, login, openSocket, sleep, now, stats, CENTER } from './lib.mjs';
import { sourceRevision } from './analysis.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const CLOSURES = opt('closures', 20);
const NEAR = opt('near', 50);
const FAR = opt('far', 20);
const GAP_MS = opt('gap', 500);
const METERS_PER_DEG_LAT = 111320;

const offset = (p, northM, eastM) => ({
  lat: p.lat + northM / METERS_PER_DEG_LAT,
  lon: p.lon + eastM / (METERS_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
});

async function main() {
  const mod = await login('mod@saferoute.local');
  // A unique neighbourhood per run so earlier runs' closures never count.
  const spot = { lat: CENTER.lat + (Math.random() - 0.5) * 0.04, lon: CENTER.lon + (Math.random() - 0.5) * 0.04 };
  const users = await createUsers(NEAR + FAR, 'closure');

  const received = []; // { group, socket, closureId, change, at }
  const sockets = [];
  for (let i = 0; i < NEAR + FAR; i++) {
    const group = i < NEAR ? 'near' : 'far';
    const at = group === 'near' ? offset(spot, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300) : offset(spot, 11_000, 0);
    const ws = await openSocket(users[i].token, at);
    ws.listeners.push((f) => {
      if (f.type === 'closure_changed') received.push({ group, socket: i, closureId: f.closureId, change: f.change, at: f._receivedAt });
    });
    sockets.push(ws);
  }

  const sent = []; // { closureId, change, sentAt }
  const httpMs = { create: [], lift: [] };
  for (let k = 0; k < CLOSURES; k++) {
    // Each closure 60 m east of the last, 40 m long, so they never overlap.
    const a = offset(spot, 0, k * 60), b = offset(spot, 40, k * 60);
    const createdAt = now();
    const c = await api('POST', '/closures', {
      name: `Bench closure ${k}`, reason: 'Closure fan-out benchmark', category: 'CONSTRUCTION',
      coordinates: [[+a.lat.toFixed(7), +a.lon.toFixed(7)], [+b.lat.toFixed(7), +b.lon.toFixed(7)]],
    }, mod);
    httpMs.create.push(now() - createdAt);
    sent.push({ closureId: c.id, change: 'CREATED', sentAt: createdAt });
    await sleep(GAP_MS);

    const liftedAt = now();
    await api('DELETE', `/closures/${c.id}?reason=benchmark`, undefined, mod);
    httpMs.lift.push(now() - liftedAt);
    sent.push({ closureId: c.id, change: 'LIFTED', sentAt: liftedAt });
    await sleep(GAP_MS);
  }
  await sleep(3000); // let the last frames land
  sockets.forEach((ws) => ws.close());

  // Latency per delivered near frame; duplicates and strays are counted, not averaged in.
  const latencies = { CREATED: [], LIFTED: [] };
  let duplicates = 0;
  const seen = new Set();
  const bySent = new Map(sent.map((s) => [`${s.closureId}:${s.change}`, s]));
  for (const r of received.filter((x) => x.group === 'near')) {
    const key = `${r.socket}:${r.closureId}:${r.change}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const s = bySent.get(`${r.closureId}:${r.change}`);
    if (s && latencies[r.change]) latencies[r.change].push(r.at - s.sentAt);
  }
  const expectedPerChange = CLOSURES * NEAR;
  const summary = {
    scenario: 'closure_fanout', at: new Date().toISOString(), revision: sourceRevision(),
    config: { closures: CLOSURES, nearSockets: NEAR, farSockets: FAR, gapMs: GAP_MS },
    delivery: {
      expectedPerChange,
      createdDelivered: latencies.CREATED.length, liftedDelivered: latencies.LIFTED.length,
      missed: 2 * expectedPerChange - latencies.CREATED.length - latencies.LIFTED.length,
      duplicates,
      farSocketFrames: received.filter((x) => x.group === 'far').length, // must be 0
    },
    latencyMs: { created: stats(latencies.CREATED), lifted: stats(latencies.LIFTED) },
    httpMs: { create: stats(httpMs.create), lift: stats(httpMs.lift) },
    raw: { sent, received },
  };
  const file = new URL(`../results/closure-fanout-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  const { raw, ...printable } = summary;
  console.log(JSON.stringify(printable, null, 2));
  console.log(`Saved ${fileURLToPath(file)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
