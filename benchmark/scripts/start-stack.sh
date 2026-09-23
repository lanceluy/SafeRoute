#!/usr/bin/env bash
# Starts Postgres+PostGIS and Kafka, then the backend with the benchmark profile
# (rate limiting off, consumer stop/start endpoint on, mod@saferoute.local as moderator).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker compose -f "$ROOT/docker-compose.yml" up -d postgres kafka
cd "$ROOT/backend"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export SPRING_PROFILES_ACTIVE=benchmark
export SAFEROUTE_MODERATOR_EMAILS="${SAFEROUTE_MODERATOR_EMAILS:-mod@saferoute.local}"
exec ./mvnw -q spring-boot:run
