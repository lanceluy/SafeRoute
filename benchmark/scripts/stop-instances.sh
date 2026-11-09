#!/usr/bin/env bash
# Stops the instances started by start-instances.sh.
set -uo pipefail
F="$(cd "$(dirname "$0")/../.." && pwd)/benchmark/results/instances.pids"
if [ -f "$F" ]; then
  for pid in $(tr ',' ' ' < "$F"); do kill "$pid" 2>/dev/null || true; done
  rm -f "$F"
fi
