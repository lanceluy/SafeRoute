#!/usr/bin/env python3
"""Record WebSocket disconnections when the isolated local backend stops."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import statistics
import subprocess
import tempfile
import time
import urllib.request
import uuid

BASE = "http://127.0.0.1:18080"
BACKEND = "saferoute-icbim-backend"
GAUGE = "/actuator/metrics/saferoute.websocket.active_sessions"
HEALTH = "/actuator/health"


def request(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.load(response)


def sessions():
    return next(m["value"] for m in request(GAUGE)["measurements"] if m["statistic"] == "VALUE")


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, timeout=40).strip()


def epoch_ms():
    return time.time_ns() // 1_000_000


def samples(raw):
    for line in raw.read_text().splitlines():
        point = json.loads(line)
        if point.get("type") == "Point" and point["metric"].startswith("shutdown_"):
            data = point["data"]
            yield point["metric"], data["tags"]["listener"], data["value"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clients", type=int, default=100)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not 2 <= args.clients <= 500:
        parser.error("--clients must be between 2 and 500")

    container = json.loads(docker("inspect", BACKEND))[0]
    labels = container["Config"]["Labels"]
    if (labels.get("com.docker.compose.project") != "saferoute-icbim"
            or labels.get("com.docker.compose.service") != "backend"
            or not container["State"]["Running"]):
        raise SystemExit("Expected the running isolated saferoute-icbim backend.")
    binding = container["NetworkSettings"]["Ports"].get("8080/tcp")
    if binding != [{"HostIp": "127.0.0.1", "HostPort": "18080"}]:
        raise SystemExit("Expected only the local port binding 127.0.0.1:18080.")
    if shutil.which("k6") is None:
        raise SystemExit("k6 is required on PATH.")
    if request(HEALTH)["status"] != "UP" or sessions() != 0:
        raise SystemExit("Expected a healthy benchmark stack with zero existing WebSocket sessions.")

    args.out.mkdir(parents=True, exist_ok=False)
    raw = args.out / "k6.jsonl"
    result = {
        "backend": BACKEND, "image": container["Image"], "clientsRequested": args.clients,
        "checkout": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "method": "Single backend, shared listener account, no client retries",
        "passed": False,
    }
    try:
        with tempfile.TemporaryDirectory() as tmp:
            token = Path(tmp) / "token"
            token.write_text(request("/api/auth/register", {
                "email": f"icbim-shutdown-{uuid.uuid4().hex}@bench.local",
                "password": secrets.token_urlsafe(24), "displayName": "ICBIM shutdown listener",
            })["token"])
            with (args.out / "k6.log").open("w") as log:
                child = subprocess.Popen([
                    "k6", "run", "--out", f"json={raw}", str(Path(__file__).with_suffix(".js")),
                ], env={**os.environ, "SHUTDOWN_TOKEN_FILE": str(token), "SHUTDOWN_CLIENTS": str(args.clients)},
                    stdout=log, stderr=subprocess.STDOUT)
                try:
                    deadline = time.monotonic() + 30
                    stable = 0
                    while stable < 3 and time.monotonic() < deadline and child.poll() is None:
                        count = sessions()
                        stable = stable + 1 if count == args.clients else 0
                        if stable < 3:
                            time.sleep(1)
                    if stable < 3:
                        raise RuntimeError("Target session count was not sustained. Backend left running.")
                    result["sessionsBeforeStop"] = count
                    print(f"Verified {count} active sessions. Stopping the isolated backend.", flush=True)
                    result["stopCommandStartedMs"] = epoch_ms()
                    try:
                        docker("stop", BACKEND)
                        result["stopConfirmedMs"] = epoch_ms()
                        if docker("inspect", "--format", "{{.State.Running}}", BACKEND) != "false":
                            raise RuntimeError("Backend was still running after docker stop.")
                        result["k6Exit"] = child.wait(timeout=22)
                    finally:
                        result["restartCommandStartedMs"] = epoch_ms()
                        docker("start", BACKEND)
                        print("Backend container restarted. Checking health.", flush=True)
                        recovery_deadline = time.monotonic() + 60
                        while time.monotonic() < recovery_deadline:
                            try:
                                if request(HEALTH)["status"] == "UP":
                                    result["healthyAgainMs"] = epoch_ms()
                                    break
                            except (OSError, ValueError):
                                pass
                            time.sleep(1)
                finally:
                    if child.poll() is None:
                        child.terminate()
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait()

        if "healthyAgainMs" not in result:
            raise RuntimeError("Backend did not report healthy within 60 seconds of restart.")
        rows = list(samples(raw))
        opened = {listener for metric, listener, _ in rows if metric == "shutdown_opened_ms"}
        closures = [(listener, stamp) for metric, listener, stamp in rows if metric == "shutdown_peer_closed_ms"]
        closed = {listener for listener, _ in closures}
        after_stop = [(listener, stamp - result["stopCommandStartedMs"]) for listener, stamp in closures
                      if result["stopCommandStartedMs"] <= stamp <= result["restartCommandStartedMs"]]
        deltas = [ms for _, ms in after_stop]
        result.update(opened=len(opened), peerClosed=len(closed), closedAfterStop=len(after_stop),
                      socketErrors=sum(metric == "shutdown_socket_error_ms" for metric, _, _ in rows),
                      clientTimeouts=sum(metric == "shutdown_client_timeout_ms" for metric, _, _ in rows))
        if deltas:
            result.update(firstCloseMs=min(deltas), medianCloseMs=statistics.median(deltas), lastCloseMs=max(deltas))
        result["passed"] = (result["k6Exit"] == 0 and result["clientTimeouts"] == 0
                            and len(opened) == args.clients and closed == opened
                            and len(after_stop) == len(closures) == args.clients)
        print(f"Peer closes after stop request: {len(after_stop)}/{args.clients}", flush=True)
    finally:
        path = args.out / "result.json"
        path.write_text(json.dumps(result, indent=2) + "\n")
        print(f"Evidence saved to {path}", flush=True)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
