#!/usr/bin/env node
// Benchmark summary: prints the latest result of each scenario and how many runs exist, so a
// single run is never mistaken for a repeated experiment.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../results/', import.meta.url);
const latest = {};
const runs = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(new URL(f, dir)));
  latest[r.scenario] = r;
  runs[r.scenario] = (runs[r.scenario] ?? 0) + 1;
}
const ms = (s) => (s?.n ? `median ${s.median} ms · p95 ${s.p95} ms · p99 ${s.p99} ms · max ${s.max} ms (n=${s.n})` : 'n/a');
for (const r of Object.values(latest)) {
  console.log(`\nScenario: ${r.scenario}   (${r.at}, revision ${r.revision ?? 'unknown'}, ${runs[r.scenario]} run(s) on file)`);
  if (r.scenario === 'event_driven_vs_polling') {
    console.log(`  Submissions: ${r.submissions.sent} sent, ${r.submissions.created} created`);
    console.log(`  WebSocket notification latency: ${ms(r.websocket.latencyMs)}  — missed ${r.websocket.missed}`);
    for (const [k, v] of Object.entries(r.polling)) {
      console.log(`  ${k} polling detection latency:  ${ms(v.latencyMs)}  — missed ${v.missed}, ${v.httpRequests} requests, `
        + `${Math.round(v.wastedRequestRatio * 100)}% unchanged${v.fullPages ? `, ${v.fullPages} capped responses` : ''}`);
    }
    continue;
  }
  const rep = r.reports;
  console.log(`  Reports offered ${rep.offered} · accepted ${rep.accepted} · HTTP errors ${rep.httpErrors}`);
  console.log(`  Outcomes: created ${rep.created} · merged ${rep.merged} · failed ${rep.failed} · never resolved ${rep.unresolved}`);
  console.log(`  Confirmations offered ${r.confirmations.offered} (share ${r.workloadMix.achievedConfirmationShare}, `
    + `expected ${r.workloadMix.expectedConfirmationShare}${r.workloadMix.withinTolerance ? '' : ' — OUT OF TOLERANCE'})`);
  console.log(`  Processing latency (successful): ${ms(r.processingLatencyMs)}`);
  console.log(`  Successful throughput: ${r.successfulThroughputPerSecond}/s   Report error rate: ${(r.reportErrorRate * 100).toFixed(2)}%`);
  if (r.recoverySeconds !== undefined) console.log(`  Recovery time after consumer restart: ${r.recoverySeconds} s   Lost: ${r.lost}`);
}
