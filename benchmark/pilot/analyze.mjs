// Analysis for the two things only people can collect: a user pilot and a field route audit.
// Pure functions plus a small CLI, so the numbers in the paper can be regenerated from the CSVs.
//
//   node benchmark/pilot/analyze.mjs sus   pilot/sus.csv        # System Usability Scale
//   node benchmark/pilot/analyze.mjs tasks pilot/tasks.csv      # task success and time
//   node benchmark/pilot/analyze.mjs audit pilot/field-audit.csv # shortest vs SafeRoute, walked routes
//
// CSV formats are described in docs/PILOT_PLAN.md. Templates (headers only) are in benchmark/pilot/templates/.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v.trim()])));
}
const num = (x) => Number(x);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

/** SUS: items 1-10, each 1-5. Odd items score (x-1), even items (5-x); sum x 2.5 = 0-100. */
export function susScore(items) {
  if (items.length !== 10) throw new Error('SUS needs 10 items');
  return items.reduce((s, x, i) => s + (i % 2 === 0 ? x - 1 : 5 - x), 0) * 2.5;
}
export function susSummary(rows) {
  const scores = rows.map((r) => susScore(Array.from({ length: 10 }, (_, i) => num(r['q' + (i + 1)]))));
  const m = mean(scores);
  const half = 1.96 * sd(scores) / Math.sqrt(scores.length);
  return { n: scores.length, mean: m, median: median(scores), ci95: [m - half, m + half], scores,
    note: 'SUS around 68 is the usual benchmark average; with a small n the interval is wide.' };
}

/** tasks.csv: participant, task, success (1/0), seconds, errors */
export function taskSummary(rows) {
  const byTask = {};
  for (const r of rows) (byTask[r.task] ??= []).push(r);
  return Object.fromEntries(Object.entries(byTask).map(([t, rs]) => [t, {
    n: rs.length,
    successRate: mean(rs.map((r) => num(r.success))),
    medianSeconds: median(rs.filter((r) => num(r.success) === 1).map((r) => num(r.seconds))),
    meanErrors: mean(rs.map((r) => num(r.errors ?? 0))),
  }]));
}

/**
 * field-audit.csv: one row per walked route. Columns:
 *   route_id, pair_id, strategy (shortest|saferoute), metres, observed_high, observed_total,
 *   observed_known (observed hazards that were already in the app), app_listed, app_confirmed_in_field
 * Pairs: the same origin-destination walked both ways. Reports the paired difference with a
 * bootstrap 95 % interval, plus how well the app's hazard list matches what was seen.
 */
export function auditSummary(rows, { resamples = 5000, seed = 1 } = {}) {
  const byPair = {};
  for (const r of rows) (byPair[r.pair_id] ??= {})[r.strategy] = r;
  const pairs = Object.values(byPair).filter((p) => p.shortest && p.saferoute);
  if (!pairs.length) throw new Error('No pair has both a shortest and a saferoute row');
  const diffs = pairs.map((p) => num(p.shortest.observed_high) - num(p.saferoute.observed_high));
  const detour = pairs.map((p) => num(p.saferoute.metres) / num(p.shortest.metres) - 1);
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const boots = Array.from({ length: resamples }, () => mean(Array.from({ length: diffs.length }, () => diffs[Math.floor(rnd() * diffs.length)]))).sort((x, y) => x - y);
  const sum = (k) => rows.reduce((s, r) => s + num(r[k]), 0);
  return {
    pairs: pairs.length,
    highSeenShortestMean: mean(pairs.map((p) => num(p.shortest.observed_high))),
    highSeenSaferouteMean: mean(pairs.map((p) => num(p.saferoute.observed_high))),
    pairedReductionMean: mean(diffs),
    pairedReductionCi95: [boots[Math.floor(0.025 * resamples)], boots[Math.floor(0.975 * resamples)]],
    meanDetour: mean(detour),
    appPrecision: sum('app_listed') ? sum('app_confirmed_in_field') / sum('app_listed') : null,
    appRecall: sum('observed_total') ? sum('observed_known') / sum('observed_total') : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, file] = process.argv.slice(2);
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const out = mode === 'sus' ? susSummary(rows) : mode === 'tasks' ? taskSummary(rows) : mode === 'audit' ? auditSummary(rows) : null;
  if (!out) { console.error('usage: analyze.mjs sus|tasks|audit <csv>'); process.exit(1); }
  console.log(JSON.stringify(out, null, 2));
}
