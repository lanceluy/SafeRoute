# SafeRoute benchmark

Evidence for the paper's research objectives: event-driven processing vs a polling baseline,
behaviour under load, and recovery when a consumer fails. Metric definitions are in
[`../docs/METRICS.md`](../docs/METRICS.md).

```
benchmark/
├── k6/                     HTTP load (k6): normal-load, high-load, stress, polling-baseline
├── simulator/              Synthetic event generator + latency comparison (Node ≥ 22, no deps)
├── scripts/                start-stack.sh, stop-consumer.sh, export-metrics.sh
└── results/                JSON/Prometheus output (git-ignored)
```

## 1. Start the stack in benchmark mode

```bash
./scripts/start-stack.sh
```

This runs the backend with `SPRING_PROFILES_ACTIVE=benchmark`: rate limiting is **off** (hundreds
of simulated users share one IP), the consumer stop/start endpoint is **on**, and
`mod@saferoute.local` is promoted to moderator. Register that account once:

```bash
curl -X POST localhost:8080/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"mod@saferoute.local","password":"password123","displayName":"Moderator"}'
```

## 2. Event-driven vs polling (review §42)

```bash
node simulator/latency-compare.mjs --events 50 --gap 2000
```

One WebSocket client and three polling clients (1 s, 3 s, 5 s) watch the same area while a
reporter submits hazards. Same-process clocks, so latencies need no skew correction.
Reports WebSocket notification latency vs polling detection latency (median/p95/p99/max) and
how many polling requests returned nothing new.

## 3. Synthetic scenarios (review §43)

```bash
node simulator/simulate.mjs normal            # 1 event/s,  20 users
node simulator/simulate.mjs rush_hour         # 10 events/s, 100 users, 40% confirmations
node simulator/simulate.mjs severe_weather    # 50 flooding reports/s burst
node simulator/simulate.mjs duplicate_burst   # 20 reports/s within 40 m → dedup merging
node simulator/simulate.mjs failure_recovery  # consumer stopped, 100 events, restart
# override: --rate 25 --duration 60 --users 150
```

Each run records events submitted / accounted for / **lost**, created vs merged, distinct
hazards (duplicate side effects), HTTP error rate, throughput, processing latency percentiles,
and (failure_recovery) the recovery time.

### Fault-tolerance test (review §44)

`failure_recovery` automates the paper's procedure: stop the Hazard Processing consumer
(`/api/admin/consumers/hazard-reported-processor/stop`), publish 100 `hazard_reported` events,
confirm they are still QUEUED (retained in Kafka), restart the consumer, wait until every
submission is accounted for. **Success condition: lost = 0 and distinct hazards = events
created (no duplicate hazards from redelivery).** To do it by hand:
`./scripts/stop-consumer.sh`, generate load, then `./scripts/stop-consumer.sh start`.

Because the processing module runs inside the same Spring Boot application as the API,
"disabling the consumer" means stopping its Kafka listener container — the API keeps accepting
reports, which is exactly the decoupling being tested.

## 4. Load tests with k6

```bash
brew install k6
k6 run k6/normal-load.js
k6 run k6/high-load.js
k6 run k6/stress.js
k6 run -e CLIENTS=200 -e POLL_SECONDS=3 k6/polling-baseline.js
./scripts/export-metrics.sh   # server-side latency percentiles, CPU, memory, pool usage
```

## 5. Summary for the presentation (review §46)

```bash
node simulator/report.mjs
```

Prints the latest run of each scenario. Report medians and p95/p99, not just averages, and
state the environment (machine, Docker resources, single Kafka broker) next to any number.

### Sample run (development laptop, single broker, 2026-09-24)

These are from a short verification run, not a formal experiment; re-run with larger samples for the paper.

| Measurement | Median | p95 |
|---|---|---|
| WebSocket notification latency (n=12) | 49 ms | 68 ms |
| 1 s polling detection latency | 488 ms | 1,030 ms |
| 3 s polling detection latency | 1,502 ms | 3,027 ms |
| 5 s polling detection latency | 2,775 ms | 5,025 ms |
| Processing latency, normal load | 18 ms | 59 ms |

Fault tolerance: 100 events published while the consumer was stopped → 100 processed after
restart, **0 lost**, 0 duplicate hazards, backlog drained in 2.7 s.
