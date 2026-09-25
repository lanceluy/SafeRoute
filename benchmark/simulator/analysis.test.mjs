// Self-tests for the benchmark instruments: node --test benchmark/simulator/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun, workloadMix, correlateDetections } from './analysis.mjs';

const at = (ms) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
const outcome = (status, latencyMs, hazardId = null) => ({ status, createdAt: at(0), processedAt: at(latencyMs), hazardId });

test('failed submissions are errors, never throughput', () => {
  const s = summarizeRun({
    reports: { offered: 10, accepted: 10, httpErrors: 0 },
    confirmations: { offered: 0, accepted: 0, httpErrors: 0, rejectedSelf: 0 },
    outcomes: Array.from({ length: 10 }, () => outcome('FAILED', 50)),
    elapsedSeconds: 5,
  });
  assert.equal(s.successfulThroughputPerSecond, 0);
  assert.equal(s.reportErrorRate, 1);
  assert.equal(s.processingLatencyMs.n, 0, 'failure latency must not be reported as processing latency');
  assert.equal(s.failureLatencyMs.n, 10);
});

test('reports that never reach an outcome are counted as lost and as errors', () => {
  const s = summarizeRun({
    reports: { offered: 4, accepted: 4, httpErrors: 0 },
    confirmations: { offered: 0, accepted: 0, httpErrors: 0, rejectedSelf: 0 },
    outcomes: [outcome('CREATED', 20, 'h1'), outcome('MERGED', 30, 'h1')],
    elapsedSeconds: 2,
  });
  assert.equal(s.lost, 2);
  assert.equal(s.reportErrorRate, 0.5);
  assert.equal(s.successfulThroughputPerSecond, 1);
  assert.equal(s.distinctHazards, 1);
});

test('a generator that sends no confirmations fails the workload-mix check', () => {
  const mix = workloadMix({ reportsOffered: 100, confirmationsOffered: 0, expectedConfirmationShare: 0.4 });
  assert.equal(mix.withinTolerance, false);
  assert.equal(workloadMix({ reportsOffered: 60, confirmationsOffered: 40, expectedConfirmationShare: 0.4 }).withinTolerance, true);
});

test('polling latency does not depend on the WebSocket client', () => {
  const submissions = [{ sentAt: 0, hazardId: 'a' }, { sentAt: 1000, hazardId: 'b' }];
  const withWs = [
    { client: 'ws', hazardId: 'a', at: 50 }, { client: 'ws', hazardId: 'b', at: 1050 },
    { client: 'poll3s', hazardId: 'a', at: 1500 }, { client: 'poll3s', hazardId: 'b', at: 3000 },
  ];
  // WebSocket frames delayed past the poll, and one dropped entirely.
  const degradedWs = [{ client: 'ws', hazardId: 'a', at: 9000 },
    { client: 'poll3s', hazardId: 'a', at: 1500 }, { client: 'poll3s', hazardId: 'b', at: 3000 }];

  const normal = correlateDetections({ submissions, observations: withWs, clients: ['ws', 'poll3s'] });
  const degraded = correlateDetections({ submissions, observations: degradedWs, clients: ['ws', 'poll3s'] });

  assert.deepEqual(degraded.clients.poll3s, normal.clients.poll3s);
  assert.equal(degraded.clients.poll3s.detected, 2);
  assert.equal(degraded.clients.ws.missed, 1);
});

test('only a client\'s first sighting counts', () => {
  const r = correlateDetections({
    submissions: [{ sentAt: 0, hazardId: 'a' }],
    observations: [{ client: 'p', hazardId: 'a', at: 900 }, { client: 'p', hazardId: 'a', at: 400 }],
    clients: ['p'],
  });
  assert.equal(r.clients.p.latencyMs.median, 400);
});
