#!/usr/bin/env bash
# Starts N backend instances (separate JVMs) on ports BASE..BASE+N-1 against the same Postgres and
# Kafka, for the horizontal-scaling experiment. Each gets its own notification consumer group so
# every instance sees every hazard event and can fan out to the WebSocket sessions it owns.
#
#   benchmark/scripts/start-instances.sh [N=2] [BASE_PORT=8080]
#   node benchmark/simulator/ws-scale.mjs --targets http://localhost:8080,http://localhost:8081 --pids $(cat benchmark/results/instances.pids)
#   benchmark/scripts/stop-instances.sh
#
# Postgres + Kafka must already be up (docker compose -f infra/docker-compose.yml up -d postgres kafka,
# or infra/docker-compose.kafka-cluster.yml with KAFKA_BOOTSTRAP_SERVERS set). Extra profiles can be
# stacked with PROFILES=benchmark,benchmark-ratelimit. HEAP sets -Xmx per instance (default 1g).
set -euo pipefail
N="${1:-2}"
BASE="${2:-8080}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
cd "$ROOT/backend"
[ -f target/saferoute-backend.jar ] || ./mvnw -q -DskipTests package
mkdir -p "$ROOT/benchmark/results/instances"
: > "$ROOT/benchmark/results/instances.pids"
for i in $(seq 0 $((N - 1))); do
  port=$((BASE + i))
  SPRING_PROFILES_ACTIVE="${PROFILES:-benchmark}" \
  SAFEROUTE_NOTIFICATION_PER_INSTANCE_GROUP=true \
  SAFEROUTE_NOTIFICATION_OFFSET_RESET=latest \
  DB_NAME="${DB_NAME:-saferoute_bench}" \
  nohup "$JAVA_HOME/bin/java" -Xmx"${HEAP:-1g}" -jar target/saferoute-backend.jar --server.port="$port" \
    > "$ROOT/benchmark/results/instances/backend-$port.log" 2>&1 &
  echo $! >> "$ROOT/benchmark/results/instances.pids"
  echo "instance $i: port $port pid $!"
done
# --pids wants a comma list
paste -sd, "$ROOT/benchmark/results/instances.pids" > "$ROOT/benchmark/results/instances.pids.tmp" && mv "$ROOT/benchmark/results/instances.pids.tmp" "$ROOT/benchmark/results/instances.pids"
for i in $(seq 0 $((N - 1))); do
  until curl -sf "http://localhost:$((BASE + i))/actuator/health" > /dev/null; do sleep 2; done
  echo "port $((BASE + i)) healthy"
done
