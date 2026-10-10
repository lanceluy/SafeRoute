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

2. **Municipal web portal and analytics: now implemented, but not as a separate service** (p. 6, 7, 12, 13). `portal/` is a React + TypeScript web app (Vite) for moderators and municipal officials:
   - an active-hazard map with clustering and density/severity heatmaps
   - a moderation queue with filters, sorting and search
   - resolve / reopen / remove, with required removal reasons
   - department assignment and a municipal priority kept separate from severity
   - bulk actions, saved views, and CSV/PDF export
   - an Overview dashboard, Analytics (reports vs resolved, backlog, resolution time), and an Activity page built on the audit log

   There is no separate "Municipal Analytics Service". The statistics come from read-only endpoints in the same Spring Boot application (`/api/moderation/stats`, `/api/moderation/activity`). The per-barangay numbers are computed in the browser from bundled OpenStreetMap boundaries. Suggested wording:
   > "A municipal web portal (React) gives officials an active-hazard map with heatmaps, a moderation queue, per-barangay statistics and trends, and an audit trail. Its statistics are served by read-only endpoints of the same Spring Boot backend rather than by a separate analytics service."

   Street names in the portal come from OpenStreetMap's public Nominatim service, so hazard coordinates are sent to a third party. Say so if the paper discusses privacy.

3. **"API gateway" → "Spring Boot REST API"** (p. 10, §3.1 phase 3). There is one Spring Boot API, not a separate gateway.

4. **One deployable application, not independent services** (p. 6: components "function independently"; p. 12: "Hazard Processing Service", "Notification Service"). Use:
   > "event-driven backend modules within a single Spring Boot application (a modular monolith), decoupled through Kafka topics and separate consumer groups."

   The processing and notification modules have separate consumer groups and can be stopped independently (the fault-tolerance test does exactly that), but they are deployed together.

5. **Not every write goes through Kafka.** Reports, confirmations, resolution votes and moderator resolution are Kafka commands processed asynchronously. Field edits, moderator reopen and remove, and the city response (department and priority) are synchronous database operations that then publish an outcome event. Describe both paths.

6. **Event names** (p. 12–13 use `hazard_confirmed`). The implemented topics are commands `hazard_reported`, `hazard_verified`, `hazard_resolution_requested`, `hazard_resolved`, and outcomes `hazard_created`, `hazard_updated`, `submission_processed`; failed records go to `<topic>.dlq`. Every message passes through a transactional outbox (committed with the state change, then published).

7. **Notifications: WebSocket first, APNs when configured** (p. 12: "WebSockets or push notifications"). Alerts reach a phone over the app's WebSocket while it's open or navigating. APNs push for users who opt into background alerts (approximate background location, kept 2 hours) is implemented, but it needs a paid Apple Developer account, so it's off by default. Reporters also get report updates when their report is assigned to a department, resolved, removed or expires: a WebSocket frame, or a push when configured. Staff sessions in the portal watch the whole pilot area through the same WebSocket. State which of these were demonstrated.

8. **IoT keyword** (p. 2). Remove "Internet of Things (IoT)" from the keywords, or add: *"SafeRoute does not require IoT sensing hardware in the current prototype."*

9. **CQRS and event sourcing.** If the literature review discusses them, add: *"The prototype does not implement CQRS or event sourcing: PostgreSQL holds current state and an audit log records changes, but state is not rebuilt from an event log."*

10. **Four vs five objectives** (p. 10: "the four research objectives listed in Section 1.5"; §1.5 lists five). Change to five and address all five.

11. **Coverage area.** State that the pilot accepts reports only inside the Metro Manila bounding box (`saferoute.coverage.*`), and that route assessments crossing its edge are reported as incomplete.

## Claims and evidence

12. **Unmeasured claims** (p. 2: "high resilience", "instantaneous map UI updates", "significantly decreased event processing latency"). Replace with measured statements from `node benchmark/simulator/report.mjs`, e.g.:
    > "In our local test environment (single Kafka broker, one laptop), median WebSocket notification latency was X ms (p95 Y ms, n = N over K runs), versus a median detection latency of … for clients polling every 3 seconds."

    Measured numbers are now in [`BENCHMARK_RESULTS.md`](BENCHMARK_RESULTS.md). Suggested wording:
    > "In our local test environment (one laptop, single Kafka broker), median WebSocket notification latency was 26 ms (p95 56 ms, n = 100 over 2 clean runs), versus 1,441 ms (p95 2,883 ms) for clients polling every 3 seconds. With the processing consumer stopped, 100 of 100 reports were retained and processed after restart (3 runs, 0 lost, backlog drained in 1–3 s). The backend processed about 125 reports/s; faster intake queued without loss."

    **Re-check, 10 Oct 2026:** three more runs on the current code, on a busier laptop, gave a WebSocket median of 60–68 ms (p95 88–106 ms) and 1,217–1,330 ms for 3 s polling. The same benchmark on the 28 Sept code gave 39–64 ms that day, so the difference is the machine's load, not the code (see [`BENCHMARK_RESULTS.md`](BENCHMARK_RESULTS.md) section 4). Quote a range ("about 25–70 ms median, depending on laptop load") or a single named run, and say what else was running. The speed-up over polling is about 8–10× at 1 s and 19–22× at 3 s in the re-check. Section 4 also has measured results for road-closure delivery (6,000 of 6,000 frames delivered to nearby sockets, none to distant ones, median about 30 ms) and the archive job (400 of 400 archived in each of 3 rounds).

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
| Road closures and the archive job (added after the paper) | `benchmark/simulator/closure-fanout.mjs` and `archive-job.mjs`; results in `BENCHMARK_RESULTS.md` section 4. |
| Synthetic hazard and user activity (p. 14) | `benchmark/simulator/simulate.mjs` (normal, rush hour, severe weather, duplicate burst, failure recovery). |
| Disabling a consumer to test recovery (p. 15) | `simulate.mjs failure_recovery` stops the report listener only — not the whole application, database or broker. Say so. |
| Municipal officials resolving hazards | A `MUNICIPAL_OFFICIAL` role can resolve/reopen/remove, assign departments and set priorities in the web portal; every action is audited. |
| Heatmaps, per-area statistics, trends (p. 6, 12) | In the portal: density and severity heatmaps, a per-barangay table, reported vs resolved, backlog, and resolution time by type. |
| Commuters informed of outcomes | Reporters are told when their report is assigned, resolved, removed or expires, and My Reports shows the assigned department. |
