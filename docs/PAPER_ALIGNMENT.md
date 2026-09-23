# Paper ↔ implementation alignment

The engineering review (§36–§50) found places where *Grp3-CSS123P Project_ SafeRoute.pdf* and
the codebase disagree. Code-side items are implemented; the items below are **edits to make in
the paper** (the PDF is not edited by the codebase). Suggested wording is included so the paper
and repository use the same terms.

## Already resolved in code

| Paper claim | Status |
|---|---|
| "With rate limiting" (§1.4) | Implemented (Bucket4j): login 5 failures/10 min/IP, register 3/h/IP, reports 10/h/user, confirmations 60/h, resolution votes 20/h, uploads 10/h. HTTP 429 + `Retry-After`. Tested (`AuthIntegrationTest`, `HazardQueryIntegrationTest`, `RateLimitServiceTest`). |
| Event-driven vs traditional polling comparison | Implemented: `benchmark/simulator/latency-compare.mjs` + `k6/polling-baseline.js`. |
| Synthetic hazard and user activity data | Implemented: `benchmark/simulator/simulate.mjs` (normal, rush hour, severe weather, duplicate burst, failure recovery). |
| Disabling a consumer to test recovery | Implemented: `simulate.mjs failure_recovery` with the consumer stop/start endpoint. |
| Municipal officials resolving hazards | A `MUNICIPAL_OFFICIAL` role exists and can resolve/reopen/remove via the API; there is no web portal (see below). |

## Edits to make in the paper

1. **iOS, not Android (§36).** Replace Android/Android Studio/Java-on-mobile references with:
   > "SafeRoute uses a Java 21 + Spring Boot event-driven backend and a native SwiftUI iOS client. Java remains the core language for backend event processing, Kafka consumers/producers, business logic, spatial orchestration, and WebSocket delivery."

   Development tools: *Mobile development: Xcode + SwiftUI · Mapping: Apple MapKit.*

2. **Municipal web portal → future work (§37).** The prototype has no portal. Move the portal, heatmaps and municipal statistics to Future Work:
   > "A municipal web portal (active-hazard map, heatmap, per-area counts and trends) is future work. The current prototype already models municipal officials as a role that can resolve and reopen hazards through the API, and every such action is audited."

   If the instructor grades the paper as a fixed specification, the minimum portal is listed in review §37 — decide this with the team.

3. **"API Gateway" → "Spring Boot REST API" (§38)** in the methodology text and architecture diagram. There is one Spring Boot API, not a separate gateway.

4. **Microservices wording (§39).** Replace "independent microservices" with:
   > "event-driven backend modules within a single Spring Boot application (a modular monolith), decoupled through Kafka topics and separate consumer groups."

   The Hazard Processing and Notification modules have separate consumer groups and can be stopped independently (that is what the fault-tolerance test does), but they are deployed together.

5. **CQRS and event sourcing (§48).** Keep them in the RRL, and add:
   > "The SafeRoute prototype does not implement full CQRS or event sourcing: PostgreSQL holds current state, and an audit log records changes, but state is not rebuilt from an event log."

6. **IoT keyword (§49).** Remove "Internet of Things (IoT)" from the keywords, or add: *"SafeRoute does not require IoT sensing hardware in the current prototype."*

7. **Five research objectives (§50).** Section 1.5 lists five; the methodology says "the four research objectives". Change every reference to five and make sure all five are addressed.

8. **Unmeasured claims (§47).** Replace "instantaneous", "significantly decreased latency", "high resilience", "inherently better" with measured statements from `node benchmark/simulator/report.mjs`, e.g.:
   > "In our local test environment (single Kafka broker, one laptop), median WebSocket notification latency was 49 ms (p95 68 ms), versus a median detection latency of 1.5 s (p95 3.0 s) for clients polling every 3 seconds."

   Re-run with larger samples before final submission.

9. **Architecture diagram.** Should show: iOS app → Spring Boot REST API + WebSocket → Kafka command topics (`hazard_reported`, `hazard_verified`, `hazard_resolution_requested`, `hazard_resolved`) → Hazard Processing module → PostgreSQL/PostGIS → outcome topics (`hazard_created`, `hazard_updated`, `submission_processed`) → Notification module → WebSocket. Dead-letter topics: `<topic>.dlq`.

10. **Coverage area (§51).** State that the pilot accepts reports only inside the Metro Manila bounding box (`saferoute.coverage.*`).
