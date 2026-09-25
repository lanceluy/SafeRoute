// Pure accounting and correlation logic for the benchmark scripts, kept free of network code so
// it can be self-tested (analysis.test.mjs). Definitions follow docs/METRICS.md.
import { execSync } from 'node:child_process';
import { stats } from './lib.mjs';

/**
 * Summarizes a load run. Only CREATED/MERGED count as success; FAILED and submissions that never
 * reached an outcome are errors, never throughput.
 *
 * @param run.reports        { offered, accepted, httpErrors }
 * @param run.confirmations  { offered, accepted, httpErrors, rejectedSelf }
 * @param run.outcomes       [{ status, createdAt, processedAt, hazardId }] — terminal submissions
 * @param run.elapsedSeconds first submission sent -> last submission terminal (or timeout)
 */
export function summarizeRun({ reports, confirmations, outcomes, elapsedSeconds }) {
  const byStatus = (s) => outcomes.filter((o) => o.status === s);
  const created = byStatus('CREATED').length;
  const merged = byStatus('MERGED').length;
  const failed = byStatus('FAILED').length;
  const unresolved = Math.max(0, reports.accepted - outcomes.length);
  const latency = (list) => list.filter((o) => o.processedAt && o.createdAt)
    .map((o) => Date.parse(o.processedAt) - Date.parse(o.createdAt));
  const successful = [...byStatus('CREATED'), ...byStatus('MERGED')];
  const reportErrors = reports.httpErrors + failed + unresolved;
  return {
    reports: { ...reports, created, merged, failed, unresolved },
    confirmations,
    distinctHazards: new Set(successful.map((o) => o.hazardId).filter(Boolean)).size,
    // Accepted reports that never reached any outcome: the fault-tolerance success condition is 0.
    lost: unresolved,
    reportErrorRate: ratio(reportErrors, reports.offered),
    confirmationErrorRate: ratio(confirmations.httpErrors, confirmations.offered),
    successfulThroughputPerSecond: elapsedSeconds > 0 ? +((created + merged) / elapsedSeconds).toFixed(2) : 0,
    processingLatencyMs: stats(latency(successful)),
    failureLatencyMs: stats(latency(byStatus('FAILED'))),
  };
}

/**
 * Whether the generated workload matched the configured mix. The confirmation share is measured
 * over operations actually offered, so a generator that never sends confirmations is caught.
 */
export function workloadMix({ reportsOffered, confirmationsOffered, expectedConfirmationShare, tolerance = 0.05 }) {
  const total = reportsOffered + confirmationsOffered;
  const achieved = total ? confirmationsOffered / total : 0;
  // With few operations randomness alone can miss the target; only judge meaningful samples.
  const judged = total >= 50;
  return {
    expectedConfirmationShare,
    achievedConfirmationShare: +achieved.toFixed(3),
    withinTolerance: !judged || Math.abs(achieved - expectedConfirmationShare) <= tolerance,
    judged,
  };
}

/**
 * Joins independent observations into per-client detection latencies. Each client's first
 * sighting of a hazard is recorded on its own; submissions are matched to hazards through the
 * server's canonical hazard id, never through another client's observation. A client that never
 * saw a hazard contributes a miss, not a silently dropped sample.
 *
 * @param submissions  [{ sentAt, hazardId }]  hazardId from the submission's outcome (null if unknown)
 * @param observations [{ client, hazardId, at }]
 * @param clients      client names to report on
 */
export function correlateDetections({ submissions, observations, clients }) {
  const firstSeen = new Map(); // `${client}|${hazardId}` -> at
  for (const o of observations) {
    const key = `${o.client}|${o.hazardId}`;
    if (!firstSeen.has(key) || firstSeen.get(key) > o.at) firstSeen.set(key, o.at);
  }
  const resolved = submissions.filter((s) => s.hazardId);
  const result = {};
  for (const client of clients) {
    const latencies = [];
    let missed = 0;
    for (const s of resolved) {
      const at = firstSeen.get(`${client}|${s.hazardId}`);
      if (at === undefined) missed++;
      else latencies.push(at - s.sentAt);
    }
    result[client] = { latencyMs: stats(latencies), detected: latencies.length, missed };
  }
  return { resolvedSubmissions: resolved.length, unresolvedSubmissions: submissions.length - resolved.length, clients: result };
}

/** Exact source revision the numbers came from (null outside a git checkout). */
export function sourceRevision() {
  try {
    const rev = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return dirty ? `${rev}+uncommitted` : rev;
  } catch {
    return null;
  }
}

function ratio(n, d) {
  return d ? +(n / d).toFixed(4) : 0;
}
