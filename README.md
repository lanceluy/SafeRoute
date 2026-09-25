## SafeRoute Architecture

```
iOS app (SwiftUI / MapKit)
   │  REST (JWT access + refresh tokens)            WebSocket /ws/notifications
   ▼                                                        ▲
Spring Boot REST API ── rate limiting, authorization, validation                │
   │ publishes commands                                                       │
   ▼                                                                          │
Transactional outbox (committed with the change, then published)                       │
   ▼                                                                          │
Kafka  hazard_reported · hazard_verified · hazard_resolution_requested · hazard_resolved
   │                                   (retries → <topic>.dlq)                │
   ▼                                                                          │
Hazard Processing module ──► PostgreSQL + PostGIS                             │
 (idempotent: dedup, classify,      (hazards, submissions, confirmations,     │
  confidence/status, reputation,     votes, audit log, processed_events)      │
  expiry)                                                                     │
   │ publishes outcomes                                                       │
   ▼                                                                          │
Kafka  hazard_created · hazard_updated · submission_processed                 │
   ▼                                                                          │
Notification module (per-user preferences, proximity + route corridor) ───────┘
```

Every Kafka message is first written to an `outbox_events` table in the same transaction as the
state change that caused it, then published by a relay. A crash or a Kafka outage can delay a
message but never lose it, and an accepted report can't be marked FAILED just because the broker
was slow. Consumers are idempotent, so the at-least-once relay never double-applies an event.

The processing and notification modules are **modules inside one Spring Boot application**
(a modular monolith), decoupled through Kafka and separate consumer groups — not separately
deployed microservices. There is no separate API gateway. The municipal web portal from the
paper is future work (see [`docs/PAPER_ALIGNMENT.md`](docs/PAPER_ALIGNMENT.md)).

### Hazard lifecycle

```
REPORTED ──(2 independent confirmations)──► VERIFIED
new report of the same type within 30 m of an active hazard ──► merged into it (however old it is)
REPORTED/VERIFIED ──(≥2 disputes and disputes ≥ confirmations)──► DISPUTED ──► back when confirmations overtake
active ──(2 "no longer present" votes, or a moderator)──► RESOLVED
active ──(no confirmation within the type's window, e.g. flooding 12 h, manhole 7 d)──► EXPIRED
moderator: reopen RESOLVED/EXPIRED/REMOVED · remove false reports (REMOVED)
```

Reporters can't confirm or dispute their own report; each user holds one opinion per hazard.
Once anyone has confirmed, disputed or voted, the reporter can no longer change its type,
location or severity. Each hazard has a content revision: a command accepted against an older
revision (e.g. a vote cast before a moderator reopened it) is ignored.

## Prerequisites

- Java 21 (`brew install openjdk@21`) — use `JAVA_HOME=/opt/homebrew/opt/openjdk@21`
- Docker Desktop
- Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- Node ≥ 22 (benchmark simulator), optionally k6

## Running the backend

```bash
cp .env.example .env    # edit if you want non-default credentials — never commit .env
docker compose up -d postgres kafka kafka-ui
cd backend
JAVA_HOME=/opt/homebrew/opt/openjdk@21 SPRING_PROFILES_ACTIVE=dev \
  SAFEROUTE_MODERATOR_EMAILS=mod@saferoute.local ./mvnw spring-boot:run
```

The **`dev` profile is for a local machine only**: it accepts the public development JWT key when
`JWT_SECRET` is unset and promotes allowlisted emails to moderator without verifying them. Without
it the backend refuses to start unless `JWT_SECRET` is a private secret (≥ 32 bytes), and
moderators are provisioned by account id (`SAFEROUTE_MODERATOR_USER_IDS`).

Flyway migrates the schema on startup (V1–V11). The API is at `http://localhost:8080`:

- **Swagger UI:** http://localhost:8080/swagger-ui.html · OpenAPI: `/v3/api-docs`
- **Health / metrics:** `/actuator/health`, `/actuator/metrics`, `/actuator/prometheus`
- **WebSocket:** `ws://localhost:8080/ws/notifications` (`Authorization: Bearer` header)
- **Kafka UI:** http://localhost:8081

Containerized alternative: `docker compose --profile with-backend up --build`.

Useful settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `SAFEROUTE_MODERATOR_USER_IDS` | *(none)* | Account ids promoted to MODERATOR at startup (controlled provisioning) |
| `SAFEROUTE_MODERATOR_EMAILS` | *(none)* | Emails promoted to MODERATOR — honoured only by the `dev`/`benchmark` profiles |
| `SAFEROUTE_COVERAGE_ENABLED` | `true` | Only accept reports inside the Metro Manila pilot area |
| `SAFEROUTE_RATE_LIMIT_ENABLED` | `true` | Disable only for load tests (`benchmark` profile does this) |
| `JWT_SECRET` | *(none)* | Required outside the `dev` profile; startup fails without it |

### Quick smoke test

