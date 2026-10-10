#!/usr/bin/env node
// Archive job under load: how long unreviewed hazards wait past their deadline before
// HazardArchiveService archives them, how fast it works through a backlog, and whether commuters'
// reads slow down while it runs.
//
//   SAFEROUTE_HAZARD_ARCHIVE_AFTER=PT60S SAFEROUTE_HAZARD_ARCHIVE_CHECK_INTERVAL=PT5S  (backend env)
//   node archive-job.mjs --after 60 [--hazards 400] [--rate 20] [--probe-ms 200]
//
// `--after` must match the backend's archive-after in seconds (the real default is 7 days). The job
// takes at most 200 hazards per run, so --hazards above 200 exercises a multi-run backlog.
// Hazards are created through the API, 45 m apart so none merge. Archive times come from the
// benchmark database (archived_at), read with docker exec; DB_NAME defaults to saferoute_bench.
// Commuter-read latency is probed with GET /hazards/nearby throughout and split into phases:
//   baseline  : before any load, system idle
//   creating  : while reports are being submitted
//   archiving : from the first to the last archived_at of this run's hazards
//   after     : once the backlog is cleared
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, createUsers, sleep, now, stats, CENTER } from './lib.mjs';
import { sourceRevision } from './analysis.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const AFTER_S = opt('after', NaN);
const HAZARDS = opt('hazards', 400);
const RATE = opt('rate', 20);
const PROBE_MS = opt('probe-ms', 200);
const DB = process.env.DB_NAME ?? 'saferoute_bench';
if (!Number.isFinite(AFTER_S)) throw new Error('Pass --after <seconds> matching the backend\'s archive-after.');

const sql = (q) => execFileSync('docker', ['exec', 'saferoute-postgres', 'psql', '-U', 'saferoute', '-d', DB, '-tA', '-F', '|', '-c', q],
  { encoding: 'utf8' }).trim();

async function main() {
  const [probeUser, ...reporters] = await createUsers(6, 'archive');
  const spot = { lat: CENTER.lat + (Math.random() - 0.5) * 0.06, lon: CENTER.lon + (Math.random() - 0.5) * 0.06 };
  const probes = []; // { at, ms, ok }
  let probing = true;
  const prober = (async () => {
    while (probing) {
      const started = now();
      let ok = true;
      try { await api('GET', `/hazards/nearby?lat=${spot.lat}&lon=${spot.lon}&radiusMeters=1000&limit=250`, undefined, probeUser.token); }
      catch { ok = false; }
      probes.push({ at: started, ms: now() - started, ok });
      await sleep(Math.max(0, PROBE_MS - (now() - started)));
    }
  })();

  console.error('Baseline (10 s idle)…');
  await sleep(10_000);

  const runStartedAt = new Date();
  const creatingFrom = now();
  const submissions = [];
  const gridSide = Math.ceil(Math.sqrt(HAZARDS));
  const interval = 1000 / RATE;
  for (let i = 0; i < HAZARDS; i++) {
    const east = ((i % gridSide) - gridSide / 2) * 45, north = (Math.floor(i / gridSide) - gridSide / 2) * 45;
    const body = {
      type: 'OPEN_MANHOLE',
      latitude: +(spot.lat + north / 111320).toFixed(7),
      longitude: +(spot.lon + east / (111320 * Math.cos((spot.lat * Math.PI) / 180))).toFixed(7),
    };
    const target = creatingFrom + i * interval;
    await sleep(Math.max(0, target - now()));
    submissions.push(api('POST', '/hazard-submissions', body, reporters[i % reporters.length].token).catch(() => null));
  }
  await Promise.all(submissions);
  const creatingTo = now();
  console.error(`Submitted ${HAZARDS}; waiting for the archive job (up to ${AFTER_S + 180} s)…`);

  // This run's hazards: created in its box since it started. Wait until the count stops growing.
  const box = `ST_Intersects(location::geometry, ST_MakeEnvelope(${spot.lon - 0.02}, ${spot.lat - 0.02}, ${spot.lon + 0.02}, ${spot.lat + 0.02}, 4326))`;
  const mine = `${box} AND created_at >= '${runStartedAt.toISOString()}'`;
  const deadline = now() + (AFTER_S + 180) * 1000;
  let created = 0, archivedCount = 0;
  while (now() < deadline) {
    [created, archivedCount] = sql(`SELECT count(*), count(archived_at) FROM hazards WHERE ${mine}`).split('|').map(Number);
    if (created > 0 && archivedCount === created) break;
    await sleep(2000);
  }
  await sleep(5000); // a few "after" probes
  probing = false;
  await prober;

  const rows = sql(`SELECT extract(epoch FROM archived_at)*1000, extract(epoch FROM created_at)*1000 FROM hazards WHERE ${mine} AND archived_at IS NOT NULL ORDER BY archived_at`)
    .split('\n').filter(Boolean).map((l) => l.split('|').map(Number));
  const lags = rows.map(([archivedMs, createdMs]) => archivedMs - (createdMs + AFTER_S * 1000)); // wait past the deadline
  const firstArchived = rows.length ? rows[0][0] : null, lastArchived = rows.length ? rows[rows.length - 1][0] : null;
  const spanSeconds = rows.length > 1 ? (lastArchived - firstArchived) / 1000 : null;

  const phase = (p) => {
    if (p.at < creatingFrom) return 'baseline';
    if (firstArchived != null && p.at >= firstArchived && p.at <= lastArchived) return 'archiving';
    if (p.at <= creatingTo) return 'creating';
    return lastArchived != null && p.at > lastArchived ? 'after' : 'creating';
  };
  const byPhase = {};
  for (const p of probes) (byPhase[phase(p)] ??= []).push(p);
  const probeStats = Object.fromEntries(Object.entries(byPhase).map(([name, ps]) =>
    [name, { ...stats(ps.filter((p) => p.ok).map((p) => p.ms)), errors: ps.filter((p) => !p.ok).length }]));

  const summary = {
    scenario: 'archive_job', at: new Date().toISOString(), revision: sourceRevision(),
    config: { hazards: HAZARDS, ratePerSecond: RATE, archiveAfterSeconds: AFTER_S, probeMs: PROBE_MS, batchSize: 200 },
    hazards: { created, archived: archivedCount, notArchived: created - archivedCount },
    // How long after its deadline each hazard was archived: bounded by the check interval plus time spent behind the batch limit.
    archiveLagMs: stats(lags),
    archiveSpanSeconds: spanSeconds,
    archiveThroughputPerSecond: spanSeconds ? +(rows.length / spanSeconds).toFixed(1) : null,
    commuterReadLatencyMs: probeStats,
    raw: { probes },
  };
  const file = new URL(`../results/archive-job-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  const { raw, ...printable } = summary;
  console.log(JSON.stringify(printable, null, 2));
  console.log(`Saved ${fileURLToPath(file)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
