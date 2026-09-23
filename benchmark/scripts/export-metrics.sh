#!/usr/bin/env bash
# Snapshot the SafeRoute research metrics from /actuator/prometheus into results/.
set -euo pipefail
URL="${SAFEROUTE_URL:-http://localhost:8080}"
OUT="$(cd "$(dirname "$0")/../results" && pwd)/metrics-$(date +%Y%m%d-%H%M%S).prom"
curl -sf "$URL/actuator/prometheus" | grep -E '^(saferoute_|process_cpu_usage|jvm_memory_used_bytes|hikaricp_connections_active|http_server_requests_seconds_count)' > "$OUT"
echo "Wrote $OUT"
grep -E '^saferoute_' "$OUT" | grep -vE '_bucket\{' 
