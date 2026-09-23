# SafeRoute

Event-driven crowdsourced pedestrian-hazard mapping and safe-navigation platform, built from
the CSS123P research proposal (`Grp3-CSS123P Project_ SafeRoute.pdf`). Commuters report
hazards from a native iOS app; a Kafka-driven Spring Boot backend deduplicates, classifies and
stores them in PostgreSQL/PostGIS, lets the community confirm, dispute and resolve them, and
pushes real-time, route-aware alerts back over WebSockets.

## Architecture

```
iOS app (SwiftUI / MapKit)
   │  REST (JWT access + refresh tokens)            WebSocket /ws/notifications
   ▼                                                        ▲
Spring Boot REST API ── rate limiting, authorization, validation                │
   │ publishes commands                                                       │
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

The processing and notification modules are **modules inside one Spring Boot application**
(a modular monolith), decoupled through Kafka and separate consumer groups — not separately
deployed microservices. There is no separate API gateway. The municipal web portal from the
paper is future work (see [`docs/PAPER_ALIGNMENT.md`](docs/PAPER_ALIGNMENT.md)).

### Hazard lifecycle

```
REPORTED ──(2 independent confirmations)──► VERIFIED
REPORTED/VERIFIED ──(≥2 disputes and disputes ≥ confirmations)──► DISPUTED ──► back when confirmations overtake
active ──(2 "no longer present" votes, or a moderator)──► RESOLVED
active ──(no confirmation within the type's window, e.g. flooding 12 h, manhole 7 d)──► EXPIRED
moderator: reopen RESOLVED/EXPIRED/REMOVED · remove false reports (REMOVED)
```

Reporters can't confirm or dispute their own report; each user holds one opinion per hazard.

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
JAVA_HOME=/opt/homebrew/opt/openjdk@21 SAFEROUTE_MODERATOR_EMAILS=mod@saferoute.local ./mvnw spring-boot:run
```

Flyway migrates the schema on startup (V1–V10). The API is at `http://localhost:8080`:

- **Swagger UI:** http://localhost:8080/swagger-ui.html · OpenAPI: `/v3/api-docs`
- **Health / metrics:** `/actuator/health`, `/actuator/metrics`, `/actuator/prometheus`
- **WebSocket:** `ws://localhost:8080/ws/notifications` (`Authorization: Bearer` header)
- **Kafka UI:** http://localhost:8081

Containerized alternative: `docker compose --profile with-backend up --build`.

Useful settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `SAFEROUTE_MODERATOR_EMAILS` | *(none)* | Accounts promoted to MODERATOR |
| `SAFEROUTE_COVERAGE_ENABLED` | `true` | Only accept reports inside the Metro Manila pilot area |
| `SAFEROUTE_RATE_LIMIT_ENABLED` | `true` | Disable only for load tests (`benchmark` profile does this) |
| `JWT_SECRET` | dev value | **Set a real secret outside local development** |

### Quick smoke test

```bash
# Register (returns an access token + a refresh token)
TOKEN=$(curl -s -X POST localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","password":"password123","displayName":"Alice"}' | jq -r .token)

# Report a hazard (Makati) → 202 with a submissionId, status QUEUED
SUB=$(curl -s -X POST localhost:8080/api/hazard-submissions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"OPEN_MANHOLE","latitude":14.5547,"longitude":121.0244,"severityAnswer":"IN_PATH"}' | jq -r .submissionId)

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
| `POST /api/hazard-submissions`, `GET /api/hazard-submissions/{id}` | Asynchronous reporting |
| `GET /api/hazards/nearby · in-bbox · {id} · {id}/history` | Queries (radius 50–5000 m, ≤250 results) |
| `PUT /api/hazards/{id}/confirmation` | VERIFY / DISPUTE (upsert, one per user) |
| `POST /api/hazards/{id}/resolution-confirmation` | NO_LONGER_PRESENT / STILL_PRESENT |
| `PATCH /api/hazards/{id}` | Reporter/moderator edits (audited) |
| `POST /api/hazards/{id}/resolve · reopen`, `DELETE /api/hazards/{id}`, `GET /api/moderation/hazards` | Moderator / municipal official only |
| `POST /api/uploads/hazard-image` | JPEG/PNG ≤5 MB, re-encoded, metadata stripped |
| `GET /api/me/reports · profile`, `GET/PUT /api/me/notification-preferences` | My Reports, profile, alert preferences |

### Tests

```bash
cd backend && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./mvnw test
```

65 tests: unit tests plus Testcontainers integration tests against real PostGIS and Kafka
(auth and token rotation, role enforcement, rate limiting, dedup merge paths, confirmation
rules, lifecycle/expiry, Kafka redelivery idempotency, dead-letter handling, uploads,
WebSocket alerts). Docker must be running.

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

App structure: **Map** (clustered hazard map, filters, destination search, safer-route
comparison, live alerts) · **Reports** (My Reports with processing outcome) · **Alerts** ·
**Profile** (trust level, contributions, notification preferences).

## Benchmarks

See [`benchmark/README.md`](benchmark/README.md) — event-driven vs polling latency, load
scenarios, fault-tolerance test — and [`docs/METRICS.md`](docs/METRICS.md) for definitions.

## Known limitations (prototype scope)

- Alerts are delivered while the app's WebSocket is connected, as local notifications — no APNs.
- Rate-limit buckets and WebSocket sessions are in memory (single backend instance).
- Outcome events are published after the DB commit; a transactional outbox would close the
  remaining crash window.
- The Simulator reaches `localhost`; a physical device needs the host's LAN IP in `APIConfig.swift`.
