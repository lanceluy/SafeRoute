#!/usr/bin/env node
// Developer-only benchmark summary (review §46): prints the latest result of each scenario.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../results/', import.meta.url);
const latest = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(new URL(f, dir)));
  latest[r.scenario] = r;
}
const ms = (s) => (s?.n ? `median ${s.median} ms · p95 ${s.p95} ms · p99 ${s.p99} ms · max ${s.max} ms (n=${s.n})` : 'n/a');
for (const r of Object.values(latest)) {
  console.log(`\nScenario: ${r.scenario}   (${r.at})`);
  if (r.scenario === 'event_driven_vs_polling') {
    console.log(`  WebSocket notification latency: ${ms(r.websocket.latencyMs)}`);
    for (const [k, v] of Object.entries(r.polling)) {
      console.log(`  ${k} polling detection latency:  ${ms(v.detectionLatencyMs)}  — ${v.httpRequests} requests, ${Math.round(v.wastedRequestRatio * 100)}% unchanged`);
    }
    continue;
  }
  console.log(`  Events: ${r.submitted}   Processed: ${r.accountedFor}   Lost: ${r.lost}   Failed: ${r.failed}`);
  console.log(`  Created ${r.created} · Merged ${r.merged} · Distinct hazards ${r.distinctHazards}`);
  console.log(`  Processing latency: ${ms(r.processingLatencyMs)}`);
  console.log(`  Throughput: ${r.throughputPerSecond} events/s   Error rate: ${(r.errorRate * 100).toFixed(2)}%`);
  if (r.recoverySeconds !== undefined) console.log(`  Recovery time after consumer restart: ${r.recoverySeconds} s`);
}
