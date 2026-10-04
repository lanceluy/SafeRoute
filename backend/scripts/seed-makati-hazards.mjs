#!/usr/bin/env node
// Resets the dev database's hazards to two weeks of believable reports, all on Makati streets.
//
//   node backend/scripts/seed-makati-hazards.mjs [--seed 2026] [--days 14 | --hours 1] [--reports 200] [--only-new-types] > seed.sql
//   (--only-new-types generates just the six newer hazard types, no flooding or admin reports: for topping up)
//   docker exec -i saferoute-postgres psql -U saferoute -d saferoute -v ON_ERROR_STOP=1 < seed.sql
//
// Every report is played through the backend's own rules (HazardLifecycle thresholds, ExpiryPolicy TTLs,
// SimpleRuleBasedClassifier severities, reputation awards, the 7-day archive), so the scheduled jobs
// find nothing to correct and the portal and the iOS app read consistent data. One transaction: users,
// staff accounts and saved views are kept; every hazard and the rows hanging off it are replaced.
// Flooding follows Open-Meteo's recorded rain for Makati (the Weather page's source).
// A summary goes to stderr; the SQL goes to stdout.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const SEED = arg('seed', 2026);
const HOURS = arg('hours', 0); // a short window (e.g. --hours 1) instead of --days
const DAYS = HOURS ? Math.ceil(HOURS / 24) : arg('days', 14);
const TARGET_REPORTS = arg('reports', 200);
const ONLY_NEW_TYPES = process.argv.includes('--only-new-types');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;
const NOW = Date.now();
const START = HOURS ? NOW - HOURS * HOUR : NOW - DAYS * DAY;

// ------------------------------------------------------------------ randomness (deterministic per seed)

