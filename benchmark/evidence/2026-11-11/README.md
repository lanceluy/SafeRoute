# SafeRoute benchmark evidence, 11 November 2026

Both benchmarks used backend revision `eac9e3cb053f31275e816fe802519c672e4c9f2c` and the same backend image. The host was an Apple M4 Mac with 16 GiB RAM. Docker allocated 10 CPUs and 7.75 GiB to its VM. The local stack used one Spring Boot backend, one Kafka broker, and PostgreSQL/PostGIS. The benchmark profile disabled rate limiting. The load generators ran on the same Mac as the backend.

## WebSocket concurrency

Native k6 opened one socket per virtual user. After the 60-second ramp, the harness checked the server's active-session gauge before submitting four distinct hazard reports, 10 seconds apart. Latency runs from the client sending a report to a listener receiving the matching hazard event. The delivery deadline was 30 seconds.

| Concurrent sockets | Unique deliveries | Per-client median / p95 | Time to reach all clients, four reports | Median incremental backend memory/socket | Backend CPU mean / sampled peak |
|---:|---:|---:|---:|---:|---:|
| 2,000 | 8,000 / 8,000 | 83 / 346 ms | 373, 130, 107, 128 ms | 247.1 KiB | 7.3% / 38.2% |
| 5,000 | 20,000 / 20,000 | 243 / 533 ms | 588, 584, 304, 336 ms | 161.5 KiB | 15.4% / 165.0% |

Each load level ran once. Both runs had zero missing, late, or duplicate deliveries. Each has 29 idle baseline samples and 30 samples in the loaded window. Incremental memory is the difference between median backend Docker memory under load and its median idle baseline, divided by observed connections. The baseline and JVM state can vary between runs. CPU percentages are the Docker CLI's aggregate backend values and can exceed 100% across cores. The sampled peaks may miss shorter bursts.

- [2,000 sockets](ws-2000/analysis.json)
- [5,000 sockets](ws-5000/analysis.json)

## Delivery-channel comparison

The Node 22 harness ran on the same Docker network as the backend. All seven variants were active together, with 20 clients per variant and 30 hazard reports. Each variant detected 600 of 600 expected updates without recorded misses or errors.

| Variant | Median / p95 detection latency | Mean recorded response body per client | HTTP 304 share |
|---|---:|---:|---:|
| WebSocket | 34.9 / 52.2 ms | Unmeasured | — |
| SSE | 26.9 / 42.9 ms | 11,639 | — |
| Long polling | 32.0 / 48.5 ms | 12,841 | — |
| Plain polling, 1 s | 581.2 / 996.7 ms | 701,164 | — |
| Plain polling, 3 s | 1,500.9 / 2,888.6 ms | 235,070 | — |
| ETag polling, 1 s | 494.2 / 972.5 ms | 305,796 | 54.3% |
| ETag polling, 3 s | 1,575.9 / 2,851.1 ms | 202,584 | 8.2% |

The harness counts JavaScript response string lengths for polling and long polling, and stream bytes for SSE. Those counters exclude HTTP headers and transport overhead. ETags reduced the recorded body volume by 56.4% at 1 s and 13.8% at 3 s. This run provides no per-channel CPU measurements.

[Measured delivery results and raw observations](delivery/measured.json) · [Smoke results](delivery/smoke.json)

## Verify and reproduce

From this directory, verify archived files with `shasum -a 256 -c SHA256SUMS`. Local home paths were redacted in console logs and environment notes. To recompute the WebSocket tables from the original k6 output and Docker samples:

```bash
scratch="$(mktemp -d)"
for n in 2000 5000; do
  gzip -dc "ws-$n/raw.json.gz" > "$scratch/raw-$n.json"
  python3 harness/analyze.py --raw "$scratch/raw-$n.json" \
    --resources "ws-$n/resources.jsonl" --connections "$n" \
    --events 4 --out "$scratch/analysis-$n.json" >/dev/null
  cmp "ws-$n/analysis.json" "$scratch/analysis-$n.json"
done
```

For a fresh run, use a separate checkout of the recorded backend revision. From that checkout's root, set `evidence_dir` to this directory's absolute path, then start the isolated test stack with the recorded overlays:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
docker compose -p saferoute-icbim -f infra/docker-compose.yml \
  -f "$evidence_dir/harness/compose.local.yml" \
  -f "$evidence_dir/harness/compose.verbose.local.yml" \
  --profile with-backend up -d --build --wait postgres kafka backend
```

For the k6 run, register two fresh local test accounts at `POST /api/auth/register` and save their access tokens in a private JSON file with `reporterToken` and `listenerTokens` (an array). Set `auth_file` to that file and `run_dir` to a fresh output directory, using absolute paths for both. Choose a shell file-descriptor limit of at least the target plus 512, within the host's hard limit. In one terminal, start the monitor and collect 60 seconds with zero active sessions:

```bash
python3 "$evidence_dir/harness/monitor.py" --base http://127.0.0.1:18080 \
  --backend saferoute-icbim-backend \
  --containers saferoute-icbim-backend saferoute-icbim-kafka saferoute-icbim-postgres \
  --out "$run_dir/resources.jsonl"
```

Then run k6 in a second terminal. Use a fresh output directory for each load level, stop the monitor when k6 exits, and apply the analyzer as above.

```bash
n=2000 # repeat with 5000
k6 run --out "json=$run_dir/raw.json" \
  -e BASE_URL=http://127.0.0.1:18080 -e "AUTH_FILE=$auth_file" \
  -e "SUMMARY_FILE=$run_dir/summary.json" -e "CONNECTIONS=$n" -e EVENTS=4 \
  -e RAMP_SECONDS=60 -e EVENT_GAP_SECONDS=10 -e EVENT_TIMEOUT_SECONDS=30 \
  "$evidence_dir/harness/saferoute-ws.js"
```

For delivery comparison, from the clean source checkout run the existing simulator as a Node 22 client on the benchmark network. Preserve the tracked `.gitkeep` in the writable results mount so the simulator sees a clean checkout:

```bash
out="$(mktemp -d)"
cp benchmark/results/.gitkeep "$out/.gitkeep"
docker run --rm --network saferoute-icbim_default \
  --mount "type=bind,source=$PWD,target=/work,readonly" \
  --mount "type=bind,source=$out,target=/work/benchmark/results" \
  --workdir /work -e SAFEROUTE_URL=http://backend:8080 \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/work \
  node:22-bookworm node benchmark/simulator/latency-compare-all.mjs \
  --clients 20 --events 30 --gap 2000
```

## Backend verification

The full Maven backend suite completed on 11 November 2026 using Java 21 and Docker. Maven reported 139 tests, 0 failures, 0 errors, 0 skipped, and `BUILD SUCCESS`.

## Evidence scope

The local runs establish delivery at the tested connection counts and a comparison of the seven delivery variants on this stack. Repeated trials, a separate load-generator host, multi-backend or multi-broker tests, a no-Kafka baseline, and APNs tests are outside this evidence set. The original Makati routing dataset and script remain unverified. See the [routing recovery note](routing-recovery.md).
