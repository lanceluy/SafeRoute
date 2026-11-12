# Setup C replacement experiment

This offline experiment uses the repository's 2 October 2026 OpenStreetMap
street extract, credited to OpenStreetMap contributors (ODbL). The paper's
reported 30 October extract and original outputs remain unavailable. The
results below apply to the replacement experiment.

## Method

The script builds an undirected graph from consecutive coordinates of
the stored street geometries, retaining edges with both endpoints in
the study box (14.540°–14.571° N, 121.010°–121.043° E). It joins equal
coordinates and samples from the largest connected component. This gave
6,000 nodes and 208.8 km of graph edges. The extract lacks OSM node IDs
and full pedestrian access and level tags, so joins and access cannot
be validated against a pedestrian routing graph. The experiment does
not use MapKit or the app's waypoint fallback.

The same 300 ordered start/end pairs, 400–1,500 m apart by straight-line
distance, are reused across settings and hazard seeds. A* finds the
shortest route. Repeated searches increase the weight on each prior
route's edges, allowing up to three distinct alternatives no longer
than twice the shortest path. Of the 300 trips, 296 had three
alternatives, three had two, and one had none.

At each of 50, 100 and 200 hazards, five seeds generated uniform
positions across the study box, 20% high/40% medium/40% low severity,
and approximately 15% disputed. Scoring uses the configured corridor
and half weight for disputed hazards, with ties resolved by route
length and candidate order. An encounter counts once per hazard per
trip within 10 m of a route. Avoidance is the share of shortest-route
encounters absent from the chosen route. Net reduction subtracts newly
encountered hazards from the avoided count, with the same denominator.
Added length averages the per-trip increase relative to the shortest
route, including unchanged trips.

## Routing results

Mean ± sample standard deviation over five hazard seeds. Distances are
route lengths, with no walking speeds measured. Percentages are rounded
to one decimal place. At 50 hazards, one seed had no baseline
high-severity encounters, so that statistic uses four seeds.

| Hazards | Corridor | Weights | Rerouted (%) | Encounters avoided (%) | High-severity encounters avoided (%) | Net encounter reduction (%) | Added length (%) |
|---:|---:|:---|---:|---:|---:|---:|---:|
| 50 | 40 m | 10/3/1 | 27.5 ± 6.0 | 72.3 ± 3.9 | 77.4 ± 27.9 | 61.1 ± 5.9 | 6.1 ± 1.8 |
| 100 | 20 m | 10/3/1 | 38.1 ± 5.9 | 82.5 ± 7.6 | 92.3 ± 14.5 | 65.0 ± 8.4 | 8.2 ± 1.8 |
| 100 | 40 m | 10/3/1 | 47.4 ± 7.4 | 71.5 ± 2.9 | 81.6 ± 18.7 | 47.5 ± 13.9 | 11.0 ± 2.8 |
| 100 | 60 m | 10/3/1 | 52.0 ± 5.0 | 63.1 ± 7.0 | 78.4 ± 18.3 | 29.6 ± 19.3 | 12.5 ± 1.7 |
| 100 | 40 m | 1/1/1 | 42.3 ± 5.3 | 68.0 ± 4.1 | 69.6 ± 26.1 | 51.9 ± 6.7 | 9.3 ± 2.0 |
| 200 | 40 m | 10/3/1 | 57.1 ± 3.5 | 62.2 ± 7.8 | 73.8 ± 14.6 | 29.9 ± 10.8 | 12.3 ± 0.5 |

## Merge-radius results

Each hazard generated five reports with independent Gaussian noise on
both coordinates. Hazards were assigned cyclically to five simulated
types. Reports were shuffled and joined to the closest same-type
cluster within the threshold of its first report. This models the
distance check without reporter confirmation. The split percentage is
the share of hazards assigned to more than one cluster. Wrong merges
are measured per report against the first report's ground-truth ID.

For 100 hazards, the share split was:

| GPS error per axis | Radius 20 m | Radius 30 m | Radius 40 m |
|:---|---:|---:|---:|
| 5 m | 8.0 ± 3.1% | 0.2 ± 0.4% | 0.0 ± 0.0% |
| 15 m | 96.2 ± 1.9% | 78.2 ± 2.9% | 46.4 ± 3.3% |

The archived output also covers 200 hazards and records the wrong-merge
rates. These results describe simulated report densities and noise.

## Reproduce

Run from the repository root with Python 3.9 or later:

```bash
archive=benchmark/evidence/setup-c-replacement
(cd "$archive" && shasum -a 256 -c SHA256SUMS)
python3 benchmark/sensitivity/makati.py --out benchmark/results/setup-c-makati.json
gzip -dc "$archive/results.json.gz" | cmp - benchmark/results/setup-c-makati.json
```

The result file records the input SHA-256, bounding box, candidate routes,
seeded hazards, per-trip outcome counts and per-seed summaries. A second
run on the benchmark Mac reproduced the archived output byte for byte.
