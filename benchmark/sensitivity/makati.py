#!/usr/bin/env python3
"""Offline sensitivity experiment on the repository's Makati street extract."""
import argparse
from collections import Counter, defaultdict
import hashlib
import heapq
import json
import math
from pathlib import Path
import random
import statistics

# Central Makati study box (south, west, north, east).
BOX = (14.540, 121.010, 14.571, 121.043)
SEEDS = (1, 2, 3, 4, 5)
SETTINGS = ((20, (10, 3, 1)), (40, (10, 3, 1)), (60, (10, 3, 1)), (40, (1, 1, 1)))
DEFAULT = SETTINGS[1]


def graph(source):
    south, west, north, east = BOX
    points, ids = [], {}
    links = defaultdict(dict)
    meters_lon = 111195 * math.cos(math.radians((south + north) / 2))

    def index(coord):
        key = tuple(coord)
        if key not in ids:
            ids[key] = len(points)
            lat, lon = coord
            points.append(((lon - west) * meters_lon, (lat - south) * 111195))
        return ids[key]

    for way in source["ways"]:
        for a, b in zip(way["coords"], way["coords"][1:]):
            if a == b or not all(south <= lat <= north and west <= lon <= east for lat, lon in (a, b)):
                continue
            u, v = index(a), index(b)
            length = math.dist(points[u], points[v])
            links[u][v] = links[v][u] = length
    unseen = set(links)
    largest = []
    while unseen:
        first = min(unseen)
        unseen.remove(first)
        component = [first]
        for u in component:
            neighbors = sorted(unseen.intersection(links[u]))
            component.extend(neighbors)
            unseen.difference_update(neighbors)
        if len(component) > len(largest):
            largest = component
    if not largest:
        raise ValueError("No street graph in study box")
    return points, links, sorted(largest), (east - west) * meters_lon, (north - south) * 111195


def shortest(points, links, start, end, penalty):
    queue = [(math.dist(points[start], points[end]), 0, start)]
    cost, previous = {start: 0}, {}
    while queue:
        _, traveled, u = heapq.heappop(queue)
        if traveled != cost[u]:
            continue
        if u == end:
            path = [u]
            while u != start:
                u = previous[u]
                path.append(u)
            return tuple(reversed(path))
        for v, length in links[u].items():
            next_cost = traveled + length * (1 + penalty[min(u, v), max(u, v)])
            if next_cost < cost.get(v, math.inf):
                cost[v], previous[v] = next_cost, u
                heapq.heappush(queue, (next_cost + math.dist(points[v], points[end]), next_cost, v))
    raise ValueError("Disconnected endpoints")


def trips(points, links, nodes, count):
    rng = random.Random(20261030)
    pairs = set()
    output = []
    while len(output) < count:
        u, v = rng.sample(nodes, 2)
        if (u, v) in pairs or not 400 <= math.dist(points[u], points[v]) <= 1500:
            continue
        pairs.add((u, v))
        penalties = Counter()
        candidates, lengths = [], []
        for _ in range(8):
            route = shortest(points, links, u, v, penalties)
            edges = list(zip(route, route[1:]))
            penalties.update((min(a, b), max(a, b)) for a, b in edges)
            length = sum(links[a][b] for a, b in edges)
            if not lengths or (route not in candidates and length <= 2 * lengths[0]):
                candidates.append(route)
                lengths.append(length)
            if len(candidates) == 4:
                break
        output.append((candidates, lengths))
    return output


def segment_distance_sq(x, y, a, b):
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    along = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return (x - ax - along * dx) ** 2 + (y - ay - along * dy) ** 2


def nearby(points, route, hazards):
    matches = {}
    for a, b in zip(route, route[1:]):
        start, end = points[a], points[b]
        left, right = sorted((start[0], end[0]))
        bottom, top = sorted((start[1], end[1]))
        for i, (x, y, _, _) in enumerate(hazards):
            if left - 60 <= x <= right + 60 and bottom - 60 <= y <= top + 60:
                distance = segment_distance_sq(x, y, start, end)
                if distance <= 3600 and distance < matches.get(i, math.inf):
                    matches[i] = distance
    return matches


def route_trial(points, sample, hazards, settings):
    observations = {key: [] for key in settings}
    for candidates, lengths in sample:
        matches = [nearby(points, route, hazards) for route in candidates]
        encounters = [{i for i, d in match.items() if d <= 100} for match in matches]
        base = encounters[0]
        for corridor, weights in settings:
            scores = [sum(weights[hazards[i][2]] * (0.5 if hazards[i][3] else 1)
                          for i, distance in match.items() if distance <= corridor ** 2)
                      for match in matches]
            selected = min(range(len(scores)), key=lambda i: (scores[i], lengths[i], i))
            removed, added = base - encounters[selected], encounters[selected] - base
            high = lambda ids: sum(hazards[i][2] == 0 for i in ids)
            observations[corridor, weights].append({
                "selected": selected, "base": len(base), "avoided": len(removed),
                "new": len(added), "baseHigh": high(base), "avoidedHigh": high(removed),
                "newHigh": high(added), "addedLengthPct": 100 * (lengths[selected] / lengths[0] - 1),
            })
    return observations


