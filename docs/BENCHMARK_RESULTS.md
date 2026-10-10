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

## 4. Re-check after later changes (10 October 2026)

Source revision `d35d78c` (the 27–28 September measurements above are unchanged). Same laptop and
Docker setup, an empty `saferoute_bench` database, rate limiting off. Chrome and the Docker VM were
busy on the laptop (load average 4–5; the 15-minute average had been 14 after an iOS build and test
runs just before), so this was **not** an idle system.

### 4.1 Latency comparison, 3 more runs (50 events each)

| Client | Median (3 runs) | p95 (3 runs) |
|---|---|---|
| WebSocket (event-driven) | **60–68 ms** | 88–106 ms |
| Polling every 1 s | 541–621 ms | 951–1,037 ms |
| Polling every 3 s | 1,217–1,330 ms | 2,838–2,904 ms |
| Polling every 5 s | 2,277–2,959 ms | 4,550–4,922 ms |

Every client detected all 150 hazards; none were missed. The WebSocket median is higher than the
26 ms in section 1. To find out whether code changes caused that, the same benchmark was run on two
earlier revisions, each on its own fresh database:

| Revision | WebSocket median, 2 runs |
|---|---|
| `45cecef` (28 Sept, when 26 ms was measured) | 64 ms and 39 ms |
| `edc09c2` (start of this session) | 55 ms and 61 ms |
| `d35d78c` (current) | 68, 61 and 60 ms |

The old code is just as slow today, so the difference is the machine's state and not a regression.
Run-to-run spread on identical code is also large (39 to 64 ms), and the first run after a backend
start tends to be the slowest. **For the paper, quote a range (about 25–70 ms median depending on
laptop load) or these runs, not the 26 ms figure alone.** The comparison with polling holds either
way: the event-driven path is about 8–10× faster than 1 s polling and about 19–22× faster than 3 s
polling at the median (it was 17× and 55× against the 26 ms figure).

### 4.2 Road-closure fan-out (`closure-fanout.mjs`, 3 rounds)

A moderator blocks and then lifts 20 short roads per round. 50 commuter sockets sit within about
150 m of the road and 20 sit about 11 km away. Latency is measured from just before the HTTP call
to the frame's arrival at the socket.

| | Result |
|---|---|
| Frames delivered to nearby sockets | **6,000 of 6,000** (3 rounds × 20 closures × 50 sockets × create and lift), 0 missed, 0 duplicated |
| Frames delivered to distant sockets | **0** |
| Create → frame, median | 27.0–28.3 ms (p95 38–48 ms) |
| Lift → frame, median | 29.6–36.4 ms (p95 38–46 ms) |
| Slowest frames | 476–483 ms: the first closure of round 1, to all 50 of its sockets (one slow event, not 50 independent delays). Every other frame in all 3 rounds was under 64 ms |
| HTTP call itself (round 1) | create median 18 ms, lift 23 ms |

So a closure reaches every commuter within range in tens of milliseconds, and reaches nobody
outside it.

### 4.3 Archive job under load (`archive-job.mjs`, 3 rounds)

The backend was started with `SAFEROUTE_HAZARD_ARCHIVE_AFTER=PT60S` and
`SAFEROUTE_HAZARD_ARCHIVE_CHECK_INTERVAL=PT5S` (the real defaults are 7 days and 10 minutes).
Each round created 400 hazards at 20 per second, so the job needed two of its 200-hazard batches.

| | Result (3 rounds) |
|---|---|
| Hazards archived | **400 of 400** every round, none missed |
| Wait past the deadline, median | 2.6–2.9 s (p95 about 5.0 s, max 5.3 s), bounded by the 5 s check interval |
| Archiving speed | 19–25 hazards per second (the run takes 16–21 s end to end) |
| Commuter read (`GET /hazards/nearby`), p95 | 35–37 ms while archiving; no errors in any phase |

Read latency was 9–11 ms median before any load, then 25–31 ms in every later phase: while
creating, while archiving and after. The archiving phase is no slower than the phases without it,
so the step up is consistent with the 1 km result growing to its 250-hazard cap and not with
archiving itself. The measurement does not isolate that cause, though.

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
