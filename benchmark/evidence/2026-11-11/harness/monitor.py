#!/usr/bin/env python3
"""Timestamp docker stats and the backend's actual active session gauge."""
import argparse
import datetime
import json
import subprocess
import time
import urllib.request

p = argparse.ArgumentParser()
p.add_argument('--out', required=True)
p.add_argument('--base', default='http://127.0.0.1:8080')
p.add_argument('--backend', default='saferoute-backend')
p.add_argument('--containers', nargs='+', default=['saferoute-backend', 'saferoute-kafka', 'saferoute-postgres'])
p.add_argument('--interval', type=float, default=2)
args = p.parse_args()
for name in args.containers:
    subprocess.run(['docker', 'inspect', name], stdout=subprocess.DEVNULL, check=True)
if args.backend not in args.containers:
    raise SystemExit('--backend must also be listed in --containers')
with open(args.out, 'w', buffering=1) as out:
    print('Monitoring; leave running for 60s before k6 and 30s after. Ctrl-C stops cleanly.', flush=True)
    try:
        while True:
            start = time.time()
            row = {'epochMs': round(start * 1000),
                   'utc': datetime.datetime.fromtimestamp(start, datetime.timezone.utc).isoformat(),
                   'backend': args.backend}
            try:
                # This is precisely the Docker CLI stats view, including its cache adjustments.
                r = subprocess.run(['docker', 'stats', '--no-stream', '--format', '{{json .}}'] + args.containers,
                    text=True, capture_output=True, timeout=15, check=True)
                row['containers'] = [json.loads(line) for line in r.stdout.splitlines() if line.strip()]
                with urllib.request.urlopen(args.base.rstrip('/') +
                        '/actuator/metrics/saferoute.websocket.active_sessions', timeout=5) as r:
                    metric = json.load(r)
                row['activeConnections'] = next(m['value'] for m in metric['measurements'] if m['statistic'] == 'VALUE')
                row['gaugeEpochMs'] = round(time.time() * 1000)
                row['k6Processes'] = subprocess.run(['ps', '-axo', 'pid,pcpu,rss,comm'],
                    text=True, capture_output=True, check=True).stdout.splitlines()
                row['k6Processes'] = [line for line in row['k6Processes'] if line.split() and line.split()[-1].endswith('k6')]
            except Exception as e:
                row['error'] = str(e)
            row['sampleEndEpochMs'] = round(time.time() * 1000)
            out.write(json.dumps(row) + '\n')
            elapsed = time.time() - start
            time.sleep(max(0, args.interval - elapsed))
    except KeyboardInterrupt:
        print('Monitoring saved to ' + args.out)
