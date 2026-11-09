// Spam / collusion (Sybil) simulation for SafeRoute's crowd verification.
//
// Reviewer concern: crowdsourced trust was never tested against deliberately false reports.
// This models the rules that are in the backend today and compares defences.
//
// Rules mirrored from the code (verify them against the source if it changes):
//  - HazardLifecycle.evaluate: DISPUTED if disputes >= 2 and disputes >= verifies; else VERIFIED if
//    verifies >= 2; else REPORTED. (Votes are unweighted today; the weighted variants below are
//    PROPOSALS, not implemented features.)
//  - One opinion per user per hazard; a reporter cannot vote on their own report.
//  - Rate limits (RateLimitProperties): 3 registrations/hour per IP, 10 reports/hour and
//    60 confirmations/hour per account.
//  - Reputation (ReputationService): +5 reporter and +2 per confirmer when a hazard becomes VERIFIED;
//    removal as false: -5 x (prior removals + 1), capped at -20. Tiers: Regular >= 10, Trusted >= 50.
//  - There is no location check on confirmations (ConfirmationRequest carries only an action).
//
// Everything about honest behaviour (arrival rates, tier mix, moderator speed) is an ASSUMPTION, set
// in HONEST below. Read results as relative comparisons between defences, not absolute predictions.
//
//   node benchmark/adversarial/sybil.mjs [--seeds 20] [--out benchmark/results/adversarial]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const SEEDS = Number(args.seeds ?? 20);
const OUT = args.out ?? 'benchmark/results/adversarial';

const DT = 1 / 6;            // 10-minute steps, in hours
const HORIZON = 96;          // hours simulated
const ATTACK_START = 48, ATTACK_END = 72;

const HONEST = {
  users: 300,
  tierMix: { new: 0.5, regular: 0.35, trusted: 0.15 },
  trueHazardsPerHour: 1,        // real hazards appearing in the area
  reportDelayMean: 0.5,         // hours until someone reports it
  confirmRate: 0.6,             // confirmations per hour on a real hazard...
  confirmWindow: 12,            // ...for this many hours
  falseReportsPerHour: 1 / 12,  // honest mistakes
  fpConfirmRate: 0.1, fpDisputeRate: 0.4,
  fakeDisputeRate: 0.1,         // honest users who notice a hazard that is not there, per hour
  fakeConfirmRate: 0.02,        // honest users who wrongly agree with a fake
  moderatorMeanDelay: 6,        // hours until a moderator reviews a new hazard
  moderatorDetect: 0.9,         // chance a review removes a false hazard
};

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
const poisson = (r, l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= r(); } while (p > L); return k - 1; };
const expo = (r, mean) => -mean * Math.log(1 - r());
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

// ---- defences (proposals unless marked "current") ----
// verifyThreshold: weighted votes needed to verify. weighted: tier weights (new .5 / regular 1 / trusted 2).
// delayedRewards: reputation is awarded only after a hazard survives 24 h unremoved (not on VERIFIED).
// suspendAfter: an account is disabled after this many removed reports (0 = never).
// distinctIp: votes from the reporter's IP, or a second vote from one IP, do not count.
// newCaps: accounts below the Regular tier may file 2 reports/h and cast 10 votes/h (instead of 10/60).
const plain = { verifyThreshold: 2, weighted: false, delayedRewards: false, suspendAfter: 0, distinctIp: false, newCaps: false };
export const DEFENCES = {
  'current':                      { ...plain },
  'threshold 3':                  { ...plain, verifyThreshold: 3 },
  'threshold 5':                  { ...plain, verifyThreshold: 5 },
  'trust-weighted votes':         { ...plain, weighted: true },
  'trust-weighted + delayed rep': { ...plain, weighted: true, delayedRewards: true },
  'suspend after 2 removals':     { ...plain, suspendAfter: 2 },
  'distinct-IP votes':            { ...plain, distinctIp: true },
  'new-account caps':             { ...plain, newCaps: true },
  'new-account caps + delayed rep': { ...plain, newCaps: true, delayedRewards: true },
  // What the backend now does (docs/ADVERSARIAL_RESULTS.md). distinct-sources is a config flag, default off.
  'implemented (default settings)': { ...plain, suspendAfter: 3, newCaps: true, delayedRewards: true },
  'implemented + distinct sources': { ...plain, suspendAfter: 3, newCaps: true, delayedRewards: true, distinctIp: true },
  'all of the above':             { verifyThreshold: 2, weighted: true, delayedRewards: true, suspendAfter: 2, distinctIp: true, newCaps: true },
};
export const ATTACKERS = {
  'none':                      null,
  '3 accounts (1 IP, 1 h)':    { rate: 3,  prep: 1, maxTotal: 3 },
  '1 IP, 6 h prep':            { rate: 3,  prep: 6, maxTotal: 500 },
  '3 IPs, 6 h prep':           { rate: 9,  prep: 6, maxTotal: 500 },
  '10 IPs, 6 h prep':          { rate: 30, prep: 6, maxTotal: 500 },
};

