// Normal load: 20 commuters, mostly browsing the map, occasionally reporting.
import { sleep } from 'k6';
import { registerUsers, submitHazard, queryNearby } from './common.js';

export const options = {
  scenarios: { commuters: { executor: 'constant-vus', vus: 20, duration: '2m' } },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{name:submit}': ['p(95)<300'],
    'http_req_duration{name:nearby}': ['p(95)<300'],
  },
};

export function setup() { return { tokens: registerUsers(20) }; }

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  queryNearby(token);
  if (Math.random() < 0.2) submitHazard(token);
  sleep(1);
}
