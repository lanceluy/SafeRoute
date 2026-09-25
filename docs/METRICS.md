# SafeRoute performance metrics — definitions

Precise definitions for the terms the paper uses. Every latency is reported as **average,
median, p95, p99 and maximum** — never the average alone — together with the number of samples.

| Metric | Definition | Where it is measured |
|---|---|---|
| **Event processing latency** | From the report being accepted (`hazard_reported` recorded, `metadata.occurredAt`) to the processing transaction that creates or merges the hazard committing. Successful outcomes only; FAILED submissions are reported separately as failure latency. | Server: `saferoute.hazard.processing.latency` (recorded after commit). Client: `processedAt − createdAt` per CREATED/MERGED submission in `simulate.mjs`. |
| **Notification delivery latency** | From the outcome being recorded (in the transaction that commits the new hazard state) to the WebSocket frame being **successfully written** to a session. Failed writes are counted in `saferoute.notification.delivery.failed`, not timed. A written frame is not proof the client displayed it. | Server: `saferoute.notification.delivery.latency`. |
| **End-to-end latency (event-driven)** | From the client sending `POST /api/hazard-submissions` to another client's first receipt of a frame for that hazard. | `latency-compare.mjs` (single process, one clock). |
| **Polling detection latency** | From the client sending the report to the first `GET /api/hazards/nearby` response (polled every 1, 3 or 5 s) containing that hazard. Measured independently of the WebSocket client: hazards are identified through the submission's own outcome. | `latency-compare.mjs`. |
| **Successful throughput** | Reports reaching CREATED or MERGED ÷ time from the first report sent to the last report reaching an outcome. FAILED and unresolved reports never count. | `simulate.mjs` (`successfulThroughputPerSecond`). |
| **Report error rate** | (HTTP errors on submit + FAILED outcomes + reports never resolved) ÷ reports offered. Confirmation errors are reported separately. | `simulate.mjs` (`reportErrorRate`, `confirmationErrorRate`). |
| **Recovery time** | From restarting a stopped consumer to its backlog being fully drained (every accepted submission terminal). | `simulate.mjs failure_recovery` (`recoverySeconds`). |
| **Event loss** | Accepted reports that never reach an outcome within the run's timeout. Success condition for fault tolerance: **0**. | `simulate.mjs` (`lost`). |
| **Duplicate side-effect rate** | Duplicate state mutations ÷ processed events, e.g. two hazards created for one submission after redelivery. | `simulate.mjs` (`distinctHazards`), `KafkaReliabilityIntegrationTest`. |
| **Workload mix** | Share of offered operations that were confirmations vs the configured ratio. A run outside ±5 percentage points (with ≥ 50 operations) is flagged and must not be reported as that scenario. | `simulate.mjs` (`workloadMix`). |
| **Polling overhead** | HTTP requests made by polling clients, the share that returned nothing new, and responses that hit the result cap (`fullPages`, which may hide hazards). | `latency-compare.mjs`; k6 `polling-baseline.js`. |
| **Outbox backlog** | Committed messages not yet acknowledged by Kafka, and the age of the oldest. Non-zero while Kafka is unavailable; should drain to 0. | `saferoute.outbox.pending`, `saferoute.outbox.oldest.pending.age.seconds`. |
| **Resource utilisation** | JVM CPU (`process_cpu_usage`), heap (`jvm_memory_used_bytes`), DB pool (`hikaricp_connections_active`). | `benchmark/scripts/export-metrics.sh`. |

## What the instruments do and don't measure

- The **benchmark profile disables rate limiting** (hundreds of simulated users share one IP). Results describe that configuration, not a rate-limited deployment.
- **k6 checks** mostly measure HTTP acceptance and query behaviour, not completion of asynchronous processing. Use `simulate.mjs` for outcomes.
- **failure_recovery** stops the report listener container only — not the whole application, the database or the broker.
- The nearby poll returns at most 250 hazards; `latency-compare.mjs` refuses runs above 200 events and reports capped responses.

## Reporting rules

- Save every run (`benchmark/results/*.json` holds the summary, the raw per-event observations and the exact source revision). Report numbers only from saved runs.
- Repeat each experiment (at least 3 runs) and report the spread, not one run.
- State the environment next to every number (machine, Docker resources, single Kafka broker, local network).
- Word results as measurements, not guarantees: *"In our local test environment, median end-to-end WebSocket update latency was X ms under Y simulated users"* — not "instantaneous".