def summarize_routes(rows):
    total = Counter()
    for row in rows:
        total.update(row)
    return {
        "reroutedPct": 100 * sum(r["selected"] > 0 for r in rows) / len(rows),
        "avoidedPct": 100 * total["avoided"] / total["base"] if total["base"] else None,
        "avoidedHighPct": 100 * total["avoidedHigh"] / total["baseHigh"] if total["baseHigh"] else None,
        "netReductionPct": 100 * (total["avoided"] - total["new"]) / total["base"] if total["base"] else None,
        "addedLengthPct": total["addedLengthPct"] / len(rows),
    }


def merge_trial(hazards, sigma, radius, seed):
    rng = random.Random(seed)
    reports = [(rng.gauss(x, sigma), rng.gauss(y, sigma), i, i % 5)
               for i, (x, y, _, _) in enumerate(hazards) for _ in range(5)]
    rng.shuffle(reports)
    clusters = defaultdict(list)
    assignments = defaultdict(set)
    wrong = 0
    for x, y, truth, kind in reports:
        same = clusters[kind]
        point = (x, y)
        nearest = min(range(len(same)), key=lambda i: math.dist(point, same[i][0]), default=None)
        if nearest is None or math.dist(point, same[nearest][0]) > radius:
            nearest = len(same)
            same.append((point, truth))
        else:
            wrong += same[nearest][1] != truth
        assignments[truth].add(nearest)
    return {"splitPct": 100 * sum(len(v) > 1 for v in assignments.values()) / len(hazards),
            "wrongReportMergePct": 100 * wrong / len(reports)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("backend/scripts/data/makati-streets.json"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--trips", type=int, default=300)
    args = parser.parse_args()
    if not 1 <= args.trips <= 300:
        parser.error("--trips must be between 1 and 300")
    raw = args.input.read_bytes()
    source = json.loads(raw)
    points, links, nodes, width, height = graph(source)
    sample = trips(points, links, nodes, args.trips)
    runs = []
    for count in (50, 100, 200):
        for seed in SEEDS:
            rng = random.Random(seed)
            severities = [0] * (count // 5) + [1] * (2 * count // 5) + [2] * (2 * count // 5)
            rng.shuffle(severities)
            disputed = set(rng.sample(range(count), round(0.15 * count)))
            hazards = [(rng.uniform(0, width), rng.uniform(0, height), severity, i in disputed)
                       for i, severity in enumerate(severities)]
            settings = SETTINGS if count == 100 else (DEFAULT,)
            observations = route_trial(points, sample, hazards, settings)
            routes = [{"corridorM": c, "weights": w, **summarize_routes(rows), "trips": rows}
                      for (c, w), rows in observations.items()]
            merges = [{"gpsSigmaM": sigma, "radiusM": r, **merge_trial(hazards, sigma, r, seed)}
                      for sigma in (5, 15) for r in (20, 30, 40)] if count in (100, 200) else []
            runs.append({"hazardCount": count, "seed": seed, "hazards": hazards, "routing": routes, "merge": merges})
    node_set = set(nodes)
    length = sum(d for u in nodes for v, d in links[u].items() if v in node_set and u < v)
    data = {
        "input": str(args.input), "inputSha256": hashlib.sha256(raw).hexdigest(),
        "source": source["source"], "snapshotDate": source["fetched"], "box": BOX,
        "graphNodes": len(nodes), "graphLengthKm": length / 1000,
        "candidateCounts": dict(sorted(Counter(len(routes) - 1 for routes, _ in sample).items())),
        "pointsM": points, "trips": sample, "runs": runs,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"{len(nodes)} connected nodes, {length / 1000:.1f} km, {len(sample)} trips")
    for count in (50, 100, 200):
        for i in range(len(SETTINGS) if count == 100 else 1):
            rows = [run["routing"][i] for run in runs if run["hazardCount"] == count]
            values = {k: [r[k] for r in rows if r[k] is not None]
                      for k in ("reroutedPct", "avoidedPct", "avoidedHighPct", "netReductionPct", "addedLengthPct")}
            print(count, rows[0]["corridorM"], rows[0]["weights"],
                  {k: (round(statistics.mean(v), 2), round(statistics.stdev(v), 2) if len(v) > 1 else None)
                   for k, v in values.items() if v})


if __name__ == "__main__":
    main()
