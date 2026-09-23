#!/usr/bin/env node
// SafeRoute synthetic event generator (paper methodology; review §43).
//
//   node simulate.mjs <scenario> [--rate N] [--duration S] [--users N]
//
// Scenarios: normal | rush_hour | severe_weather | duplicate_burst | failure_recovery
// Writes a JSON summary to ../results/.
import { writeFileSync } from 'node:fs';
import { api, createUsers, login, randomPoint, pick, TYPES, sleep, now, prometheus, stats, CENTER } from './lib.mjs';

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
  const errors = [];
  const knownHazards = [];
  let moderatorToken;

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
    const verify = knownHazards.length && Math.random() < cfg.verifyRatio;
    inflight.push((async () => {
      try {
        if (verify) {
          const other = users[(i + 1 + Math.floor(Math.random() * (users.length - 1))) % users.length];
          await api('PUT', `/hazards/${pick(knownHazards)}/confirmation`, { action: Math.random() < 0.8 ? 'VERIFY' : 'DISPUTE' }, other.token)
            .catch((e) => { if (e.status !== 409) throw e; }); // 409 = self-confirmation, expected sometimes
        } else {
          const p = randomPoint(CENTER, cfg.radius);
          const sentAt = now();
          const s = await api('POST', '/hazard-submissions', { type: pick(cfg.types ?? TYPES), latitude: p.lat, longitude: p.lon }, user.token);
          submissions.push({ id: s.submissionId, token: user.token, sentAt });
        }
      } catch (e) { errors.push(e.message); }
    })());
  }
  await Promise.all(inflight);
  const publishSeconds = (now() - t0) / 1000;

  let restartedAt;
  if (scenario === 'failure_recovery') {
    await sleep(3000);
    const stuck = await countStatus(submissions, 'QUEUED');
    console.log(`While stopped: ${stuck}/${submissions.length} submissions still QUEUED (retained in Kafka)`);
    restartedAt = now();
    await api('POST', `/admin/consumers/${LISTENER}/start`, undefined, moderatorToken);
    console.log('Consumer RESTARTED; waiting for backlog to drain…');
  }

  // Poll every submission to a terminal state; the server's processedAt gives processing latency.
  const deadline = now() + 120_000;
  const final = new Map();
  while (final.size < submissions.length && now() < deadline) {
    await Promise.all(submissions.filter((s) => !final.has(s.id)).map(async (s) => {
      try {
        const r = await api('GET', `/hazard-submissions/${s.id}`, undefined, s.token);
        if (r.status !== 'QUEUED') {
          final.set(s.id, { ...r, observedAt: now() });
          if (r.hazardId && knownHazards.length < 500) knownHazards.push(r.hazardId);
        }
      } catch (e) { /* retry next round */ }
    }));
    if (final.size < submissions.length) await sleep(250);
  }
  const drainedAt = now();

  const results = [...final.values()];
  const processingMs = results.filter((r) => r.processedAt).map((r) => Date.parse(r.processedAt) - Date.parse(r.createdAt));
  const after = await prometheus();
  const hazardIds = new Set(results.map((r) => r.hazardId).filter(Boolean));
  const summary = {
    scenario, config: cfg, at: new Date().toISOString(),
    submitted: submissions.length,
    accountedFor: results.length,
    lost: submissions.length - results.length,
    created: results.filter((r) => r.status === 'CREATED').length,
    merged: results.filter((r) => r.status === 'MERGED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    distinctHazards: hazardIds.size,
    httpErrors: errors.length,
    errorRate: +(errors.length / Math.max(1, total)).toFixed(4),
    publishSeconds: +publishSeconds.toFixed(2),
    throughputPerSecond: +(results.length / ((drainedAt - t0) / 1000)).toFixed(2),
    processingLatencyMs: stats(processingMs),
    ...(restartedAt && { recoverySeconds: +((drainedAt - restartedAt) / 1000).toFixed(2) }),
    serverMetricsDelta: {
      created: after.created - before.created, merged: after.merged - before.merged,
      failed: after.failed - before.failed, consumerErrors: after.consumerErrors - before.consumerErrors,
    },
    serverProcessingLatencySeconds: { p50: after.processingP50, p95: after.processingP95, p99: after.processingP99 },
    sampleErrors: [...new Set(errors)].slice(0, 5),
  };
  const file = new URL(`../results/${scenario}-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved ${file.pathname}`);
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