let state = SEED >>> 0;
function rand() { // mulberry32
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = (p) => rand() < p;
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const expo = (mean) => -Math.log(1 - rand()) * mean;
function weighted(entries) { // [[value, weight], ...]
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) if ((r -= w) <= 0) return v;
  return entries.at(-1)[0];
}
/** Stable UUIDs: the same seed gives the same ids, so a re-run replaces rather than duplicates. */
let uuidCounter = 0;
function uuid() {
  const h = createHash('sha1').update(`saferoute-seed:${SEED}:${uuidCounter++}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ------------------------------------------------------------------ backend rules (mirrors the Java)

const TTL = { // ExpiryPolicy
  FLOODING: 12 * HOUR, PATH_OBSTRUCTION: 24 * HOUR, CONSTRUCTION: 3 * DAY, OPEN_MANHOLE: 7 * DAY,
  POOR_LIGHTING: 30 * DAY, BROKEN_SIDEWALK: 45 * DAY, ACCESSIBILITY_BARRIER: 90 * DAY,
  VEHICLE_BLOCKING_SIDEWALK: 6 * HOUR, TRAFFIC_SIGNAL_OUTAGE: 12 * HOUR, ROAD_DEBRIS: 12 * HOUR, SAFETY_CONCERN: 12 * HOUR,
  FALLEN_TREE: 2 * DAY, CROSSWALK_ISSUE: 30 * DAY,
};
const DEFAULT_SEVERITY = { // SimpleRuleBasedClassifier
  OPEN_MANHOLE: 'HIGH', FLOODING: 'HIGH', ACCESSIBILITY_BARRIER: 'MEDIUM', BROKEN_SIDEWALK: 'MEDIUM',
  CONSTRUCTION: 'MEDIUM', PATH_OBSTRUCTION: 'MEDIUM', POOR_LIGHTING: 'LOW',
  TRAFFIC_SIGNAL_OUTAGE: 'HIGH', FALLEN_TREE: 'MEDIUM', VEHICLE_BLOCKING_SIDEWALK: 'MEDIUM', ROAD_DEBRIS: 'MEDIUM',
  CROSSWALK_ISSUE: 'MEDIUM', SAFETY_CONCERN: 'MEDIUM',
};
const PASSABILITY = [['PASSABLE', 'LOW', 3], ['DIFFICULT', 'MEDIUM', 5], ['BLOCKED', 'HIGH', 2]];
const ANSWERS = { // [answer, severity, how often reporters pick it]
  FLOODING: [['ANKLE_LEVEL', 'MEDIUM', 5], ['SHIN_LEVEL', 'HIGH', 3], ['KNEE_OR_HIGHER', 'HIGH', 1]],
  BROKEN_SIDEWALK: PASSABILITY,
  POOR_LIGHTING: [['DIM', 'LOW', 5], ['VERY_DARK', 'MEDIUM', 4], ['COMPLETELY_UNLIT', 'HIGH', 1]],
  OPEN_MANHOLE: [['OFF_PATH', 'MEDIUM', 3], ['PARTLY_OBSTRUCTING', 'HIGH', 4], ['IN_PATH', 'HIGH', 2]],
  ACCESSIBILITY_BARRIER: PASSABILITY,
  CONSTRUCTION: [['SIDEWALK_OPEN', 'LOW', 2], ['SIDEWALK_NARROWED', 'MEDIUM', 5], ['SIDEWALK_CLOSED', 'HIGH', 3]],
  PATH_OBSTRUCTION: PASSABILITY,
  TRAFFIC_SIGNAL_OUTAGE: [['PEDESTRIAN_SIGNAL_ONLY', 'MEDIUM', 3], ['FLASHING_OR_STUCK', 'MEDIUM', 3], ['COMPLETELY_OUT', 'HIGH', 4]],
  FALLEN_TREE: PASSABILITY,
  VEHICLE_BLOCKING_SIDEWALK: PASSABILITY,
  ROAD_DEBRIS: [['SMALL_DEBRIS', 'LOW', 4], ['SPILL_OR_SLICK', 'MEDIUM', 4], ['LARGE_OR_HAZARDOUS', 'HIGH', 2]],
  CROSSWALK_ISSUE: [['FADED_MARKINGS', 'LOW', 5], ['PARTLY_BLOCKED', 'MEDIUM', 3], ['MISSING_OR_BLOCKED', 'HIGH', 2]],
  SAFETY_CONCERN: [['SUSPICIOUS_ACTIVITY', 'LOW', 5], ['HARASSMENT_OR_THEFT', 'MEDIUM', 4], ['ACTIVE_THREAT', 'HIGH', 1]],
};
const VERIFY_THRESHOLD = 2;
const DISPUTE_THRESHOLD = 2;
const RESOLUTION_THRESHOLD = 2;
const ARCHIVE_AFTER = 7 * DAY;
const ACTIVE = new Set(['REPORTED', 'VERIFIED', 'DISPUTED']);

function evaluate(current, verifies, disputes) { // HazardLifecycle.evaluate
  if (!ACTIVE.has(current)) return current;
  if (disputes >= DISPUTE_THRESHOLD && disputes >= verifies) return 'DISPUTED';
  if (verifies >= VERIFY_THRESHOLD) return 'VERIFIED';
  return 'REPORTED';
}

// ------------------------------------------------------------------ Makati: barangays and streets

const barangays = JSON.parse(readFileSync(join(root, 'portal/public/makati-barangays.geojson'), 'utf8')).features
  .map((f) => ({
    name: f.properties.name,
    polygons: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));

function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function barangayAt(lat, lon) {
  for (const b of barangays) {
    for (const [outer, ...holes] of b.polygons) {
      if (inRing(lat, lon, outer) && !holes.some((h) => inRing(lat, lon, h))) return b.name;
    }
  }
  return null;
}

const metres = (a, b) => { // equirectangular is plenty at this scale
  const x = (b[1] - a[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180);
  const y = (b[0] - a[0]) * 110_574;
  return Math.hypot(x, y);
};

// Where people walk: busier roads and business districts collect more reports.
const ROAD_WEIGHT = { primary: 2.2, secondary: 2, tertiary: 1.6, pedestrian: 1.8, footway: 1.4, unclassified: 1, residential: 0.9, service: 0.5 };
const AREA_WEIGHT = {
  'San Lorenzo': 1.8, 'Bel-Air': 1.7, 'Poblacion': 2, 'San Antonio': 1.5, 'Guadalupe Nuevo': 1.4, 'Guadalupe Viejo': 1.3,
  'Urdaneta': 1.2, 'Valenzuela': 1.1, 'Pio del Pilar': 1.2, 'Forbes Park': 0.25, 'Dasmariñas': 0.35, 'Magallanes': 0.7,
};
const MAPUA = [14.56628, 121.01542]; // the simulator's default location: keep its 1 km lively for the app
const ROAD_TYPES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'footway', 'service']);

const segments = [];
for (const way of JSON.parse(readFileSync(join(here, 'data/makati-streets.json'), 'utf8')).ways) {
  if (!ROAD_TYPES.has(way.highway)) continue;
  for (let i = 1; i < way.coords.length; i++) {
    const a = way.coords[i - 1];
    const b = way.coords[i];
    const len = metres(a, b);
    if (len < 4) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const barangay = barangayAt(mid[0], mid[1]);
    if (!barangay) continue;
    const nearMapua = metres(mid, MAPUA) < 1000 ? 1.4 : 1;
    segments.push({ a, b, len, street: way.name, barangay, weight: len * (ROAD_WEIGHT[way.highway] ?? 1) * (AREA_WEIGHT[barangay] ?? 1) * nearMapua });
  }
}
const segmentTotal = segments.reduce((s, x) => s + x.weight, 0);
function pickSegment(near) {
  if (near) {
    const close = segments.filter((s) => metres(s.a, near) < 900);
    if (close.length) return pick(close);
  }
  let r = rand() * segmentTotal;
  for (const s of segments) if ((r -= s.weight) <= 0) return s;
  return segments.at(-1);
}
/** A point on a street, nudged up to ~5 m to one side (the sidewalk), still inside Makati. */
function placeOnStreet(near) {
  for (;;) {
    const s = pickSegment(near);
    const f = rand();
    const lat0 = s.a[0] + (s.b[0] - s.a[0]) * f;
    const lon0 = s.a[1] + (s.b[1] - s.a[1]) * f;
    // Perpendicular offset, in degrees.
    const dx = (s.b[1] - s.a[1]) * Math.cos((lat0 * Math.PI) / 180);
    const dy = s.b[0] - s.a[0];
    const n = Math.hypot(dx, dy) || 1;
    const off = between(2, 5) * (chance(0.5) ? 1 : -1) / 111_000;
    const lat = lat0 + (dx / n) * off;
    const lon = lon0 - (dy / n) * off / Math.cos((lat0 * Math.PI) / 180);
    const barangay = barangayAt(lat, lon);
    if (barangay) return { lat, lon, street: s.street, barangay };
  }
}
function crossStreet(p) {
  let best = null;
  for (const s of segments) {
    if (s.street === p.street) continue;
    const d = metres(s.a, [p.lat, p.lon]);
    if (d < 140 && (!best || d < best.d)) best = { d, street: s.street };
  }
  return best?.street ?? null;
}

// ------------------------------------------------------------------ rain (Open-Meteo, same as the Weather page)

async function rainByHour() {
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: '14.5547', longitude: '121.0244', hourly: 'precipitation', past_days: String(DAYS + 1),
    forecast_days: '1', timezone: 'UTC',
  });
  try {
    const d = await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).json();
    return d.hourly.time.map((t, i) => ({ at: Date.parse(t + 'Z'), mm: d.hourly.precipitation[i] ?? 0 }))
      .filter((h) => h.at >= START && h.at < NOW - HOUR);
  } catch (err) {
    console.error(`Open-Meteo unavailable (${err.message}); flooding is spread over invented showers`);
    return Array.from({ length: DAYS * 24 }, (_, i) => ({ at: START + i * HOUR, mm: i % 97 < 4 ? between(1, 8) : 0 }));
  }
}

// ------------------------------------------------------------------ people

const STAFF = { mod: 'mod@saferoute.local', official: 'official@makati.local' };
const YOU = 'admin@gmail.com';
const RESIDENTS = [
  'Andrea Santos', 'Miguel Reyes', 'Bea Cruz', 'Paolo Garcia', 'Katrina Mendoza', 'Joshua Bautista', 'Camille Ramos',
  'Rafael Villanueva', 'Jasmine Torres', 'Carlo Navarro', 'Patricia Aquino', 'Marco Dela Cruz', 'Isabel Fernandez',
  'Nico Castillo', 'Sofia Gonzales', 'Gabriel Lim', 'Trisha Tan', 'Enzo Salazar', 'Mika Valdez', 'Luis Pascual',
  'Angela Domingo', 'Kevin Ocampo', 'Rina Manalo', 'Jerome Soriano', 'Hannah Lopez',
].map((name, i) => ({ email: `resident${String(i + 1).padStart(2, '0')}@saferoute.local`, name, id: uuid() }));
// Some people report a lot, most a little.
const reporterWeights = RESIDENTS.map((r, i) => [r.email, i < 5 ? 3 : i < 12 ? 1.5 : 0.7]);

// ------------------------------------------------------------------ what gets reported

const NEW_TYPE_WEIGHT = [
  ['VEHICLE_BLOCKING_SIDEWALK', 8], ['TRAFFIC_SIGNAL_OUTAGE', 6], ['ROAD_DEBRIS', 5], ['CROSSWALK_ISSUE', 5],
  ['FALLEN_TREE', 4], ['SAFETY_CONCERN', 4],
];
const TYPE_WEIGHT = ONLY_NEW_TYPES ? NEW_TYPE_WEIGHT : [
  ['BROKEN_SIDEWALK', 22], ['PATH_OBSTRUCTION', 19], ['CONSTRUCTION', 15], ['OPEN_MANHOLE', 13],
  ['POOR_LIGHTING', 12], ['ACCESSIBILITY_BARRIER', 9], ...NEW_TYPE_WEIGHT,
];
/** How long the real thing lasts before someone fixes it or it clears (independent of the app's TTL). */
const LIFESPAN = {
  FLOODING: () => between(1.5, 9) * HOUR,
  PATH_OBSTRUCTION: () => between(2, 40) * HOUR,
  CONSTRUCTION: () => between(1, 12) * DAY,
  OPEN_MANHOLE: () => between(0.5, 8) * DAY,
  POOR_LIGHTING: () => between(1, 14) * DAY,
  BROKEN_SIDEWALK: () => between(2, 30) * DAY,
  ACCESSIBILITY_BARRIER: () => between(5, 90) * DAY,
  VEHICLE_BLOCKING_SIDEWALK: () => between(0.5, 7) * HOUR,
  TRAFFIC_SIGNAL_OUTAGE: () => between(2, 30) * HOUR,
  ROAD_DEBRIS: () => between(1, 20) * HOUR,
  FALLEN_TREE: () => between(4, 40) * HOUR,
  CROSSWALK_ISSUE: () => between(3, 60) * DAY,
  SAFETY_CONCERN: () => between(0.5, 10) * HOUR,
};
const DEPARTMENT = {
  FLOODING: 'DRAINAGE_FLOOD_CONTROL', OPEN_MANHOLE: 'ENGINEERING', BROKEN_SIDEWALK: 'ENGINEERING',
  CONSTRUCTION: 'ENGINEERING', POOR_LIGHTING: 'ENGINEERING', PATH_OBSTRUCTION: 'TRAFFIC_MANAGEMENT',
  ACCESSIBILITY_BARRIER: 'ENGINEERING',
  TRAFFIC_SIGNAL_OUTAGE: 'TRAFFIC_MANAGEMENT', FALLEN_TREE: 'BARANGAY_OFFICE', VEHICLE_BLOCKING_SIDEWALK: 'TRAFFIC_MANAGEMENT',
  ROAD_DEBRIS: 'ENGINEERING', CROSSWALK_ISSUE: 'TRAFFIC_MANAGEMENT', SAFETY_CONCERN: 'PUBLIC_SAFETY',
};
const DESCRIPTIONS = {
  FLOODING: {
    ANKLE_LEVEL: ['Ankle-deep water along the sidewalk', 'Water pooling at the corner after the rain', 'Shallow flood on the walkway, passable with care'],
    SHIN_LEVEL: ['Shin-deep flood, pedestrians walking on the road', 'Drain overflowing, sidewalk under water', 'Flooded crossing, hard to get across'],
    KNEE_OR_HIGHER: ['Knee-deep flood, not safe to walk', 'Street fully flooded, people stuck under the waiting shed'],
    null: ['Flooded sidewalk', 'Water on the walkway after heavy rain'],
  },
  BROKEN_SIDEWALK: {
    PASSABLE: ['Cracked pavers, watch your step', 'Uneven sidewalk tiles', 'Loose concrete slab near the curb'],
    DIFFICULT: ['Broken sidewalk with a deep hole', 'Sidewalk caved in near the drainage grate', 'Large section of pavement missing'],
    BLOCKED: ['Sidewalk completely dug up, must walk on the road', 'Collapsed sidewalk, no way through'],
    null: ['Damaged sidewalk', 'Broken pavement'],
  },
  POOR_LIGHTING: {
    DIM: ['Streetlight flickering at night', 'Only one lamp working on this stretch'],
    VERY_DARK: ['Several streetlights out, very dark after 7pm', 'Dark underpass, lights not working'],
    COMPLETELY_UNLIT: ['Whole block unlit at night', 'No working lights at all along the walkway'],
    null: ['Streetlight out', 'Poorly lit sidewalk'],
  },
  OPEN_MANHOLE: {
    OFF_PATH: ['Manhole cover missing near the curb', 'Open drainage cover beside the sidewalk'],
    PARTLY_OBSTRUCTING: ['Uncovered manhole partly on the walkway', 'Manhole cover broken and sunk, half the sidewalk blocked'],
    IN_PATH: ['Open manhole right in the middle of the sidewalk', 'Missing drain cover directly on the walking path, very dangerous at night'],
    null: ['Open manhole', 'Missing manhole cover'],
  },
  ACCESSIBILITY_BARRIER: {
    PASSABLE: ['Curb ramp is steep but usable', 'Narrow gap between bollards'],
    DIFFICULT: ['Curb ramp cracked and uneven', 'Bollards too close together for wheelchairs', 'No ramp, high step at the corner'],
    BLOCKED: ['Ramp blocked by a parked motorcycle', 'Stairs only, no ramp or elevator access'],
    null: ['No curb ramp', 'Wheelchair access blocked'],
  },
  CONSTRUCTION: {
    SIDEWALK_OPEN: ['Construction beside the sidewalk, still open', 'Scaffolding over the walkway, passable'],
    SIDEWALK_NARROWED: ['Construction barriers narrowing the sidewalk', 'Roadworks, only half the sidewalk usable', 'Materials piled on part of the walkway'],
    SIDEWALK_CLOSED: ['Sidewalk closed for construction, walking on the road', 'Excavation across the sidewalk, no detour signs'],
    null: ['Construction on the sidewalk', 'Ongoing roadworks'],
  },
  PATH_OBSTRUCTION: {
    PASSABLE: ['Vendor stalls on part of the sidewalk', 'Trash bags left on the walkway'],
    DIFFICULT: ['Cars parked on the sidewalk', 'Fallen tree branch across the walkway', 'Delivery trucks unloading on the sidewalk'],
    BLOCKED: ['Sidewalk fully blocked by parked vehicles', 'Fallen tree blocking the whole sidewalk', 'Tricycles parked across the walkway'],
    null: ['Sidewalk obstructed', 'Something blocking the walkway'],
  },
  TRAFFIC_SIGNAL_OUTAGE: {
    PEDESTRIAN_SIGNAL_ONLY: ['Walk signal is dead, only the car lights work', 'No pedestrian countdown at the crossing'],
    FLASHING_OR_STUCK: ['Signal stuck on red for minutes', 'Lights flashing yellow, nobody knows who goes first'],
    COMPLETELY_OUT: ['Traffic lights completely out at the intersection', 'Blackout at the signal, cars and people just pushing through'],
    null: ['Traffic signal not working', 'Signal out at the crossing'],
  },
  FALLEN_TREE: {
    PASSABLE: ['Small branches down on the sidewalk', 'Fallen leaves and twigs after the wind'],
    DIFFICULT: ['Large branch across half the walkway', 'Fallen tree limb leaning on the railing'],
    BLOCKED: ['Whole tree down across the sidewalk', 'Fallen tree blocking the walkway and part of the road'],
    null: ['Fallen branches', 'Tree down on the walkway'],
  },
  VEHICLE_BLOCKING_SIDEWALK: {
    PASSABLE: ['Motorcycle parked on the edge of the sidewalk', 'Car with two wheels on the walkway'],
    DIFFICULT: ['Parked car taking most of the sidewalk', 'Delivery van stopped on the walkway'],
    BLOCKED: ['Cars parked bumper to bumper across the sidewalk', 'Truck blocking the whole sidewalk, people walking on the road'],
    null: ['Vehicle on the sidewalk', 'Parked on the walkway'],
  },
  ROAD_DEBRIS: {
    SMALL_DEBRIS: ['Broken glass and small debris on the shoulder', 'Gravel spilled near the crossing'],
    SPILL_OR_SLICK: ['Oil spill on the pavement, very slippery', 'Water and mud from a leaking truck across the lane'],
    LARGE_OR_HAZARDOUS: ['Large debris from a collision across the road', 'Spilled construction material blocking the lane'],
    null: ['Debris on the road', 'Something spilled on the pavement'],
  },
  CROSSWALK_ISSUE: {
    FADED_MARKINGS: ['Pedestrian lane markings almost gone', 'Crosswalk paint faded, drivers do not stop'],
    PARTLY_BLOCKED: ['Parked motorcycles blocking half the crosswalk', 'Vendor cart standing on the crossing'],
    MISSING_OR_BLOCKED: ['No crosswalk markings at a busy crossing', 'Crosswalk completely blocked by parked cars'],
    null: ['Crosswalk problem', 'Pedestrian crossing in bad shape'],
  },
  SAFETY_CONCERN: {
    SUSPICIOUS_ACTIVITY: ['Group loitering at the corner late at night', 'Unfamiliar people following commuters near the stairs'],
    HARASSMENT_OR_THEFT: ['Catcalling and harassment reported along this stretch', 'Phone snatching incidents near the crossing'],
    ACTIVE_THREAT: ['A fight broke out near the terminal, avoid the area'],
    null: ['Safety concern in this area', 'Does not feel safe here'],
  },
};
const RESOLVE_NOTES = {
  ENGINEERING: ['Repaired by the Engineering crew', 'Fixed, sidewalk restored', 'Cover replaced', 'Repair completed'],
  DRAINAGE_FLOOD_CONTROL: ['Water subsided, drains cleared', 'Declogged the drainage', 'Flood cleared'],
  TRAFFIC_MANAGEMENT: ['Vehicles towed, sidewalk clear', 'Cleared by MAPSA enforcers', 'Obstruction removed'],
  PUBLIC_SAFETY: ['Area secured and cleared'],
  BARANGAY_OFFICE: ['Cleared by the barangay', 'Barangay tanods removed the obstruction'],
  null: ['Confirmed fixed on site', 'Resolved'],
};
const REMOVE_NOTES = ['False report: nothing found on site', 'Duplicate of an existing report', 'Not a pedestrian hazard', 'Spam'];

function describe(type, answer, place) {
  const base = pick(DESCRIPTIONS[type][answer] ?? DESCRIPTIONS[type].null);
  if (chance(0.15)) return null; // some people don't write anything
  const where = place.cross ? `${place.street} near ${place.cross}` : place.street;
  return chance(0.75) ? `${base} on ${where}` : base;
}

/** Reports cluster at the commute peaks and thin out at night and on weekends. */
const HOUR_WEIGHT = [0.15, 0.1, 0.05, 0.05, 0.1, 0.3, 0.9, 1.8, 2.2, 1.5, 1, 1, 1.3, 1, 0.9, 1, 1.3, 2, 2.3, 1.7, 1.1, 0.7, 0.4, 0.25];
const dayWeights = Array.from({ length: DAYS }, (_, d) => {
  const dow = new Date(START + d * DAY + 8 * HOUR).getUTCDay(); // Manila day of week
  return between(0.6, 1.5) * (dow === 0 || dow === 6 ? 0.6 : 1);
});
function reportTime() {
  for (;;) {
    const day = weighted(dayWeights.map((w, i) => [i, w]));
    const hour = weighted(HOUR_WEIGHT.map((w, i) => [i, w]));
    // Manila midnight of that day, in UTC.
    const manilaMidnight = Math.floor((START + 8 * HOUR) / DAY) * DAY - 8 * HOUR + day * DAY;
    const t = manilaMidnight + hour * HOUR + rand() * HOUR;
    if (t > START && t < NOW - 20 * MIN) return t;
  }
}

// ------------------------------------------------------------------ the simulation

const hazards = [];
const submissions = [];
const audits = [];
const histories = [];
const reputation = [];
const removalsByUser = new Map();
const iso = (t) => new Date(Math.round(t)).toISOString();

function audit(h, at, actor, action, field, oldValue, newValue, note, system = false) {
  audits.push({ id: uuid(), hazard: h.id, actor, action, field, oldValue, newValue, note, at, corr: system ? null : uuid() });
}
function statusChanged(h, at, actor, from, to, note) {
  if (from === to) return;
  histories.push({ id: uuid(), hazard: h.id, from, to, actor, at, note });
  audit(h, at, actor, 'STATUS_CHANGED', 'status', from, to, note, actor === null);
}
function touch(h, at) {
  if (at > h.lastConfirmed) h.lastConfirmed = at;
  const extended = at + TTL[h.type];
  if (extended > h.expires) h.expires = extended;
}
function changed(h, at) { h.version++; h.updated = Math.max(h.updated, at); }
function award(user, h, delta, reason, at) { reputation.push({ id: uuid(), user, hazard: h.id, delta, reason, at }); }
function markReviewed(h, staff, at) { h.reviewedAt = at; h.reviewedBy = staff; h.archivedAt = null; }

function onVerified(h, at) { // ReputationService.onHazardVerified
  if (!h.rewarded) { award(h.reporter, h, 5, 'REPORT_VERIFIED', at); h.rewarded = true; }
  for (const [user, c] of h.opinions) {
    if (c.action === 'VERIFY' && !c.awarded) { award(user, h, 2, 'CORRECT_VERIFICATION', at); c.awarded = true; }
  }
}
function recount(h, at, actor, note) {
  const verifies = [...h.opinions.values()].filter((c) => c.action === 'VERIFY').length;
  const disputes = h.opinions.size - verifies;
  h.confirmations = verifies;
  h.disputes = disputes;
  const next = evaluate(h.status, verifies, disputes);
  if (next === 'VERIFIED') onVerified(h, at);
  if (next !== h.status) {
    statusChanged(h, at, actor, h.status, next, note ?? `${verifies} confirmation(s), ${disputes} dispute(s)`);
    h.status = next;
  }
}
function opinion(h, user, action, at) { // upsertConfirmation; false if nothing changed
  if (action === 'VERIFY') touch(h, at);
  const c = h.opinions.get(user);
  if (c?.action === action) return false;
  audit(h, at, user, 'CONFIRMATION_CHANGED', 'confirmation', c?.action ?? null, action, null);
  if (c) { c.action = action; c.updated = at; c.revision = h.revision; } else {
    h.opinions.set(user, { id: uuid(), action, created: at, updated: at, awarded: false, revision: h.revision });
  }
  return true;
}
function resolve(h, at, actor, note) {
  statusChanged(h, at, actor, h.status, 'RESOLVED', note);
  h.status = 'RESOLVED';
  h.resolvedAt = at;
}

const steps = {
  verify(h, e) {
    if (e.user === h.reporter) return;
    if (opinion(h, e.user, 'VERIFY', e.at)) recount(h, e.at, e.user);
    changed(h, e.at);
  },
  dispute(h, e) {
    if (e.user === h.reporter) return;
    if (opinion(h, e.user, 'DISPUTE', e.at)) recount(h, e.at, e.user);
    changed(h, e.at);
  },
  merge(h, e) { // a second report of the same thing within 30 m
    const sub = submission(e.user, h.type, e.place, e.answer, e.description, e.at, 'MERGED', h.id);
    if (e.user === h.reporter) touch(h, sub.observed);
    else if (opinion(h, e.user, 'VERIFY', sub.observed)) recount(h, sub.processed, e.user, 'Duplicate report merged');
    h.merged++;
    audit(h, sub.processed, e.user, 'DUPLICATE_MERGED', null, null, null, `Submission ${sub.id}`);
    changed(h, sub.processed);
  },
  vote(h, e) { // "Is this still here?"
    if (e.user === h.reporter) return;
    const previous = h.votes.get(e.user);
    h.votes.set(e.user, { id: h.votes.get(e.user)?.id ?? uuid(), action: e.action, created: h.votes.get(e.user)?.created ?? e.at, updated: e.at, revision: h.revision });
    audit(h, e.at, e.user, 'RESOLUTION_VOTE', 'resolutionVote', previous?.action ?? null, e.action, null);
    if (e.action === 'STILL_PRESENT') touch(h, e.at);
    else {
      const gone = [...h.votes.values()].filter((v) => v.action === 'NO_LONGER_PRESENT').length;
      const still = h.votes.size - gone;
      if (gone >= RESOLUTION_THRESHOLD && gone > still) resolve(h, e.at, null, `Resolved by community: ${gone} users reported it is no longer present`);
    }
    changed(h, e.at);
  },
  respond(h, e) { // MunicipalResponseService.update
    if (e.department !== h.department) {
      audit(h, e.at, e.staff, 'MUNICIPAL_ASSIGNED', 'department', h.department, e.department, null);
      h.department = e.department;
      h.assignedAt = e.at;
    }
    if (e.priority !== h.priority) {
      audit(h, e.at + 2000, e.staff, 'MUNICIPAL_PRIORITY', 'priority', h.priority, e.priority, null);
      h.priority = e.priority;
    }
    markReviewed(h, e.staff, e.at);
    changed(h, e.at);
  },
  review(h, e) {
    audit(h, e.at, e.staff, 'STAFF_REVIEWED', null, null, null, h.archivedAt ? 'Restored from Archived' : null);
    markReviewed(h, e.staff, e.at);
    changed(h, e.at);
  },
  staffResolve(h, e) {
    resolve(h, e.at, e.staff, e.note);
    audit(h, e.at, e.staff, 'MODERATOR_RESOLVED', null, null, null, e.note);
    changed(h, e.at);
  },
  remove(h, e) { // HazardService.remove + ReputationService.onHazardRemovedAsFalse
    const prior = removalsByUser.get(h.reporter) ?? 0;
    removalsByUser.set(h.reporter, prior + 1);
    award(h.reporter, h, Math.max(-20, -5 * (prior + 1)), 'REPORT_REMOVED', e.at);
    for (const [user, c] of h.opinions) {
      if (c.action === 'DISPUTE' && !c.awarded) { award(user, h, 2, 'CORRECT_DISPUTE', e.at); c.awarded = true; }
    }
    statusChanged(h, e.at, e.staff, h.status, 'REMOVED', e.note);
    audit(h, e.at, e.staff, 'MODERATOR_REMOVED', null, null, null, e.note);
    h.status = 'REMOVED';
    h.resolvedAt = e.at;
    markReviewed(h, e.staff, e.at);
    changed(h, e.at);
  },
  reopen(h, e) { // HazardService.reopen
    h.votes.clear();
    const next = evaluate('REPORTED', h.confirmations, h.disputes);
    statusChanged(h, e.at, e.staff, h.status, next, e.note);
    audit(h, e.at, e.staff, 'MODERATOR_REOPENED', null, null, null, e.note);
    h.status = next;
    h.resolvedAt = null;
    h.revision++;
    h.lastConfirmed = e.at;
    h.expires = e.at + TTL[h.type];
    markReviewed(h, e.staff, e.at);
    changed(h, e.at);
  },
};

function submission(user, type, place, answer, description, at, status, hazardId) {
  const sub = {
    id: uuid(), user, type, lat: place.lat, lon: place.lon, description, answer, status, hazard: hazardId,
    observed: at - between(0.5, 6) * MIN, created: at, processed: at + between(0.3, 2.5) * 1000, clientRequest: uuid(), corr: uuid(),
  };
  submissions.push(sub);
  return sub;
}

/** Runs one hazard's story; the expiry and archive jobs step in wherever they would have. */
function play(h, events) {
  events.sort((a, b) => a.at - b.at);
  const archiveAt = h.created + ARCHIVE_AFTER + between(1, 10) * MIN;
  let archiveChecked = false;
  const runJobs = (until) => {
    if (!archiveChecked && archiveAt <= until) {
      archiveChecked = true;
      if (ACTIVE.has(h.status) && h.expires > archiveAt && h.reviewedAt === null && h.archivedAt === null) {
        h.archivedAt = archiveAt;
        audit(h, archiveAt, null, 'ARCHIVED', null, null, null, 'No staff review within 7 days', true);
        changed(h, archiveAt);
      }
    }
    if (ACTIVE.has(h.status) && h.expires <= until) { // HazardExpiryService, which runs every minute
      const at = h.expires + between(5, 60) * 1000;
      statusChanged(h, at, null, h.status, 'EXPIRED', `No confirmation since ${new Date(h.lastConfirmed).toISOString()}`);
      h.status = 'EXPIRED';
      changed(h, at);
    }
  };
  for (const e of events) {
    if (e.at >= NOW - MIN) break;
    runJobs(e.at);
    const active = ACTIVE.has(h.status);
    if (e.kind === 'reopen' ? active : !active) continue;
    steps[e.kind](h, e);
  }
  runJobs(NOW - MIN);
}

function newHazard({ type, reporter, at, place }) {
  const answered = chance(0.88);
  const option = answered ? weighted(ANSWERS[type].map((o) => [o, o[2]])) : null;
  const answer = option?.[0] ?? null;
  const severity = option?.[1] ?? DEFAULT_SEVERITY[type];
  place.cross = crossStreet(place);
  const description = describe(type, answer, place);
  const id = uuid();
  const sub = submission(reporter, type, place, answer, description, at, 'CREATED', id);
  const h = {
    id, type, place, description, answer, severity, reporter, status: 'REPORTED',
    created: sub.processed, updated: sub.processed, lastConfirmed: sub.observed, expires: sub.observed + TTL[type],
    opinions: new Map(), votes: new Map(), confirmations: 0, disputes: 0, merged: 0, rewarded: false,
    version: 0, revision: 0, department: null, priority: null, assignedAt: null,
    reviewedAt: null, reviewedBy: null, archivedAt: null, resolvedAt: null,
  };
  audit(h, sub.processed, reporter, 'CREATED', 'type', null, type, `Severity ${severity}`);
  hazards.push(h);
  return h;
}

/** The hazard's life: who sees it, whether the city acts, and when it really goes away. */
function story(h, opts = {}) {
  const events = [];
  const born = h.created;
  const gone = born + (opts.lifespan ?? LIFESPAN[h.type]());
  const bogus = opts.bogus ?? chance(0.09);
  const others = RESIDENTS.map((r) => r.email).filter((e) => e !== h.reporter);
  const crowd = () => pick(others);
  const sev = { LOW: 0.7, MEDIUM: 1, HIGH: 1.4 }[h.severity];
  const busy = (AREA_WEIGHT[h.place.barangay] ?? 1) * (metres([h.place.lat, h.place.lon], MAPUA) < 1000 ? 1.4 : 1);

  if (bogus) {
    // Nothing there: neighbours dispute it, and staff usually take it down.
    const n = int(2, 3);
    let t = born;
    for (let i = 0; i < n; i++) events.push({ kind: 'dispute', user: crowd(), at: (t += expo(5 * HOUR)) });
    if (chance(0.25)) events.push({ kind: 'verify', user: crowd(), at: born + expo(4 * HOUR) });
    if (chance(0.55)) events.push({ kind: 'remove', staff: pick([STAFF.mod, STAFF.official]), note: pick(REMOVE_NOTES), at: t + expo(10 * HOUR) });
    return events;
  }

  // Sightings while the hazard is really there: confirmations, duplicate reports, "still here" votes.
  let merges = 0;
  const rate = 0.055 * sev * busy * (opts.popular ? 2.5 : between(0.4, 1.6)); // per hour, at the start
  let t = born;
  for (;;) {
    t += expo(HOUR / rate) * (1 + (t - born) / DAY); // interest fades after the first day
    if (t >= gone || t >= NOW) break;
    const r = rand();
    const user = crowd();
    if (r < 0.62) events.push({ kind: 'verify', user, at: t });
    else if (r < 0.76 && t - born < 2 * DAY && merges++ < 2) {
      const place = { ...h.place, lat: h.place.lat + between(-12, 12) / 111_000, lon: h.place.lon + between(-12, 12) / 111_000 };
      const answer = chance(0.85) ? weighted(ANSWERS[h.type].map((o) => [o[0], o[2]])) : null;
      events.push({ kind: 'merge', user, at: t, place, answer, description: chance(0.5) ? describe(h.type, answer, { ...place, cross: null }) : null });
    } else if (r < 0.93) events.push({ kind: 'vote', action: 'STILL_PRESENT', user, at: t });
    else if (r < 0.97) events.push({ kind: 'dispute', user, at: t }); // someone who missed it
  }

  // The city: assigns a department (more often for serious ones), sometimes just marks it seen.
  const staff = pick([STAFF.mod, STAFF.official, STAFF.official]);
  const assigns = chance({ LOW: 0.25, MEDIUM: 0.42, HIGH: 0.7 }[h.severity]);
  const respondAt = born + expo(9 * HOUR) + 20 * MIN;
  let department = null;
  if (assigns) {
    department = chance(0.85) ? DEPARTMENT[h.type] : pick(['BARANGAY_OFFICE', 'PUBLIC_SAFETY']);
    const priority = h.severity === 'HIGH' ? weighted([['URGENT', 3], ['HIGH', 5], ['NORMAL', 1]])
      : h.severity === 'MEDIUM' ? weighted([['HIGH', 2], ['NORMAL', 6], ['LOW', 1]]) : weighted([['NORMAL', 3], ['LOW', 4]]);
    events.push({ kind: 'respond', staff, department, priority, at: respondAt });
  } else if (chance(0.3)) {
    events.push({ kind: 'review', staff, at: born + expo(30 * HOUR) + HOUR });
  }

  // When it's really gone: staff close it, neighbours vote it away, or it quietly expires.
  if (gone < NOW) {
    const closer = weighted([['staff', assigns ? 6 : 2], ['community', 3], ['none', 3]]);
    if (closer === 'staff') {
      events.push({ kind: 'staffResolve', staff, note: pick(RESOLVE_NOTES[department] ?? RESOLVE_NOTES.null), at: Math.max(gone, respondAt + HOUR) + expo(5 * HOUR) });
    } else if (closer === 'community') {
      let v = gone;
      for (let i = 0; i < RESOLUTION_THRESHOLD; i++) events.push({ kind: 'vote', action: 'NO_LONGER_PRESENT', user: crowd(), at: (v += expo(8 * HOUR)) });
    }
  }
  if (opts.mistake) { // resolved by mistake partway through its life, undone soon after
    const at = Math.min(born + (Math.min(gone, NOW) - born) * between(0.3, 0.6), NOW - 2 * HOUR);
    events.push({ kind: 'staffResolve', staff: STAFF.mod, note: 'Resolved by moderator', at });
    events.push({ kind: 'reopen', staff: STAFF.mod, note: pick(['Undo: resolved by mistake', 'Residents say it is still there']), at: at + between(3, 40) * MIN });
  }
  return events;
}

// ------------------------------------------------------------------ build the dataset

const rain = await rainByHour();
const wetHours = rain.filter((h) => h.mm >= 0.4);
const rainTotal = rain.reduce((s, h) => s + h.mm, 0);

// About 15% of reports end up merged into an existing hazard, so ~85% of the target are new hazards.
const hazardTarget = Math.round(TARGET_REPORTS * 0.8);
const floodTarget = ONLY_NEW_TYPES ? 0 : Math.min(Math.round(wetHours.length * 0.9), Math.round(hazardTarget * 0.14));

// Yours: a mix of outcomes near Mapúa so the app's My Reports and Nearby both have something.
const YOURS = [
  { type: 'OPEN_MANHOLE', daysAgo: 0.3, popular: true },
  { type: 'BROKEN_SIDEWALK', daysAgo: 1.4, popular: true },
  { type: 'PATH_OBSTRUCTION', daysAgo: 2.6, lifespan: 9 * HOUR },
  { type: 'POOR_LIGHTING', daysAgo: 4.2 },
  { type: 'CONSTRUCTION', daysAgo: 5.5, lifespan: 2 * DAY },
  { type: 'ACCESSIBILITY_BARRIER', daysAgo: 8.1, popular: true },
  { type: 'BROKEN_SIDEWALK', daysAgo: 10.7, lifespan: 4 * DAY },
  { type: 'PATH_OBSTRUCTION', daysAgo: 12.9, bogus: true },
];
for (const y of ONLY_NEW_TYPES ? [] : YOURS) {
  const at = NOW - y.daysAgo * DAY;
  const local = new Date(at + 8 * HOUR).getUTCHours();
  const shifted = local < 6 ? at + (7 - local) * HOUR : at; // nobody reports at 3am
  const h = newHazard({ type: y.type, reporter: YOU, at: Math.min(shifted, NOW - 30 * MIN), place: placeOnStreet(MAPUA) });
  play(h, story(h, y));
}

// Flooding where and when it actually rained.
for (let i = 0; i < floodTarget; i++) {
  const hour = weighted(wetHours.map((w) => [w, w.mm]));
  const at = Math.min(hour.at + rand() * HOUR, NOW - 20 * MIN);
  const h = newHazard({ type: 'FLOODING', reporter: weighted(reporterWeights), at, place: placeOnStreet() });
  play(h, story(h));
}

// Everything else.
const mistakes = new Set([int(10, 60), int(61, 120)]);
for (let i = hazards.length; i < hazardTarget; i++) {
  const type = weighted(TYPE_WEIGHT);
  const place = placeOnStreet(chance(0.06) ? MAPUA : null);
  const at = reportTime();
  // Same type within 30 m of an active hazard would have been merged by the backend: move on.
  if (hazards.some((o) => o.type === type && metres([o.place.lat, o.place.lon], [place.lat, place.lon]) < 32)) { i--; continue; }
  const h = newHazard({ type, reporter: weighted(reporterWeights), at, place });
  play(h, story(h, { mistake: mistakes.has(i) }));
}

// ------------------------------------------------------------------ SQL

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const ts = (t) => (t === null || t === undefined ? 'NULL' : `'${iso(t)}'::timestamptz`);
const u = (email) => (email === null ? 'NULL' : `(SELECT id FROM users WHERE email = ${q(email)})`);
const out = [];
const rows = (table, columns, list) => {
  for (let i = 0; i < list.length; i += 200) {
    out.push(`INSERT INTO ${table} (${columns}) VALUES\n${list.slice(i, i + 200).map((r) => `  (${r.join(', ')})`).join(',\n')};`);
  }
};

out.push(`-- Generated by backend/scripts/seed-makati-hazards.mjs --seed ${SEED} at ${iso(NOW)}`);
out.push('BEGIN;');
out.push(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = ${q(STAFF.mod)}) OR NOT EXISTS (SELECT 1 FROM users WHERE email = ${q(STAFF.official)})
     OR NOT EXISTS (SELECT 1 FROM users WHERE email = ${q(YOU)}) THEN
    RAISE EXCEPTION 'Seed needs ${STAFF.mod}, ${STAFF.official} and ${YOU} to exist';
  END IF;
END $$;`);

out.push(`-- Reset: everything that hangs off a hazard, then the hazards.
DELETE FROM reputation_events;
DELETE FROM hazard_confirmations;
DELETE FROM hazard_resolution_votes;
DELETE FROM hazard_status_history;
DELETE FROM hazard_audit_log;
DELETE FROM hazard_submissions;
UPDATE hazards SET duplicate_of_hazard_id = NULL WHERE duplicate_of_hazard_id IS NOT NULL;
DELETE FROM hazards;
DELETE FROM outbox_events;
DELETE FROM processed_events;`);

// Residents share the dev moderator's password (benchmark/README.md), so any of them can sign in.
rows('users', 'id, email, password_hash, display_name, role, created_at',
  RESIDENTS.map((r) => [q(r.id), q(r.email), `(SELECT password_hash FROM users WHERE email = ${q(STAFF.mod)})`, q(r.name), "'USER'", ts(START - between(20, 200) * DAY)]));
out[out.length - 1] = out.at(-1).replace(/;$/, '\nON CONFLICT (email) DO NOTHING;');

rows('hazards', 'id, type, location, description, status, severity, confirmation_count, reporter_id, created_at, updated_at, resolved_at, dispute_count, last_confirmed_at, expires_at, severity_answer, reporter_rewarded, version, content_revision, assigned_department, municipal_priority, assigned_at, reviewed_at, reviewed_by, archived_at, merged_report_count',
  hazards.map((h) => [q(h.id), q(h.type), `ST_SetSRID(ST_MakePoint(${h.place.lon.toFixed(7)}, ${h.place.lat.toFixed(7)}), 4326)::geography`, q(h.description),
    q(h.status), q(h.severity), h.confirmations, u(h.reporter), ts(h.created), ts(h.updated), ts(h.resolvedAt), h.disputes, ts(h.lastConfirmed),
    ts(h.expires), q(h.answer), h.rewarded, h.version, h.revision, q(h.department), q(h.priority), ts(h.assignedAt), ts(h.reviewedAt),
    u(h.reviewedBy), ts(h.archivedAt), h.merged]));

rows('hazard_submissions', 'id, reporter_id, submitted_type, latitude, longitude, description, severity_answer, processing_status, canonical_hazard_id, correlation_id, created_at, processed_at, client_request_id, observed_at',
  submissions.map((s) => [q(s.id), u(s.user), q(s.type), s.lat.toFixed(7), s.lon.toFixed(7), q(s.description), q(s.answer), q(s.status), q(s.hazard),
    q(s.corr), ts(s.created), ts(s.processed), q(s.clientRequest), ts(s.observed)]));

rows('hazard_confirmations', 'id, hazard_id, user_id, action, created_at, updated_at, reputation_awarded, hazard_revision',
  hazards.flatMap((h) => [...h.opinions].map(([user, c]) => [q(c.id), q(h.id), u(user), q(c.action), ts(c.created), ts(c.updated), c.awarded, c.revision])));

rows('hazard_resolution_votes', 'id, hazard_id, user_id, action, created_at, updated_at, hazard_revision',
  hazards.flatMap((h) => [...h.votes].map(([user, v]) => [q(v.id), q(h.id), u(user), q(v.action), ts(v.created), ts(v.updated), v.revision])));

rows('hazard_status_history', 'id, hazard_id, old_status, new_status, changed_by, changed_at, note',
  histories.map((s) => [q(s.id), q(s.hazard), q(s.from), q(s.to), u(s.actor), ts(s.at), q(s.note)]));

rows('hazard_audit_log', 'id, hazard_id, actor_id, action, field_name, old_value, new_value, note, correlation_id, created_at',
  audits.map((a) => [q(a.id), q(a.hazard), u(a.actor), q(a.action), q(a.field), q(a.oldValue), q(a.newValue), q(a.note), q(a.corr), ts(a.at)]));

rows('reputation_events', 'id, user_id, hazard_id, delta, reason, created_at',
  reputation.map((r) => [q(r.id), u(r.user), q(r.hazard), r.delta, q(r.reason), ts(r.at)]));

out.push(`-- Reputation is the sum of its events.
UPDATE users SET reputation_score = coalesce((SELECT sum(delta) FROM reputation_events e WHERE e.user_id = users.id), 0);`);
out.push('COMMIT;');
console.log(out.join('\n\n'));

// ------------------------------------------------------------------ summary (stderr)

const count = (list, key) => Object.entries(list.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
const outside = hazards.filter((h) => !barangayAt(h.place.lat, h.place.lon)).length + submissions.filter((s) => !barangayAt(s.lat, s.lon)).length;
const activeNow = hazards.filter((h) => ACTIVE.has(h.status));
console.error(`Seed ${SEED}: ${submissions.length} reports -> ${hazards.length} hazards (${submissions.length - hazards.length} merged) over ${DAYS} days`);
console.error(`Rain: ${rainTotal.toFixed(1)} mm in ${wetHours.length} wet hours -> ${floodTarget} flooding reports`);
console.error('Status:  ', count(hazards, (h) => h.status).map(([k, v]) => `${k} ${v}`).join(', '));
console.error('Type:    ', count(hazards, (h) => h.type).map(([k, v]) => `${k} ${v}`).join(', '));
console.error('Severity:', count(hazards, (h) => h.severity).map(([k, v]) => `${k} ${v}`).join(', '));
console.error('Active:  ', `${activeNow.length} on the map, ${activeNow.filter((h) => h.archivedAt).length} archived, ${activeNow.filter((h) => metres([h.place.lat, h.place.lon], MAPUA) < 1000).length} within 1 km of Mapúa`);
console.error('Barangay:', count(hazards, (h) => h.place.barangay).map(([k, v]) => `${k} ${v}`).join(', '));
console.error(`Yours (${YOU}):`, hazards.filter((h) => h.reporter === YOU).map((h) => `${h.type} ${h.status}`).join(', '));
console.error(`Outside Makati: ${outside}`);
if (outside) process.exit(1);
