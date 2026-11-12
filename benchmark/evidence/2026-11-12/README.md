# SafeRoute evidence follow-up, 12 November 2026

This record supplements the published ICBIM paper. New measurements are
identified by their benchmark conditions and archive paths.

| Audit item | Evidence and remaining gap |
|---|---|
| 1. Container memory | The first archived M4 runs measured median baseline → loaded memory of **0.641 → 1.112 GiB** at 2,000 sockets and **1.188 → 1.958 GiB** at 5,000. The measured median baseline-to-loaded increments were 247.1 and 161.5 KiB per socket. The ten later 5,000-socket trials ranged from 2.73 to 76.76 KiB per socket as the baseline shifted on a continuously running backend. Exact source records for the paper's memory figures remain unavailable. |
| 2. CPU | The first archived M4 runs measured median / mean / sampled peak of **2.97% / 7.28% / 38.21%** at 2,000 and **3.98% / 15.39% / 164.95%** at 5,000. CPU uses Docker's aggregate scale, on which 100% represents one CPU core. The ten later 5,000-socket trials had per-run medians of **3.04–4.75%**. |
| 3. Sole backend shutdown | **100/100** observed clients disconnected before restart. See the raw records and protocol below. |
| 4. Setup B conditions | The 11 November archive records one backend, one Kafka broker, local load generation on the Apple M4 Mac, and the `docker,benchmark` profiles. The benchmark profile disables rate limiting. The database contents and rate-limit state of the exact published Setup B runs remain unverified. |
| 5. Three-second polling ratio | The later benchmark notes give 1,217–1,330 ms polling and 60–68 ms WebSocket medians across three runs. Dividing the lower polling endpoint by the upper WebSocket endpoint gives **17.9×** as a conservative bound. The actual minimum paired ratio cannot be recovered from the ranges alone. The reported idle aggregate gives 1,441 / 26 = **55.4×**. |
| 6. Eight published comparison runs | The benchmark notes identify two idle empty-database runs, three idle populated-database runs (about 77,000 hazards), and three busier runs. The notes associate the first two groups with `d57c22e` and the last group with `d35d78c`. The exact eight raw files and their group assignments remain unavailable. |
| 7. Meaning of latency median | For each original archived tier, the median is across deliveries within one trial. The follow-up archive includes one run each at 100, 1,000, and 2,000 clients and ten at 5,000. Its 262.5 ms value is the median of the ten 5,000-client trial medians. |
| 8. Related work and Table II | See the source checks below. Protocol specifications support the underlying mechanisms. Timing, targeting, and background behavior also depend on deployment and implementation. |

Sources for items 1, 2, 4 and 7 are the [11 November evidence](../2026-11-11/README.md)
and its per-trial analyses. Items 5 and 6 use the
[benchmark notes](../../../docs/BENCHMARK_RESULTS.md#1-event-driven-notification-vs-polling-objective-4).

## Single backend shutdown

On 12 November 2026 the local k6 client opened 100 WebSockets using one
synthetic listener account. The server's active-session gauge returned
100 on three consecutive checks about one second apart. The test then
issued `docker stop` to the isolated backend container, confirmed that
it was stopped, and restarted it. This used backend image
`sha256:d226d489620aab7be07b3bb7f4508896db47df5e86fd4a94de8be0752e47b165`.

All 100 unique listeners logged a socket error and a close event after
the stop command began and before restart. No listener reached its
client-side timeout. Time from the start of the stop command to the
first, median, and last close was **607, 609, and 610 ms**, respectively.
The health endpoint first reported `UP` **5.29 s** after the restart
command began. The test did not exercise reconnect behavior.

- [Result and timestamps](backend-stop/result.json)
- [Raw k6 points](backend-stop/k6.jsonl.gz)
- [k6 console log](backend-stop/k6.log)

To reproduce from the repo root on a running isolated benchmark stack:

```bash
python3 benchmark/simulator/backend-stop.py --clients 100 \
  --out "benchmark/results/backend-stop-$(date +%Y%m%d-%H%M%S)"
```

## Related work and Table II source checks

| Paper reference | What the source supports |
|---|---|
| [2], [3], [8]–[11] | FloodPatrol's crowdsourced flood-level reports, WalkRollMap's 897 reports with 53% categorized as hazards, Waze's driver hazard reporting, Project Sidewalk's imagery-based sidewalk accessibility labeling and quality evaluation, NYC311's service-request status lookup, and OpenStreetMap-based pedestrian route personalization. [FloodPatrol](https://doi.org/10.1109/ICITCS.2014.7021800) · [WalkRollMap](https://doi.org/10.3389/fresc.2023.1023582) · [Waze](https://support.google.com/waze/answer/13739290) · [Project Sidewalk](https://doi.org/10.1145/3290605.3300292) · [NYC311](https://portal.311.nyc.gov/check-status/) · [Pedestrian routing](https://doi.org/10.3390/s18113794) |
| [17]–[22] | Prior push/pull comparisons, conditional GET and 304 responses, holding requests open in long polling, one-way server event streams, and bidirectional WebSockets. The standards do not prescribe a universal latency bound or SafeRoute's targeting behavior. [AJAX comparison](https://doi.org/10.1109/WSE.2007.4380239) · [Open Data comparison](https://doi.org/10.1007/978-3-030-50578-3_7) · [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.2) · [RFC 6202](https://www.rfc-editor.org/rfc/rfc6202) · [WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html) · [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455) |
| [23], [24] | Apple documents device-token addressing and conditional delivery of background updates. The WebSocket background-navigation row is specific to SafeRoute and remains unverified in an iPhone test. 3GPP specifies cell-area broadcast. That limits targeting granularity but does not by itself restrict the subject matter of a message. [APNs request](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) · [Apple background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app) · [3GPP TS 23.041](https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=748) |

These checks cover the cited comparison claims and protocol rows. They
are not a line-by-line audit of the full bibliography.

## Routing evidence

The [Setup C replacement experiment](../setup-c-replacement/README.md)
archives a deterministic 300-trip simulation on the 2 October Makati
street extract. The October 30 extract, script, and raw outputs for the
published 22–42% figure and Tables VI and VII remain unverified.