const TIER_W = { new: 0.5, regular: 1, trusted: 2 };
const tierOf = (rep) => (rep >= 50 ? 'trusted' : rep >= 10 ? 'regular' : 'new');
const DISPUTE_THRESHOLD = 2;

export function run(seed, defence, attacker, opts = {}) {
  const r = rng(seed);
  const D = DEFENCES[defence];
  const H = { ...HONEST, ...(opts.honest ?? {}) };
  const accounts = [];
  // honest users each have their own IP; puppets share the attacker's IPs (3 registrations/hour/IP)
  const ips = attacker ? Math.max(1, Math.round(attacker.rate / 3)) : 1;
  const mk = (kind, rep, born) => {
    const id = accounts.length;
    const a = { id, kind, rep, born, removals: 0, suspended: false, reportsLeft: 10, confirmsLeft: 60, hourStamp: 0, ip: kind === 'honest' ? 'h' + id : 'p' + (puppetCount++ % ips) };
    accounts.push(a); return a;
  };
  let puppetCount = 0;
  const tiers = Object.entries(H.tierMix);
  for (let i = 0; i < H.users; i++) {
    const u = r(); let acc = 0, t = 'new';
    for (const [k, p] of tiers) { acc += p; if (u < acc) { t = k; break; } }
    mk('honest', t === 'trusted' ? 60 : t === 'regular' ? 20 : 0, -1e9);
  }
  const honest = accounts.slice(0, H.users);
  const puppets = [];

  const hazards = [];
  const weight = (a) => (D.weighted ? TIER_W[tierOf(a.rep)] : 1);
  const tally = (h) => {
    let v = 0, d = 0;
    const seen = new Set(D.distinctIp ? [accounts[h.reporter].ip] : []);
    for (const [id, x] of h.votes) {
      const a = accounts[id];
      if (D.distinctIp) { if (seen.has(a.ip)) continue; seen.add(a.ip); }
      const w = weight(a);
      if (x === 'V') v += w; else d += w;
    }
    return { v, d };
  };
  const evaluate = (h) => {
    if (h.removed) return;
    const { v, d } = tally(h);
    const old = h.status;
    h.status = d >= DISPUTE_THRESHOLD && d >= v ? 'DISPUTED' : v >= D.verifyThreshold ? 'VERIFIED' : 'REPORTED';
    if (h.status === 'VERIFIED' && h.verifiedAt == null) {
      h.verifiedAt = h.t;
      if (!D.delayedRewards) rewardVerified(h);
    }
    if (h.status === 'VERIFIED' && old !== 'VERIFIED') h.everVerified = true;
    if (h.status === 'DISPUTED') h.everDisputed = true;
  };
  const rewardVerified = (h) => {
    if (h.rewarded) return; h.rewarded = true;
    accounts[h.reporter].rep += 5;
    for (const [id, x] of h.votes) if (x === 'V') accounts[id].rep += 2;
  };
  const vote = (h, a, action) => {
    if (a.suspended || a.id === h.reporter || h.votes.has(a.id) || h.removed) return false;
    h.votes.set(a.id, action);
    evaluate(h);
    return true;
  };
  const addHazard = (kind, t, reporter) => {
    const h = { id: hazards.length, kind, created: t, reporter: reporter.id, votes: new Map(), status: 'REPORTED', removed: false, t,
      review: t + expo(r, H.moderatorMeanDelay), everDisputed: false, everVerified: false, verifiedAt: null, removedAt: null, rewarded: false, survivalAt: t + 24 };
    hazards.push(h);
    return h;
  };
  const refill = (a, t) => {
    const hr = Math.floor(t);
    if (a.hourStamp === hr) return;
    a.hourStamp = hr;
    const capped = D.newCaps && a.rep < 10;
    a.reportsLeft = capped ? 2 : 10;
    a.confirmsLeft = capped ? 10 : 60;
  };

  const randomHonest = () => honest[Math.floor(r() * honest.length)];
  let nextPuppetIdx = 0;

  const steps = Math.round(HORIZON / DT);
  for (let s = 0; s < steps; s++) {
    const t = s * DT;
    for (const h of hazards) h.t = t;

    // puppets get registered at the IP-limited rate, starting `prep` hours before the attack
    if (attacker) {
      const regStart = ATTACK_START - attacker.prep;
      const target = t < regStart ? 0 : Math.min(attacker.maxTotal, Math.floor(attacker.rate * (t - regStart + DT)));
      while (puppets.length < target) puppets.push(mk('puppet', 0, t));
    }

    // honest world
    for (let i = poisson(r, H.trueHazardsPerHour * DT); i > 0; i--) {
      const h = addHazard('true', t + expo(r, H.reportDelayMean), randomHonest());
      h.pendingStart = h.created;
    }
    for (let i = poisson(r, H.falseReportsPerHour * DT); i > 0; i--) addHazard('honestFP', t, randomHonest());

    for (const h of hazards) {
      if (h.removed || t < h.created) continue;
      const age = t - h.created;
      if (h.kind === 'true' && age < H.confirmWindow) for (let i = poisson(r, H.confirmRate * DT); i > 0; i--) vote(h, randomHonest(), 'V');
      if (h.kind === 'honestFP') {
        for (let i = poisson(r, H.fpConfirmRate * DT); i > 0; i--) vote(h, randomHonest(), 'V');
        for (let i = poisson(r, H.fpDisputeRate * DT); i > 0; i--) vote(h, randomHonest(), 'D');
      }
      if (h.kind === 'fake') {
        for (let i = poisson(r, H.fakeConfirmRate * DT); i > 0; i--) vote(h, randomHonest(), 'V');
        for (let i = poisson(r, H.fakeDisputeRate * DT); i > 0; i--) vote(h, randomHonest(), 'D');
      }
    }

    // attacker acts during its window: spend report/confirm capacity on fake hazards, then on disputing real ones
    if (attacker && t >= ATTACK_START && t < ATTACK_END) {
      const live = puppets.filter((p) => !p.suspended);
      for (const p of live) refill(p, t);
      // with distinct-IP counting a smart attacker only spends votes from IPs not yet used on that hazard
      const usable = (h, p, used) => p.id !== h.reporter && p.confirmsLeft > 0 && !h.votes.has(p.id)
        && !(D.distinctIp && (used.has(p.ip) || p.ip === accounts[h.reporter].ip));
      const confirmers = (h) => {
        const used = new Set(); const out = [];
        for (const p of live) if (usable(h, p, used)) { out.push(p); if (D.distinctIp) used.add(p.ip); }
        return out;
      };
      // fake hazards: each reporter files what its report capacity allows this step
      for (const rep of live) {
        const perStep = Math.max(1, Math.round(rep.reportsLeft / 6));
        for (let k = 0; k < perStep && rep.reportsLeft > 0; k++) {
          const cand = confirmers({ reporter: rep.id, votes: new Map() });
          if (cand.length < 1) break;
          rep.reportsLeft--;
          const h = addHazard('fake', t, rep);
          h.t = t;
          // confirm until verified, plus 1 extra vote as margin against honest disputes
          let extra = 1;
          for (const c of cand.sort((a, b) => weight(b) - weight(a))) {
            if (h.status === 'VERIFIED') { if (extra-- <= 0) break; }
            if (c.confirmsLeft <= 0) continue;
            c.confirmsLeft--;
            vote(h, c, 'V');
          }
        }
      }
      // suppression: leftover confirm capacity disputes real hazards that are not yet well supported
      for (const h of hazards) {
        if (h.kind !== 'true' || h.removed || t < h.created || h.status === 'DISPUTED') continue;
        if (t - h.created > 2) continue;
        const usedIps = new Set([accounts[h.reporter].ip, ...[...h.votes.keys()].map((id) => accounts[id].ip)]);
        for (const c of live) {
          if (c.confirmsLeft <= 5 || h.votes.has(c.id) || c.id === h.reporter) continue;
          if (D.distinctIp) { if (usedIps.has(c.ip)) continue; usedIps.add(c.ip); }
          c.confirmsLeft--;
          vote(h, c, 'D');
          if (h.status === 'DISPUTED') break;
        }
      }
    }

    // moderator review + delayed reputation
    for (const h of hazards) {
      if (h.removed) continue;
      if (t >= h.review && (h.kind === 'fake' || h.kind === 'honestFP') && !h.reviewed) {
        h.reviewed = true;
        if (r() < H.moderatorDetect) {
          h.removed = true; h.removedAt = t;
          const rp = accounts[h.reporter];
          const penalty = Math.max(-20, -5 * (rp.removals + 1));
          rp.rep += penalty; rp.removals++;
          if (D.suspendAfter && rp.removals >= D.suspendAfter) rp.suspended = true;
          if (!D.delayedRewards && h.rewarded) { /* rewards already paid under current rules: they stay (no clawback in code) */ }
        }
      }
      if (D.delayedRewards && !h.removed && h.status === 'VERIFIED' && t >= Math.max(h.survivalAt, (h.verifiedAt ?? 1e9))) rewardVerified(h);
    }
  }

  // ---- metrics over hazards created in the attack window ----
  const inWin = (h) => h.created >= ATTACK_START && h.created < ATTACK_END;
  const fakes = hazards.filter((h) => h.kind === 'fake');
  const fakeVerified = fakes.filter((h) => h.everVerified);
  const exposure = fakeVerified.reduce((sum, h) => sum + ((h.removedAt ?? HORIZON) - h.verifiedAt), 0);
  const trues = hazards.filter((h) => h.kind === 'true' && inWin(h));
  const ttv = trues.filter((h) => h.verifiedAt != null).map((h) => h.verifiedAt - h.created);
  return {
    fakesFiled: fakes.length,
    fakesVerified: fakeVerified.length,
    fakeExposureHours: exposure,
    puppetsUsed: puppets.length,
    puppetsSuspended: puppets.filter((p) => p.suspended).length,
    trueCount: trues.length,
    trueDisputedShare: trues.length ? trues.filter((h) => h.everDisputed).length / trues.length : 0,
    trueVerified6hShare: trues.length ? trues.filter((h) => h.verifiedAt != null && h.verifiedAt - h.created <= 6).length / trues.length : 0,
    trueTtvMedian: median(ttv),
    fpVerified: hazards.filter((h) => h.kind === 'honestFP' && h.everVerified).length,
  };
}

