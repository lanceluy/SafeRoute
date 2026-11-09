import test from 'node:test';
import assert from 'node:assert/strict';
import { susScore, susSummary, taskSummary, auditSummary, parseCsv } from './analyze.mjs';

test('SUS: best possible answers score 100, worst score 0', () => {
  assert.equal(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.equal(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.equal(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50);
});

test('SUS summary averages participants', () => {
  const row = (v) => Object.fromEntries(v.map((x, i) => ['q' + (i + 1), String(x)]));
  const s = susSummary([row([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), row([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])]);
  assert.equal(s.mean, 75);
  assert.equal(s.n, 2);
});

test('task summary: success rate and median time of successful attempts only', () => {
  const t = taskSummary(parseCsv('participant,task,success,seconds,errors\np1,report,1,30,0\np2,report,1,50,1\np3,report,0,200,3'));
  assert.equal(t.report.n, 3);
  assert.ok(Math.abs(t.report.successRate - 2 / 3) < 1e-9);
  assert.equal(t.report.medianSeconds, 40);
});

test('field audit: paired reduction, detour, and app precision/recall', () => {
  const csv = [
    'route_id,pair_id,strategy,metres,observed_high,observed_total,observed_known,app_listed,app_confirmed_in_field',
    'r1,p1,shortest,1000,2,5,4,5,4',
    'r2,p1,saferoute,1100,0,3,3,3,3',
    'r3,p2,shortest,800,1,4,2,4,2',
    'r4,p2,saferoute,880,1,3,2,3,3',
  ].join('\n');
  const a = auditSummary(parseCsv(csv));
  assert.equal(a.pairs, 2);
  assert.equal(a.pairedReductionMean, 1);        // (2-0 + 1-1) / 2
  assert.ok(Math.abs(a.meanDetour - 0.1) < 1e-9);
  assert.ok(a.appPrecision > 0 && a.appPrecision <= 1);
  assert.equal(a.appRecall, 11 / 15);            // observed_known 11 of observed_total 15
});

test('field audit refuses data with no complete pair', () => {
  const csv = 'route_id,pair_id,strategy,metres,observed_high,observed_total,observed_known,app_listed,app_confirmed_in_field\nr1,p1,shortest,1000,2,5,4,5,4';
  assert.throws(() => auditSummary(parseCsv(csv)));
});
