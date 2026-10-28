// Sensitivity analysis for SafeRoute's route scoring and duplicate merging.
//
// Reviewer concern: the severity weights (10/3/1), the 40 m route corridor and the 30 m merge
// radius were not justified. This sweeps each one against a synthetic ground truth and reports how
// the outcome changes, plus baselines (shortest route, hazard-count-only, random candidate).
//
// Self-contained and deterministic (seeded PRNG); needs Node >= 18, no backend or MapKit.
//   node benchmark/sensitivity/sweep.mjs [--seed 1] [--out benchmark/results/sensitivity]
//
// Model (all distances in metres on a local plane around Makati CBD):
//  - A street grid with BLOCK spacing. Pedestrian routes follow grid lines, so each O-D pair has
//    several candidate routes (two L-shapes and Z-shapes through offset mid-streets).
//  - True hazards sit on streets with a severity. Each is reported 1+Poisson(2) times with
//    Gaussian GPS noise (sigma); some true hazards are placed near a same-type neighbour so merging
//    can wrongly fuse two distinct hazards.
//  - Merge: a report joins the nearest existing same-type cluster within `radius` of that cluster's
//    stored location (its first report), mirroring HazardProcessingConsumer's PostGIS dedup.
//  - Routing: the router only sees the stored (noisy) cluster locations and scores each candidate
//    with the weights and corridor under test; it picks the lowest score, ties by distance.
//  - Outcome is judged on ground truth: true hazards within TRUE_FOOTPRINT of the chosen route.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const SEED = Number(args.seed ?? 1);
const OUT = args.out ?? 'benchmark/results/sensitivity';

const BLOCK = 100;          // street spacing, m
const AREA = 3000;          // half-width of the square test area, m
const TRUE_FOOTPRINT = 10;  // a hazard physically affects a walker within this distance, m
const REF_WEIGHTS = { high: 10, medium: 3, low: 1 };
const TYPES = ['FLOODING', 'BROKEN_SIDEWALK', 'OPEN_MANHOLE', 'POOR_LIGHTING', 'CONSTRUCTION'];

// --- deterministic PRNG (mulberry32) + helpers ---
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const poisson = (r, l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= r(); } while (p > L); return k - 1; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const polyDist = (p, poly) => { let m = Infinity; for (let i = 1; i < poly.length; i++) m = Math.min(m, segDist(p, poly[i - 1], poly[i])); return m; };
const polyLen = (poly) => poly.slice(1).reduce((s, p, i) => s + dist(poly[i], p), 0);

// --- ground truth ---
function buildWorld(seed, { nHazards = 1500, sigma = 10, nearPairFraction = 0.2 } = {}) {
  const r = rng(seed);
  const snap = (v) => Math.round(v / BLOCK) * BLOCK;
  const onStreet = () => {
    const horizontal = r() < 0.5;
    const along = (r() * 2 - 1) * AREA;
    const across = snap((r() * 2 - 1) * AREA);
    return horizontal ? { x: along, y: across } : { x: across, y: along };
  };
  const severityOf = () => { const u = r(); return u < 0.15 ? 'high' : u < 0.5 ? 'medium' : 'low'; };
  const truth = [];
  for (let i = 0; i < nHazards; i++) {
    const p = onStreet();
    truth.push({ id: truth.length, ...p, type: TYPES[Math.floor(r() * TYPES.length)], severity: severityOf() });
    if (r() < nearPairFraction) {
      // A distinct same-type hazard 15-80 m away (e.g. two potholes on one block).
      const ang = r() * 2 * Math.PI, d = 15 + r() * 65;
      truth.push({ id: truth.length, x: p.x + d * Math.cos(ang), y: p.y + d * Math.sin(ang), type: truth.at(-1).type, severity: severityOf() });
    }
  }
  const reports = [];
  for (const h of truth) {
    const n = 1 + poisson(r, 2);
    for (let k = 0; k < n; k++) reports.push({ truthId: h.id, type: h.type, severity: h.severity, x: h.x + sigma * normal(r), y: h.y + sigma * normal(r), t: r() });
  }
  reports.sort((a, b) => a.t - b.t);
  return { truth, reports, seed };
}

// --- merging (server behaviour) ---
function merge(reports, radius) {
  const clusters = [];
  for (const rep of reports) {
    let best = null, bd = radius;
    for (const c of clusters) {
      if (c.type !== rep.type) continue;
      const d = dist(c, rep);
      if (d <= bd) { best = c; bd = d; }
    }
    if (best) best.members.push(rep);
    else clusters.push({ x: rep.x, y: rep.y, type: rep.type, severity: rep.severity, members: [rep] });
  }
  return clusters;
}

