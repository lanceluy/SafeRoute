#!/usr/bin/env bash
# Stop or start the Hazard Processing consumer (fault-tolerance test, review §44).
#   ./stop-consumer.sh          # stop
#   ./stop-consumer.sh start    # start again
set -euo pipefail
URL="${SAFEROUTE_URL:-http://localhost:8080}"
EMAIL="${SAFEROUTE_MODERATOR_EMAIL:-mod@saferoute.local}"
ACTION="${1:-stop}"
TOKEN=$(curl -sf -X POST "$URL/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"${SAFEROUTE_MODERATOR_PASSWORD:-password123}\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -sf -X POST "$URL/api/admin/consumers/hazard-reported-processor/$ACTION" -H "Authorization: Bearer $TOKEN"
echo
