// Polling baseline load: N clients polling GET /api/hazards/nearby every POLL_SECONDS
// (default 3) — the request volume a polling architecture needs to approximate what a single
// WebSocket connection per client delivers. Compare http_reqs and server CPU/DB metrics with
// normal-load.js. Detection *latency* is measured by simulator/latency-compare.mjs.
import { sleep } from 'k6';
import { registerUsers, queryNearby } from './common.js';

const CLIENTS = Number(__ENV.CLIENTS || 100);
const POLL_SECONDS = Number(__ENV.POLL_SECONDS || 3);

export const options = {
  scenarios: { pollers: { executor: 'constant-vus', vus: CLIENTS, duration: '2m' } },
  thresholds: { 'http_req_failed': ['rate<0.01'] },
};

export function setup() { return { tokens: registerUsers(Math.min(CLIENTS, 100)) }; }

export default function (data) {
  queryNearby(data.tokens[__VU % data.tokens.length]);
  sleep(POLL_SECONDS);
}
