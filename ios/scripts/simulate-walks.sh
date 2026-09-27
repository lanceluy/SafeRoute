#!/usr/bin/env bash
# Walks the iOS Simulator's GPS along your route whenever you start navigation in SafeRoute,
# and stops you where you are when you end it. Between walks the location stays put.
#
#   ios/scripts/simulate-walks.sh [simulator-udid]      (default: every booted simulator)
#   SAFEROUTE_WALK_SPEED=3 ios/scripts/simulate-walks.sh   (m/s; default 1.4, a normal walk)
#   SAFEROUTE_HOME=lat,lon ios/scripts/simulate-walks.sh   (default: Mapúa University Makati)
#
# Each simulator is put at SAFEROUTE_HOME when the script starts watching it, including ones
# booted later. Needs a Debug build of SafeRoute running there (see SimulatedWalk.swift).
set -euo pipefail

ONLY="${1:-}"
SPEED="${SAFEROUTE_WALK_SPEED:-1.4}"
HOME_LOCATION="${SAFEROUTE_HOME:14.566583,121.015167}"
BUNDLE="com.saferoute.app"
# Last walk id handled, one file per simulator (macOS bash 3.2 has no associative arrays).
state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT

booted() {
  if [[ -n "$ONLY" ]]; then echo "$ONLY"; return; fi
  xcrun simctl list devices booted -j | python3 -c '
import json, sys
for runtime in json.load(sys.stdin)["devices"].values():
    for d in runtime:
        if d.get("state") == "Booted": print(d["udid"], d["name"], sep="\t")
'
}

# id, state, then one "lat,lon" waypoint per line
parse() {
  python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(d["id"]); print(d["state"])
for lat, lon in d["points"]: print(f"{lat},{lon}")
' "$1" 2>/dev/null || true
}

watch() {
  local sim="$1" name="$2" container file parsed id walk points count here
  container=$(xcrun simctl get_app_container "$sim" "$BUNDLE" data 2>/dev/null || true)
  [[ -n "$container" ]] || return 0
  file="$container/Documents/simulated-walk.json"
  parsed=""
  [[ -f "$file" ]] && parsed=$(parse "$file")
  id=$(sed -n 1p <<<"$parsed")

  if [[ ! -f "$state/$sim" ]]; then
    # New to this run: skip whatever walk is already on file and start at home.
    echo "$id" >"$state/$sim"
    xcrun simctl location "$sim" set "$HOME_LOCATION"
    echo "$(date +%T) $name: watching, placed at $HOME_LOCATION"
    return 0
  fi
  [[ -n "$id" && "$id" != "$(cat "$state/$sim")" ]] || return 0
  echo "$id" >"$state/$sim"

  walk=$(sed -n 2p <<<"$parsed")
  points=$(sed -n '3,$p' <<<"$parsed")
  count=$(grep -c , <<<"$points" || true)
  if [[ "$walk" == "walking" && "$count" -ge 2 ]]; then
    echo "$(date +%T) $name: walking $count waypoints at ${SPEED} m/s"
    xcrun simctl location "$sim" start --speed="$SPEED" --distance=3 - <<<"$points"
  elif [[ "$walk" == "stopped" && "$count" -ge 1 ]]; then
    here=$(head -1 <<<"$points")
    echo "$(date +%T) $name: stopped at $here"
    xcrun simctl location "$sim" set "$here"
  fi
}

echo "Watching SafeRoute on ${ONLY:-every booted simulator}. Start navigation in the app to walk (Ctrl+C to quit)."
while true; do
  while IFS=$'\t' read -r sim name; do
    [[ -n "$sim" ]] && watch "$sim" "${name:-$sim}" </dev/null
  done < <(booted)
  sleep 1
done
