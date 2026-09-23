# SafeRoute performance metrics — definitions

Precise definitions for the terms the paper uses (review §45). Every latency is reported as
**average, median, p95, p99 and maximum** — never the average alone.

| Metric | Definition | Where it is measured |
|---|---|---|
| **Event processing latency** | Time from the API accepting a report (`hazard_reported` produced, `metadata.occurredAt`) to the hazard being persisted or merged (submission `processedAt`). | Server: `saferoute.hazard.processing.latency` timer. Client: `processedAt − createdAt` per submission in `simulate.mjs`. |
| **Notification delivery latency** | Time from the canonical hazard state being committed (outcome event `occurredAt`) to the WebSocket frame being written to a subscribed session. | Server: `saferoute.notification.delivery.latency` timer. |
| **End-to-end latency (event-driven)** | Time from the client sending `POST /api/hazard-submissions` to another client receiving the matching `hazard_created` frame. | `latency-compare.mjs` (single process, one clock). |
| **Polling detection latency** | Time from the client sending the report to the first `GET /api/hazards/nearby` response that contains the new hazard, for a client polling every 1 s, 3 s or 5 s. | `latency-compare.mjs`. |
| **Throughput** | Successfully processed hazard events per second: events reaching CREATED or MERGED ÷ (time from first submission to last submission becoming terminal). | `simulate.mjs` (`throughputPerSecond`). |
| **Error rate** | Failed requests or events ÷ total submitted (HTTP non-2xx on submit/confirm, plus submissions ending FAILED). | `simulate.mjs` (`errorRate`, `failed`); k6 `http_req_failed`. |
| **Recovery time** | Time from restarting a stopped consumer to its backlog being fully drained (every submission terminal). | `simulate.mjs failure_recovery` (`recoverySeconds`). |
| **Event loss** | Submitted events − successfully accounted-for events (submissions that never reach a terminal state). Success condition for fault tolerance: **0**. | `simulate.mjs` (`lost`). |
| **Duplicate side-effect rate** | Duplicate state mutations ÷ processed events, e.g. two hazards created for one submission after redelivery. Measured as `created − distinctHazards` for non-overlapping reports, and by the idempotency integration tests. | `simulate.mjs`, `KafkaReliabilityIntegrationTest`. |
| **Polling overhead** | HTTP requests made by polling clients, and the share that returned no change. | `latency-compare.mjs` (`httpRequests`, `wastedRequestRatio`); k6 `polling-baseline.js`. |
| **Resource utilisation** | JVM CPU (`process_cpu_usage`), heap (`jvm_memory_used_bytes`), DB pool (`hikaricp_connections_active`). | `benchmark/scripts/export-metrics.sh`. |

## Reporting rules

- State the environment next to every number (machine, Docker resources, single Kafka broker, local network).
- Word results as measurements, not guarantees: *"In our local test environment, median end-to-end WebSocket update latency was X ms under Y simulated users"* — not "instantaneous".
- The sample numbers in `benchmark/README.md` come from a short verification run; re-run with larger samples before quoting them in the paper.
