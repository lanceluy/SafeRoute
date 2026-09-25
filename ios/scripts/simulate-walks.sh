#!/usr/bin/env bash
# Walks the iOS Simulator's GPS along your route whenever you start navigation in SafeRoute,
# and stops you where you are when you end it. Between walks the location stays put.
#
#   ios/scripts/simulate-walks.sh [simulator-udid]      (default: the booted simulator)
#   SAFEROUTE_WALK_SPEED=3 ios/scripts/simulate-walks.sh   (m/s; default 1.4, a normal walk)
#
# Needs a Debug build of SafeRoute running in that simulator (see SimulatedWalk.swift).
set -euo pipefail

SIM="${1:-booted}"
SPEED="${SAFEROUTE_WALK_SPEED:-1.4}"
BUNDLE="com.saferoute.app"
last_id=""

echo "Watching SafeRoute on simulator '$SIM'. Start navigation in the app to walk (Ctrl+C to quit)."
while true; do
  container=$(xcrun simctl get_app_container "$SIM" "$BUNDLE" data 2>/dev/null || true)
  file="$container/Documents/simulated-walk.json"
  if [[ -n "$container" && -f "$file" ]]; then
    # id, state, then one "lat,lon" waypoint per line
    parsed=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(d["id"]); print(d["state"])
for lat, lon in d["points"]: print(f"{lat},{lon}")
' "$file" 2>/dev/null || true)
    id=$(sed -n 1p <<<"$parsed")
    if [[ -n "$id" && "$id" != "$last_id" ]]; then
      last_id="$id"
      state=$(sed -n 2p <<<"$parsed")
      points=$(sed -n '3,$p' <<<"$parsed")
      count=$(grep -c , <<<"$points" || true)
      if [[ "$state" == "walking" && "$count" -ge 2 ]]; then
        echo "$(date +%T) walking $count waypoints at ${SPEED} m/s"
        xcrun simctl location "$SIM" start --speed="$SPEED" --distance=3 - <<<"$points"
      elif [[ "$state" == "stopped" && "$count" -ge 1 ]]; then
        here=$(head -1 <<<"$points")
        echo "$(date +%T) stopped at $here"
        xcrun simctl location "$SIM" set "$here"
      fi
    fi
  fi
  sleep 1
done