function aggregate(defence, attacker, opts) {
  const rows = [];
  for (let s = 1; s <= SEEDS; s++) rows.push(run(s, defence, ATTACKERS[attacker], opts));
  const f = (k) => { const xs = rows.map((x) => x[k]).filter((v) => v != null); return { mean: mean(xs), sd: sd(xs) }; };
  return Object.fromEntries(Object.keys(rows[0]).map((k) => [k, f(k)]));
}

const fmt = (x, d = 1) => (x == null || Number.isNaN(x.mean) ? '–' : x.mean.toFixed(d));
const pct = (x) => (x == null ? '–' : (x.mean * 100).toFixed(0) + ' %');

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT, { recursive: true });
  const out = { seeds: SEEDS, honest: HONEST, results: {} };
  let md = `# Spam and collusion simulation (${SEEDS} seeds per cell)\n\nGenerated by \`benchmark/adversarial/sybil.mjs\`. Honest behaviour, moderator speed and tier mix are assumptions (see the header of that file). The attack window is 24 simulated hours; "fake" hazards are filed by sock-puppet accounts.\n\n`;

  // sanity: with no attacker, no fakes
  const none = aggregate('current', 'none');
  if (none.fakesFiled.mean !== 0) throw new Error('baseline run produced fakes');

  md += '## 1. Today’s rules against attackers of different size\n\n| Attacker | Accounts used | Fake hazards filed | Fake hazards VERIFIED | Fake hazard-hours on map | Real hazards disputed | Real hazards verified within 6 h |\n|---|---|---|---|---|---|---|\n';
  out.results.attackers = {};
  for (const a of Object.keys(ATTACKERS)) {
    const x = aggregate('current', a);
    out.results.attackers[a] = x;
    md += `| ${a} | ${fmt(x.puppetsUsed, 0)} | ${fmt(x.fakesFiled, 0)} | ${fmt(x.fakesVerified, 0)} | ${fmt(x.fakeExposureHours, 0)} | ${pct(x.trueDisputedShare)} | ${pct(x.trueVerified6hShare)} |\n`;
  }

  out.results.defences = {};
  out.results.noAttackByDefence = {};
  for (const [label, attackerName] of [['3 accounts on 1 IP', '3 accounts (1 IP, 1 h)'], ['3 IPs', '3 IPs, 6 h prep']]) {
    md += `\n## 2. Defences against an attacker with ${label}\n\n| Defence | Fake VERIFIED | Fake hazard-hours | Accounts suspended | Real disputed | Real verified within 6 h | Same defence, no attacker: verified within 6 h | Real time to verify, median (h) |\n|---|---|---|---|---|---|---|---|\n`;
    out.results.defences[attackerName] = {};
    for (const d of Object.keys(DEFENCES)) {
      const x = aggregate(d, attackerName);
      const clean = out.results.noAttackByDefence[d] ?? (out.results.noAttackByDefence[d] = aggregate(d, 'none'));
      out.results.defences[attackerName][d] = x;
      md += `| ${d} | ${fmt(x.fakesVerified, 0)} | ${fmt(x.fakeExposureHours, 0)} | ${fmt(x.puppetsSuspended, 0)} | ${pct(x.trueDisputedShare)} | ${pct(x.trueVerified6hShare)} | ${pct(clean.trueVerified6hShare)} | ${fmt(x.trueTtvMedian, 2)} |\n`;
    }
  }
  const base = out.results.noAttackByDefence['current'];
  md += `\nNo attacker, current rules: real hazards verified within 6 h ${pct(base.trueVerified6hShare)}, median time to verify ${fmt(base.trueTtvMedian, 2)} h, real hazards disputed ${pct(base.trueDisputedShare)}.\n`;

  md += '\n## 3. Sensitivity to the assumption about honest users noticing fakes\n\nSame 3-IP attacker, current rules. `fakeDisputeRate` is how many honest users per hour dispute a fake they walk past.\n\n| Honest disputes per hour | Fake VERIFIED | Fake hazard-hours |\n|---|---|---|\n';
  out.results.honestDispute = {};
  for (const rate of [0, 0.1, 0.4, 1]) {
    const x = aggregate('current', '3 IPs, 6 h prep', { honest: { fakeDisputeRate: rate } });
    out.results.honestDispute[rate] = x;
    md += `| ${rate} | ${fmt(x.fakesVerified, 0)} | ${fmt(x.fakeExposureHours, 0)} |\n`;
  }
  writeFileSync(join(OUT, 'sybil.md'), md);
  writeFileSync(join(OUT, 'sybil.json'), JSON.stringify(out, null, 1));
  console.log(md);
}
