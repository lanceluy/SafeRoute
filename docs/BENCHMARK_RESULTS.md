# Benchmark results — 27–28 September 2026

Measured with the corrected instruments in `benchmark/` (see [`../benchmark/README.md`](../benchmark/README.md)
and [`METRICS.md`](METRICS.md) for definitions). These replace the superseded sample numbers in
the benchmark README.

## Environment

| | |
|---|---|
| Machine | Apple M1 Max, 10 cores, 32 GB RAM, macOS 27.0 |
| Docker | 10 CPUs, 7.7 GB for PostgreSQL 16 + PostGIS and one Kafka 3.8 broker |
| Backend | Spring Boot, `benchmark` profile (rate limiting **off**), one instance, same laptop |
| Database | A separate `saferoute_bench` database, empty at the start |
| Tools | Node 26.8 (simulator), k6 2.3.0 |
| Source revision | `d57c22e` (plus a cosmetic change to the simulators' log output) |

Everything ran on one laptop, so these numbers show the architecture's behaviour, not
production capacity.

## 1. Event-driven notification vs polling (Objective 4)

`node simulator/latency-compare.mjs --events 50 --gap 2000`: one WebSocket client and three
polling clients watch the same area while a reporter submits 50 hazards about 2 s apart.

**Primary result: 2 runs on an empty database with an idle system (100 events):**

| Client | Median | p95 | p99 | Max | Requests with nothing new |
|---|---|---|---|---|---|
| WebSocket (event-driven) | **26 ms** | **56 ms** | 124 ms | 1,380 ms¹ | — |
| Polling every 1 s | 442 ms | 908 ms | 992 ms | 1,874 ms | 53 % (111 of 210) |
| Polling every 3 s | 1,441 ms | 2,883 ms | 2,934 ms | 2,986 ms | 8 % (6 of 71) |
| Polling every 5 s | 2,572 ms | 4,842 ms | 4,997 ms | 5,019 ms | 5 % (2 of 42) |

¹ One first-event outlier; the next-largest WebSocket latency was under 130 ms.

Every client detected all 100 hazards; none were missed. Three further runs on an idle system,
against a database already holding ~77,000 hazards, agree: WebSocket median 23 ms, p95 61 ms
(n = 97; the other reports merged into existing hazards, which sends no new-hazard notification).

**Excluded runs, and why.** Two runs came right after a round of k6 load. In one, the backend was
still processing that backlog: the WebSocket median was 44.8 s, and every client was equally late
because hazards were created late. The other missed 2 of 50 events on every client. Two more runs were interrupted when the laptop was suspended for 9–15 minutes
(the connection pool logged a "clock leap"). None of these are counted above.

**Reading.** Delivery is push-limited, not poll-limited: the event-driven path is about 17× faster
than 1 s polling at the median and about 55× faster than 3 s polling. Polling faster than the
event rate wastes most requests. At 1 s, more than half returned nothing new.

## 2. Synthetic scenarios (`simulate.mjs`, 3 rounds each)

| Scenario | Offered per run | Lost | HTTP errors | Failed | Throughput | Processing latency median / p95 |
|---|---|---|---|---|---|---|
| normal (1/s, 20 users) | 17–21 | **0** | 0 | 0 | 0.6–0.7 /s | 11–17 ms / 23–50 ms |
| rush_hour (10/s, 100 users, 40 % confirmations) | 347–377 | **0** | 0 | 0 | 5.8–6.3 /s | 10–15 ms / 21–34 ms |
| severe_weather (50/s flooding burst) | 785–802 | **0** | 0 | 0 | 38.8–39.6 /s | 5–10 ms / 8–16 ms |
| duplicate_burst (20/s within 40 m) | 300 | **0** | 0 | 0 | 19.9 /s | 12–15 ms / 19–28 ms |
| failure_recovery (consumer stopped, 100 events) | 100 | **0** | 0 | 0 | 6.1–6.9 /s | see below |

- **Deduplication.** In round 1 (empty database), `duplicate_burst` turned 300 reports within
  40 m into 5 hazards (295 merged).
- **Round order matters.** Later rounds reused the database, so more reports merged into hazards
  left by earlier rounds. For example, `duplicate_burst` created 0 new hazards in rounds 2 and 3.
  "Lost" and "HTTP errors" are unaffected. For created-vs-merged counts, quote round 1 or reset
  the database per scenario.
- **Workload mix.** The confirmation share was within tolerance in all 15 runs.

### Fault tolerance (Objective 4)

The report consumer was stopped, 100 reports were submitted, and all 100 were confirmed still
queued in Kafka. The consumer was then restarted.

| Round | Lost | Duplicate hazards from redelivery | Backlog drained after restart |
|---|---|---|---|
| 1 | 0 | 0 | 2.9 s |
| 2 | 0 | 0 | 1.1 s |
| 3 | 0 | 0 | 1.7 s |

The processing latency of these reports (median 9–11 s, p95 13–16 s) is dominated by the time
the consumer was deliberately stopped. It is not a processing cost. "Distinct hazards" can
exceed "created" because some reports merged into hazards left from earlier scenarios, not
because a report was processed twice.

## 3. HTTP load (k6, 3 runs each)

| Test | Load | Requests per run | Failed | p95 (all) | p95 submit |
|---|---|---|---|---|---|
| normal-load | 20 users, 2 min | ~2,800 (23 /s) | 0 % | 28–69 ms | 14–35 ms |
| high-load | 50 reports/s + 100 reads/s, 2 min | 18,200 (129 /s) | 0 % | 8–47 ms | 4–9 ms |
| stress | ramp to 500 users, 4.5 min | 53,099 (176 /s) | 0 % | 4.5–5.1 ms | 4.3–4.9 ms |
| polling baseline | 200 clients polling every 3 s, 2 min | ~8,080 (61 /s) | 0–0.6 % | 86–129 ms | — |

All k6 thresholds passed. Submissions are fast because the API only records the report and
returns 202; processing happens afterwards.

**Processing capacity.** After the stress and high-load tests, about 11,800 reports were still
queued in Kafka. They drained at about **125 reports/s** (7,500 in one minute) once the load
stopped. Accepting reports faster than that grows a backlog. Nothing is lost, but new hazards
reach the map late. This is the decoupling working as designed, and the processing rate is the
number to size a deployment by.

## How to reproduce

```bash
docker exec saferoute-postgres psql -U saferoute -d saferoute -c "CREATE DATABASE saferoute_bench;"
cd backend && DB_NAME=saferoute_bench SPRING_PROFILES_ACTIVE=benchmark ./mvnw spring-boot:run
# register mod@saferoute.local (benchmark/README.md §1), then from benchmark/:
node simulator/latency-compare.mjs --events 50 --gap 2000   # on an idle system, before any k6 run
node simulator/simulate.mjs <scenario>
k6 run k6/normal-load.js   # etc.
```

Run the latency comparison first, or wait until the Kafka consumer lag is 0. Keep the laptop
awake with the lid open. Raw JSON and k6 summaries for this run are in
`benchmark/results/run-20260927/` on the machine that produced them (git-ignored).