// Pairwise precision/recall of the clustering against true hazard identity.
function mergeQuality(clusters, truthCount) {
  let tp = 0, fp = 0, fn = 0;
  const perTruth = new Map();
  for (const c of clusters) {
    const counts = new Map();
    for (const m of c.members) counts.set(m.truthId, (counts.get(m.truthId) ?? 0) + 1);
    const n = c.members.length;
    const same = [...counts.values()].reduce((s, k) => s + (k * (k - 1)) / 2, 0);
    tp += same;
    fp += (n * (n - 1)) / 2 - same;
    for (const [id, k] of counts) { const a = perTruth.get(id) ?? []; a.push(k); perTruth.set(id, a); }
  }
  for (const counts of perTruth.values()) {
    const tot = counts.reduce((s, k) => s + k, 0);
    const together = counts.reduce((s, k) => s + (k * (k - 1)) / 2, 0);
    fn += (tot * (tot - 1)) / 2 - together;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  return {
    precision, recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    clusters: clusters.length,
    clusterRatio: clusters.length / truthCount, // 1.0 = one cluster per real hazard
  };
}

// --- routing ---
function candidates(o, d, r) {
  const L1 = [o, { x: d.x, y: o.y }, d];
  const L2 = [o, { x: o.x, y: d.y }, d];
  const cands = [L1, L2];
  for (const off of [-1, 1, -2, 2]) {
    const midX = snapTo((o.x + d.x) / 2) + off * BLOCK;
    cands.push([o, { x: o.x, y: o.y }, { x: midX, y: o.y }, { x: midX, y: d.y }, d]);
    const midY = snapTo((o.y + d.y) / 2) + off * BLOCK;
    cands.push([o, { x: o.x, y: midY }, { x: d.x, y: midY }, d]);
  }
  return cands.filter((p) => polyLen(p) < 1.6 * (Math.abs(o.x - d.x) + Math.abs(o.y - d.y)) + 4 * BLOCK);
}
const snapTo = (v) => Math.round(v / BLOCK) * BLOCK;

const score = (route, hazards, corridor, w) => hazards.reduce((s, h) => (polyDist(h, route) <= corridor ? s + w[h.severity] : s), 0);

function makePairs(seed, n) {
  const r = rng(seed ^ 0x9e3779b9);
  const pairs = [];
  while (pairs.length < n) {
    const o = { x: snapTo((r() * 2 - 1) * (AREA - 1500)), y: snapTo((r() * 2 - 1) * (AREA - 1500)) };
    const ang = r() * 2 * Math.PI, len = 600 + r() * 1400;
    const d = { x: snapTo(o.x + len * Math.cos(ang)), y: snapTo(o.y + len * Math.sin(ang)) };
    const l = Math.abs(o.x - d.x) + Math.abs(o.y - d.y);
    if (l >= 500) pairs.push({ o, d });
  }
  return pairs;
}

function evalRouting(world, clusters, pairs, { corridor, weights, strategy = 'scored' }) {
  const r = rng(world.seed + 7);
  const known = clusters.map((c) => ({ x: c.x, y: c.y, severity: c.severity }));
  let high = 0, any = 0, weighted = 0, detour = 0, changed = 0;
  for (const { o, d } of pairs) {
    const cands = candidates(o, d, r).sort((a, b) => polyLen(a) - polyLen(b));
    const shortest = cands[0];
    let chosen;
    if (strategy === 'shortest') chosen = shortest;
    else if (strategy === 'random') chosen = cands[Math.floor(r() * cands.length)];
    else chosen = cands.map((c) => ({ c, s: score(c, known, corridor, weights), l: polyLen(c) })).sort((a, b) => a.s - b.s || a.l - b.l)[0].c;
    const exposed = world.truth.filter((h) => polyDist(h, chosen) <= TRUE_FOOTPRINT);
    high += exposed.filter((h) => h.severity === 'high').length;
    any += exposed.length;
    weighted += exposed.reduce((s, h) => s + REF_WEIGHTS[h.severity], 0);
    detour += polyLen(chosen) / polyLen(shortest) - 1;
    if (chosen !== shortest) changed++;
  }
  const n = pairs.length;
  return { highPerRoute: high / n, hazardsPerRoute: any / n, weightedPerRoute: weighted / n, detourPct: (detour / n) * 100, reroutedPct: (changed / n) * 100 };
}

// --- experiments ---
const f = (x, d = 3) => (typeof x === 'number' ? Number(x.toFixed(d)) : x);
const rows = { merge: [], corridor: [], weights: [], baselines: [], joint: [] };
const SEEDS = [SEED, SEED + 1, SEED + 2, SEED + 3, SEED + 4];
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const avgObj = (objs) => Object.fromEntries(Object.keys(objs[0]).map((k) => [k, mean(objs.map((o) => o[k]))]));
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

// 1. Merge radius x GPS noise
for (const sigma of [5, 10, 20]) {
  for (const radius of [10, 20, 30, 40, 50, 75, 100]) {
    const per = SEEDS.map((s) => { const w = buildWorld(s, { sigma }); return mergeQuality(merge(w.reports, radius), w.truth.length); });
    rows.merge.push({ gpsSigmaM: sigma, mergeRadiusM: radius, ...Object.fromEntries(Object.entries(avgObj(per)).map(([k, v]) => [k, f(v)])), f1Std: f(std(per.map((p) => p.f1))) });
  }
}

// Shared world for routing experiments (merge at the shipped 30 m, sigma 10 m).
const worlds = SEEDS.map((s) => { const w = buildWorld(s, { sigma: 10 }); return { w, clusters: merge(w.reports, 30), pairs: makePairs(s, 400) }; });
const runRouting = (opts) => avgObj(worlds.map(({ w, clusters, pairs }) => evalRouting(w, clusters, pairs, opts)));
const fmt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

// 2. Corridor
for (const corridor of [10, 20, 30, 40, 60, 80, 100]) rows.corridor.push({ corridorM: corridor, ...fmt(runRouting({ corridor, weights: REF_WEIGHTS })) });

// 3. Weights (corridor fixed at 40 m)
const weightSets = { '10/3/1 (shipped)': [10, 3, 1], '1/1/1 (count)': [1, 1, 1], '3/2/1': [3, 2, 1], '5/2/1': [5, 2, 1], '20/5/1': [20, 5, 1], '100/10/1': [100, 10, 1], '10/1/0': [10, 1, 0] };
for (const [name, [high, medium, low]] of Object.entries(weightSets)) rows.weights.push({ weights: name, ...fmt(runRouting({ corridor: 40, weights: { high, medium, low } })) });

// 4. Baselines (corridor 40, shipped weights)
for (const strategy of ['shortest', 'random', 'scored']) rows.baselines.push({ strategy: strategy === 'scored' ? 'SafeRoute scoring (10/3/1, 40 m)' : strategy, ...fmt(runRouting({ corridor: 40, weights: REF_WEIGHTS, strategy })) });

// 5. Joint corridor x merge radius -> high-severity exposure
for (const radius of [10, 30, 50, 100]) {
  for (const corridor of [20, 40, 80]) {
    const per = worlds.map(({ w, pairs }, i) => evalRouting(w, merge(w.reports, radius), pairs, { corridor, weights: REF_WEIGHTS }));
    rows.joint.push({ mergeRadiusM: radius, corridorM: corridor, ...fmt(avgObj(per)) });
  }
}

// --- output ---
mkdirSync(OUT, { recursive: true });
const toCsv = (rs) => [Object.keys(rs[0]).join(','), ...rs.map((r) => Object.values(r).join(','))].join('\n') + '\n';
const toMd = (rs) => { const k = Object.keys(rs[0]); return [`| ${k.join(' | ')} |`, `|${k.map(() => '---').join('|')}|`, ...rs.map((r) => `| ${Object.values(r).join(' | ')} |`)].join('\n'); };
for (const [name, rs] of Object.entries(rows)) writeFileSync(join(OUT, `${name}.csv`), toCsv(rs));
const md = `# Route-scoring sensitivity (seeds ${SEEDS.join(',')}; ${worlds[0].w.truth.length} true hazards/world, 400 O-D pairs/world)

Generated by \`benchmark/sensitivity/sweep.mjs\`. Synthetic ground truth - see the header of that file for the model.

## Merge radius x GPS noise (pairwise precision/recall of duplicate merging)
${toMd(rows.merge)}

## Route corridor (merge 30 m, weights 10/3/1)
${toMd(rows.corridor)}

## Severity weights (corridor 40 m)
${toMd(rows.weights)}

## Baselines
${toMd(rows.baselines)}

## Joint: merge radius x corridor
${toMd(rows.joint)}
`;
writeFileSync(join(OUT, 'sensitivity.md'), md);
console.log(md);