```bash
# Register (returns an access token + a refresh token)
TOKEN=$(curl -s -X POST localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","password":"password123","displayName":"Alice"}' | jq -r .token)

# Report a hazard (Makati) → 202 with a submissionId, status QUEUED. Repeating the request with
# the same clientRequestId returns the same submission (200) instead of creating another.
SUB=$(curl -s -X POST localhost:8080/api/hazard-submissions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"OPEN_MANHOLE","latitude":14.5547,"longitude":121.0244,"severityAnswer":"IN_PATH",
       "clientRequestId":"'$(uuidgen)'"}' | jq -r .submissionId)

# A moment later: CREATED (new hazard) or MERGED (matched an existing one), with the hazard id
curl -s localhost:8080/api/hazard-submissions/$SUB -H "Authorization: Bearer $TOKEN" | jq

# Every hazard endpoint requires the Bearer token
curl -s "localhost:8080/api/hazards/nearby?lat=14.5547&lon=121.0244" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Real-time path (`wscat` sends the header with `-H`):

```bash
wscat -H "Authorization: Bearer $TOKEN" -c ws://localhost:8080/ws/notifications
> {"type":"subscribe","lat":14.5547,"lon":121.0244}
> {"type":"route","route":[[14.5547,121.0244],[14.5600,121.0300]]}   # optional: on-route alerts
```

### Main endpoints

| | |
|---|---|
| `POST /api/auth/register · login · refresh · logout`, `GET /api/auth/me` | Auth (access 30 min, refresh 30 days, rotated) |
| `POST /api/hazard-submissions`, `GET /api/hazard-submissions/{id}` | Asynchronous, idempotent reporting (`clientRequestId`, `observedAt`) |
| `GET /api/hazards/nearby · in-bbox · {id} · {id}/history` | Queries (radius 50–5000 m, ≤250 results; `X-Result-Truncated` header on in-bbox) |
| `POST /api/hazards/along-route` | Every active hazard along candidate routes, with a `complete` flag (route assessment) |
| `PUT /api/hazards/{id}/confirmation` | VERIFY / DISPUTE (upsert, one per user) |
| `POST /api/hazards/{id}/resolution-confirmation` | NO_LONGER_PRESENT / STILL_PRESENT |
| `PATCH /api/hazards/{id}` | Reporter/moderator edits (audited) |
| `POST /api/hazards/{id}/resolve · reopen`, `DELETE /api/hazards/{id}`, `GET /api/moderation/hazards` | Moderator / municipal official only |
| `POST /api/uploads/hazard-image` | JPEG/PNG ≤5 MB, re-encoded, metadata stripped; only the uploader can attach it |
| `GET /api/meta/coverage · severity-questions · routing` | Client configuration (pilot area, severity questions, route corridor) |
| `GET /api/me/reports · profile`, `GET/PUT /api/me/notification-preferences` | My Reports, profile, alert preferences |

### Tests

```bash
cd backend && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./mvnw test
```

88 tests: unit tests plus Testcontainers integration tests against real PostGIS and Kafka
(auth, token rotation and concurrent refresh, moderator provisioning, role enforcement, rate
limiting, dedup merge paths, confirmation rules and vote provenance, lifecycle/expiry, idempotent
submissions, outbox crash recovery, Kafka redelivery idempotency, dead-letter handling, route
assessment completeness, uploads including EXIF GPS stripping, WebSocket alerts). Docker must be
running.

iOS unit tests (route assessment with injected directions/hazard sources, navigation progress and
hazard store, per-account offline queue and alerts, versioned map state):

```bash
cd ios && xcodegen generate
xcodebuild test -project SafeRoute.xcodeproj -scheme SafeRoute -destination 'platform=iOS Simulator,name=iPhone 17'
```

Benchmark instrument self-tests: `node --test benchmark/simulator/`.

## Running the iOS app

```bash
cd ios
xcodegen generate       # (re)generates SafeRoute.xcodeproj from project.yml — never edit the project by hand
open SafeRoute.xcodeproj
```

Run on an iOS Simulator with the backend running locally. Set the Simulator's location inside
the pilot area (**Features ▸ Location ▸ Custom Location…**, e.g. 14.5547, 121.0244).

Debug builds can log in automatically for demos: set `SAFEROUTE_DEMO_EMAIL`,
`SAFEROUTE_DEMO_PASSWORD` (and optionally `SAFEROUTE_DEMO_TAB`) in the scheme's environment.

Route planning asks MapKit for walking routes, then asks the backend for every hazard along them.
If that check fails or is incomplete (capped result, route leaves the pilot area) the app says so
and makes no "safer route" claim; it never shows an unchecked route as clear. MapKit's own
alternates are preferred; waypoint detours (which can pull walkers onto streets) are a last resort
for medium/high hazards and are assessed with their own query.

App structure: **Map** (search and filters on top; a mostly unobstructed, clustered hazard map;
one bottom panel that is either the nearby summary with a Report button, a selected hazard's
preview, the safer-route comparison or navigation) · **Reports** (My Reports with processing outcome) · **Alerts** ·
**Profile** (trust level, contributions, notification preferences).

## Benchmarks

See [`benchmark/README.md`](benchmark/README.md) — event-driven vs polling latency, load
scenarios, fault-tolerance test — and [`docs/METRICS.md`](docs/METRICS.md) for definitions.

## Known limitations (prototype scope)

- Alerts are delivered while the app's WebSocket is connected, as local notifications — no APNs
  and no background location. A suspended app gets no alerts.
- Rate-limit buckets and WebSocket sessions are in memory (single backend instance). Idle buckets
  are evicted. With several instances, the outbox relay avoids double-sends but not cross-instance
  reordering; clients apply hazard snapshots by version to cope.
- Route safety scoring is a transparent heuristic (HIGH 10 / MEDIUM 3 / LOW 1 per hazard within
  the corridor), not a validated model. Point buffers don't model flood extent, which side of the
  street a hazard is on, or footbridges above a road.
- EXPIRED means "no recent confirmation", not "repaired"; it drops off the map and out of routing.
- The Simulator reaches `localhost`; a physical device needs the host's LAN IP in `APIConfig.swift`.
- Attached hazard photos are public to anyone who can see the hazard. Metadata (including GPS) is
  stripped, but faces or plates in the picture are not blurred.
