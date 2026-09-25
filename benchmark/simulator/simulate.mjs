#!/usr/bin/env node
// SafeRoute synthetic event generator (paper methodology). Metric definitions: docs/METRICS.md.
//
//   node simulate.mjs <scenario> [--rate N] [--duration S] [--users N]
//
// Scenarios: normal | rush_hour | severe_weather | duplicate_burst | failure_recovery
// Writes a JSON summary to ../results/.
import { writeFileSync } from 'node:fs';
import { api, createUsers, login, randomPoint, pick, TYPES, sleep, now, prometheus, CENTER } from './lib.mjs';
import { summarizeRun, workloadMix, sourceRevision } from './analysis.mjs';

const args = Object.fromEntries(process.argv.slice(3).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const scenario = process.argv[2] ?? 'normal';
const PRESETS = {
  normal:           { rate: 1,  duration: 30, users: 20, verifyRatio: 0.3, radius: 3000 },
  rush_hour:        { rate: 10, duration: 60, users: 100, verifyRatio: 0.4, radius: 3000 },
  severe_weather:   { rate: 50, duration: 20, users: 200, verifyRatio: 0.2, radius: 3000, types: ['FLOODING'] },
  duplicate_burst:  { rate: 20, duration: 15, users: 100, verifyRatio: 0,   radius: 40, types: ['OPEN_MANHOLE'] },
  failure_recovery: { rate: 10, duration: 10, users: 50,  verifyRatio: 0,   radius: 3000, events: 100 },
};
const cfg = { ...PRESETS[scenario], ...(args.rate && { rate: +args.rate }), ...(args.duration && { duration: +args.duration }), ...(args.users && { users: +args.users }) };
if (!PRESETS[scenario]) { console.error(`Unknown scenario ${scenario}`); process.exit(1); }

const MODERATOR = process.env.SAFEROUTE_MODERATOR_EMAIL ?? 'mod@saferoute.local';
const LISTENER = 'hazard-reported-processor';

async function main() {
  console.log(`[${scenario}]`, cfg);
  const before = await prometheus();
  const users = await createUsers(cfg.users, scenario);
  const submissions = [];
  const knownHazards = [];
  const reports = { offered: 0, accepted: 0, httpErrors: 0 };
  const confirmations = { offered: 0, accepted: 0, httpErrors: 0, rejectedSelf: 0 };
  const errors = [];
  let moderatorToken;

  // Confirmations need hazards to confirm. Seed some before the measured run so the configured
  // mix is actually offered from the first event (seed reports are not part of the workload).
  if (cfg.verifyRatio > 0) {
    const seedCount = Math.min(20, users.length);
    console.log(`Seeding ${seedCount} hazards for confirmations…`);
    const seeds = [];
    for (let i = 0; i < seedCount; i++) {
      const p = randomPoint(CENTER, cfg.radius);
      const s = await api('POST', '/hazard-submissions', { type: pick(cfg.types ?? TYPES), latitude: p.lat, longitude: p.lon }, users[i].token);
      seeds.push({ id: s.submissionId, token: users[i].token });
    }
    for (const s of seeds) {
      const r = await awaitTerminal(s, 30_000);
      if (r?.hazardId) knownHazards.push(r.hazardId);
    }
    if (!knownHazards.length) throw new Error('Seeding produced no hazards; is the processing consumer running?');
  }

  if (scenario === 'failure_recovery') {
    moderatorToken = await moderator();
    await api('POST', `/admin/consumers/${LISTENER}/stop`, undefined, moderatorToken);
    console.log('Hazard Processing consumer STOPPED; publishing while it is down…');
  }

  const total = cfg.events ?? cfg.rate * cfg.duration;
  const interval = 1000 / cfg.rate;
  const t0 = now();
  const inflight = [];
  for (let i = 0; i < total; i++) {
    const due = t0 + i * interval;
    const wait = due - now();
    if (wait > 0) await sleep(wait);
    const user = users[i % users.length];
    const verify = knownHazards.length > 0 && Math.random() < cfg.verifyRatio;
    if (verify) confirmations.offered++; else reports.offered++;
    inflight.push((async () => {
      if (verify) {
        const other = users[(i + 1 + Math.floor(Math.random() * (users.length - 1))) % users.length];
        try {
          await api('PUT', `/hazards/${pick(knownHazards)}/confirmation`, { action: Math.random() < 0.8 ? 'VERIFY' : 'DISPUTE' }, other.token);
          confirmations.accepted++;
        } catch (e) {
          if (e.status === 409) confirmations.rejectedSelf++; // own report or inactive hazard: expected, not an error
          else { confirmations.httpErrors++; errors.push(e.message); }
        }
        return;
      }
      const p = randomPoint(CENTER, cfg.radius);
      const sentAt = now();
      try {
        const s = await api('POST', '/hazard-submissions', { type: pick(cfg.types ?? TYPES), latitude: p.lat, longitude: p.lon }, user.token);
        reports.accepted++;
        submissions.push({ id: s.submissionId, token: user.token, sentAt });
      } catch (e) { reports.httpErrors++; errors.push(e.message); }
    })());
  }
  await Promise.all(inflight);
  const publishSeconds = (now() - t0) / 1000;
  const mix = workloadMix({ reportsOffered: reports.offered, confirmationsOffered: confirmations.offered,
                            expectedConfirmationShare: cfg.verifyRatio });
  if (!mix.withinTolerance) console.warn('WARNING: achieved workload mix differs from the configuration', mix);

  let restartedAt;
  if (scenario === 'failure_recovery') {
    await sleep(3000);
    const stuck = await countStatus(submissions, 'QUEUED');
    console.log(`While stopped: ${stuck}/${submissions.length} submissions still QUEUED (retained)`);
    restartedAt = now();
    await api('POST', `/admin/consumers/${LISTENER}/start`, undefined, moderatorToken);
    console.log('Consumer RESTARTED; waiting for backlog to drain…');
  }

  // Poll every accepted submission to an outcome; the server's processedAt gives processing latency.
  const deadline = now() + 120_000;
  const final = new Map();
  while (final.size < submissions.length && now() < deadline) {
    await Promise.all(submissions.filter((s) => !final.has(s.id)).map(async (s) => {
      try {
        const r = await api('GET', `/hazard-submissions/${s.id}`, undefined, s.token);
        if (r.status !== 'QUEUED') final.set(s.id, { ...r, observedAt: now() });
      } catch { /* retry next round */ }
    }));
    if (final.size < submissions.length) await sleep(250);
  }
  const drainedAt = now();

  const outcomes = [...final.values()];
  const after = await prometheus();
  const summary = {
    scenario, config: cfg, at: new Date().toISOString(), revision: sourceRevision(),
    environment: { node: process.version, platform: `${process.platform}-${process.arch}`, target: process.env.SAFEROUTE_URL ?? 'http://localhost:8080' },
    workloadMix: mix,
    ...summarizeRun({ reports, confirmations, outcomes, elapsedSeconds: (drainedAt - t0) / 1000 }),
    publishSeconds: +publishSeconds.toFixed(2),
    ...(restartedAt && { recoverySeconds: +((drainedAt - restartedAt) / 1000).toFixed(2) }),
    serverMetricsDelta: {
      created: after.created - before.created, merged: after.merged - before.merged,
      failed: after.failed - before.failed, consumerErrors: after.consumerErrors - before.consumerErrors,
    },
    serverProcessingLatencySeconds: { p50: after.processingP50, p95: after.processingP95, p99: after.processingP99 },
    sampleErrors: [...new Set(errors)].slice(0, 5),
    // Raw per-submission observations, so the numbers above can be recomputed and audited.
    raw: submissions.map((s) => {
      const r = final.get(s.id);
      return { submissionId: s.id, status: r?.status ?? 'UNRESOLVED', hazardId: r?.hazardId ?? null,
               createdAt: r?.createdAt ?? null, processedAt: r?.processedAt ?? null };
    }),
  };
  const file = new URL(`../results/${scenario}-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  const { raw, ...printable } = summary;
  console.log(JSON.stringify(printable, null, 2));
  console.log(`Saved ${file.pathname}`);
}

async function awaitTerminal(s, timeoutMs) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const r = await api('GET', `/hazard-submissions/${s.id}`, undefined, s.token).catch(() => null);
    if (r && r.status !== 'QUEUED') return r;
    await sleep(250);
  }
  return null;
}

async function countStatus(subs, status) {
  let n = 0;
  for (const s of subs) if ((await api('GET', `/hazard-submissions/${s.id}`, undefined, s.token)).status === status) n++;
  return n;
}

async function moderator() {
  try { return await login(MODERATOR); } catch {
    await api('POST', '/auth/register', { email: MODERATOR, password: 'password123', displayName: 'Moderator' });
    throw new Error(`Registered ${MODERATOR}; restart the backend with SAFEROUTE_MODERATOR_EMAILS=${MODERATOR} so it is promoted, then re-run.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
