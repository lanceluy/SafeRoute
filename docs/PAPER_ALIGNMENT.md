# Paper ↔ implementation alignment

Where the research paper (the 16-page proposal, *"SafeRoute: A Real-Time Event-Driven Java
Platform for Crowdsourced Pedestrian Hazard Mapping and Safe Navigation"*) and this repository
disagree, and what to change. Page numbers refer to that PDF. The code does not edit the paper;
the items below are edits to make in the paper.

## Unfinished template content

The proposal still contains template scaffolding that must be replaced before submission:

| Page | Issue | Fix |
|---|---|---|
| 1 | Heading "Research Template Guide: Event-Driven Programming" | Remove; keep only the SafeRoute title. |
| 4 | "Knowledge Gap: [E.g., … real-time traffic optimization.]" placeholder | Write SafeRoute's actual gap (pedestrian-level, location-specific, real-time hazard reporting in Metro Manila). |
| 6 | "Formulate your objectives using clear action verbs." instruction | Remove. |
| 7–9 | RRL sections are template instructions with example/hypothetical citations ("Hypothetical Citation", e-health examples, "[Your Specific Domain]") | Write the literature review; cite only sources you have read. |
| 8 | "Ford et al. (2022) – Building Event-Driven Microservices" | The book is by **Adam Bellemare** (O'Reilly). Correct or remove. |
| 15 | §3.4 repeats the same paragraph under Performance Metrics, Evaluation Procedure and Comparative Analysis | Write three distinct parts: metric definitions (see [`METRICS.md`](METRICS.md)), the step-by-step procedure, and the polling comparison design. |
| 16 | "This section lists all the academic works cited…" instruction; only three references | Remove the instruction; list every cited work and verify each one. |

## Platform and architecture wording

1. **iOS, not Android** (p. 12–13: "developed for Android using Java", "Mobile Development: Android Studio"). Replace with:
   > "SafeRoute uses a Java 21 + Spring Boot event-driven backend and a native SwiftUI iOS client. Java remains the core language for backend event processing, Kafka consumers/producers, business logic, spatial orchestration and WebSocket delivery."

   Tools: *Mobile development: Xcode + SwiftUI · Mapping: Apple MapKit.*

2. **Municipal web portal and analytics → future work** (p. 6, 7, 12, 13). The prototype has no portal and no Municipal Analytics Service. Move the portal, heatmaps and statistics to Future Work:
   > "A municipal web portal (active-hazard map, heatmap, per-area counts and trends) is future work. The prototype already models municipal officials as a role that can resolve and reopen hazards through the API, and every such action is audited."

   If the paper is graded as a fixed specification, a minimum portal would be an active-hazard map with resolve/reopen actions (the API already supports them) — decide this with the team.

3. **"API gateway" → "Spring Boot REST API"** (p. 10, §3.1 phase 3). There is one Spring Boot API, not a separate gateway.

4. **One deployable application, not independent services** (p. 6: components "function independently"; p. 12: "Hazard Processing Service", "Notification Service"). Use:
   > "event-driven backend modules within a single Spring Boot application (a modular monolith), decoupled through Kafka topics and separate consumer groups."

   The processing and notification modules have separate consumer groups and can be stopped independently (the fault-tolerance test does exactly that), but they are deployed together.

5. **Not every write goes through Kafka.** Reports, confirmations, resolution votes and moderator resolution are Kafka commands processed asynchronously. Field edits, moderator reopen and remove are synchronous database operations that then publish an outcome event. Describe both paths.

6. **Event names** (p. 12–13 use `hazard_confirmed`). The implemented topics are commands `hazard_reported`, `hazard_verified`, `hazard_resolution_requested`, `hazard_resolved`, and outcomes `hazard_created`, `hazard_updated`, `submission_processed`; failed records go to `<topic>.dlq`. Every message passes through a transactional outbox (committed with the state change, then published).

7. **Notifications are connected-session only** (p. 12: "WebSockets or push notifications"). Alerts reach a phone while the app's WebSocket is connected and are shown as local notifications. There is no APNs push and no background location; say so.

8. **IoT keyword** (p. 2). Remove "Internet of Things (IoT)" from the keywords, or add: *"SafeRoute does not require IoT sensing hardware in the current prototype."*

9. **CQRS and event sourcing.** If the literature review discusses them, add: *"The prototype does not implement CQRS or event sourcing: PostgreSQL holds current state and an audit log records changes, but state is not rebuilt from an event log."*

10. **Four vs five objectives** (p. 10: "the four research objectives listed in Section 1.5"; §1.5 lists five). Change to five and address all five.

11. **Coverage area.** State that the pilot accepts reports only inside the Metro Manila bounding box (`saferoute.coverage.*`), and that route assessments crossing its edge are reported as incomplete.

## Claims and evidence

12. **Unmeasured claims** (p. 2: "high resilience", "instantaneous map UI updates", "significantly decreased event processing latency"). Replace with measured statements from `node benchmark/simulator/report.mjs`, e.g.:
    > "In our local test environment (single Kafka broker, one laptop), median WebSocket notification latency was X ms (p95 Y ms, n = N over K runs), versus a median detection latency of … for clients polling every 3 seconds."

    The earlier sample numbers in `benchmark/README.md` came from instruments that have since been corrected (confirmations were never generated; polling detections depended on the WebSocket client; failed reports counted as throughput). Re-run the experiments and quote only new, saved results.

13. **Evidence per objective.**
    - *Objective 1 (requirements):* synthetic events do not analyze commuter reporting gaps — cite a desk study, interviews or observations.
    - *Objective 2 (architecture):* deployment boundaries, event contracts and failure semantics (outbox, idempotent consumers, dead-letter topics).
    - *Objective 3 (prototype):* demonstrated workflows; state the bounds of routing (MapKit walking directions, heuristic hazard scoring, waypoint detours as a last resort).
    - *Objective 4 (evaluation):* corrected instruments, reproducible raw results, repeated runs with percentiles.
    - *Objective 5 (guidelines):* lessons tied to measured trade-offs and observed failures.

14. **Scope of conclusions.** Laptop notification timings do not show injury reduction, accessibility gains, city-wide scalability or commuter adoption. The contribution is an evaluated engineering prototype.

## Already consistent with the code

| Paper claim | Status |
|---|---|
| "With rate limiting" (p. 6) | Implemented (Bucket4j): login 5 failures/10 min/IP, register 3/h/IP, reports 10/h/user, confirmations 60/h, resolution votes 20/h, uploads 10/h; HTTP 429 + `Retry-After`. The benchmark profile disables it on purpose — report that. |
| Comparison against polling (p. 6, 15) | `benchmark/simulator/latency-compare.mjs` and `k6/polling-baseline.js`. |
| Synthetic hazard and user activity (p. 14) | `benchmark/simulator/simulate.mjs` (normal, rush hour, severe weather, duplicate burst, failure recovery). |
| Disabling a consumer to test recovery (p. 15) | `simulate.mjs failure_recovery` stops the report listener only — not the whole application, database or broker. Say so. |
| Municipal officials resolving hazards | A `MUNICIPAL_OFFICIAL` role can resolve/reopen/remove via the API; there is no portal. |
