#!/usr/bin/env python3
"""Join external POST and WS timestamps, audit delivery, estimate incremental memory."""
import argparse
import collections
import json
import math
import re
import statistics

p = argparse.ArgumentParser()
p.add_argument('--raw', required=True)
p.add_argument('--resources', required=True)
p.add_argument('--connections', type=int, required=True)
p.add_argument('--events', type=int, default=4)
p.add_argument('--timeout-ms', type=float, default=30000)
p.add_argument('--out', required=True)
a = p.parse_args()

def stats(v):
    s = sorted(v)
    if not s:
        return {'n': 0}
    def q(p):
        return s[max(0, math.ceil(p * len(s)) - 1)]
    return {'n': len(s), 'mean': statistics.mean(s), 'median': statistics.median(s),
            'p95': q(.95), 'p99': q(.99), 'min': s[0], 'max': s[-1]}

starts, outcomes, received = {}, {}, collections.defaultdict(list)
with open(a.raw) as f:
    for line in f:
        r = json.loads(line)
        if r.get('type') != 'Point':
            continue
        name, d = r.get('metric'), r['data']
        t = d.get('tags', {})
        if name == 'report_start_epoch_ms':
            starts[t['event']] = d['value']
        elif name == 'report_outcome' and d['value']:
            outcomes[t['event']] = t
        elif name == 'hazard_receive_epoch_ms':
            received[t['event']].append((t['hazard'], t['listener'], d['value']))

per_event, pooled, complete_maxima = [], [], []
for i in range(a.events):
    key = str(i)
    outcome = outcomes.get(key, {})
    if key not in starts or outcome.get('status') != 'CREATED':
        per_event.append({'event': i, 'valid': False,
                          'reason': 'No POST timestamp or no confirmed CREATED outcome', 'outcome': outcome})
        continue
    t0, hid = starts[key], outcome['hazard']
    first, duplicates = {}, 0
    for hazard, listener, at in received[key]:
        if hazard != hid:
            continue
        if listener in first:
            duplicates += 1
        first[listener] = min(first.get(listener, at), at)
    negative = sum(at < t0 for at in first.values())
    timely = [at - t0 for at in first.values() if 0 <= at - t0 <= a.timeout_ms]
    late = sum(at - t0 > a.timeout_ms for at in first.values())
    valid = negative == 0 and len(first) <= a.connections
    pooled.extend(timely if valid else [])
    complete = valid and len(timely) == a.connections
    if complete:
        complete_maxima.append(max(timely))
    per_event.append({'event': i, 'hazardId': hid, 'valid': valid,
        'expected': a.connections, 'receivedWithinDeadline': len(timely), 'late': late,
        'notObserved': max(0, a.connections - len(first)),
        'missingOrLateByDeadline': max(0, a.connections - len(timely)),
        'deadlineMs': a.timeout_ms, 'negativeDeltas': negative, 'duplicateRawSamples': duplicates,
        'completeFanoutWithinDeadline': complete, 'deliveryLatencyMs': stats(timely),
        'fullFanoutLatencyMs': max(timely) if complete else None})

def memory_bytes(text):
    match = re.fullmatch(r'\s*([\d.]+)\s*([A-Za-z]+)\s*', text.split('/')[0])
    units = {'B': 1, 'kB': 1000, 'KB': 1000, 'KiB': 1024, 'MB': 10**6,
             'MiB': 2**20, 'GB': 10**9, 'GiB': 2**30, 'TB': 10**12, 'TiB': 2**40}
    if not match or match[2] not in units:
        raise ValueError('Unsupported docker memory format: ' + text)
    return float(match[1]) * units[match[2]]

rows, errors = [], []
with open(a.resources) as f:
    for line in f:
        r = json.loads(line)
        if 'error' in r:
            errors.append(r); continue
        for c in r['containers']:
            if c['Name'].lstrip('/') == r['backend'].lstrip('/'):
                rows.append({'at': r['gaugeEpochMs'], 'n': r['activeConnections'],
                    'bytes': memory_bytes(c['MemUsage']), 'cpu': float(c['CPUPerc'].strip('%'))})
first_connected = min((r['at'] for r in rows if r['n'] > 0), default=float('inf'))
# Last minute before first observed connection. Excludes post-load retained JVM memory.
baseline = [r for r in rows if r['n'] == 0 and first_connected - 60000 <= r['at'] < first_connected]
first_post = min(starts.values(), default=float('inf'))
last_post = max(starts.values(), default=0)
idle_plateau = [r for r in rows if r['n'] == a.connections and r['at'] < first_post]
loaded = [r for r in rows if r['n'] == a.connections and first_post <= r['at'] <= last_post + a.timeout_ms]
resource = {'baselineSamples': len(baseline), 'idleTargetSamples': len(idle_plateau),
            'loadedTargetSamples': len(loaded), 'monitorErrors': len(errors),
            'maxObservedConnections': max((r['n'] for r in rows), default=0),
            'baselineBackendCpuPercent': stats([r['cpu'] for r in baseline]),
            'idleTargetBackendCpuPercent': stats([r['cpu'] for r in idle_plateau]),
            'baselineBackendMemoryBytes': stats([r['bytes'] for r in baseline]),
            'idleTargetBackendMemoryBytes': stats([r['bytes'] for r in idle_plateau]),
            'loadedTargetBackendMemoryBytes': stats([r['bytes'] for r in loaded]),
            'loadedBackendCpuPercent': stats([r['cpu'] for r in loaded]),
            'note': 'Docker CLI working-set-style memory, not JVM heap; sampled CPU and memory, not instantaneous peaks.'}
if baseline:
    b = statistics.median(r['bytes'] for r in baseline)
    for label, series in [('idle', idle_plateau), ('loaded', loaded)]:
        if series:
            resource[label + 'IncrementalMedianBytesPerConnection'] = (statistics.median(r['bytes'] for r in series) - b) / a.connections
            resource[label + 'IncrementalSampledPeakBytesPerConnection'] = (max(r['bytes'] for r in series) - b) / a.connections

result = {'requestedConnections': a.connections, 'requestedEvents': a.events,
    'createdOutcomes': sum(x.get('valid', False) for x in per_event),
    'allRequestedFanoutsComplete': all(x.get('completeFanoutWithinDeadline', False) for x in per_event),
    'events': per_event, 'pooledDeliveryLatencyMs': stats(pooled),
    'completeEventFanoutLatencyMs': stats(complete_maxima), 'resources': resource,
    'caution': 'Pooled deliveries are clustered by event, not independent event trials. Do not infer capacity from successful samples alone; review missing/late frames and k6 thresholds.'}
with open(a.out, 'w') as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))
