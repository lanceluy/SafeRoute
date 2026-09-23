// High load ("rush hour"): a steady 50 reports/s plus 100 map queries/s.
import { registerUsers, submitHazard, queryNearby } from './common.js';

export const options = {
  scenarios: {
    reports: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '2m', preAllocatedVUs: 50, maxVUs: 200, exec: 'report' },
    browsing: { executor: 'constant-arrival-rate', rate: 100, timeUnit: '1s', duration: '2m', preAllocatedVUs: 50, maxVUs: 200, exec: 'browse' },
  },
  thresholds: { 'http_req_failed': ['rate<0.01'], 'http_req_duration{name:submit}': ['p(95)<500'] },
};

export function setup() { return { tokens: registerUsers(200) }; }
export function report(data) { submitHazard(data.tokens[Math.floor(Math.random() * data.tokens.length)]); }
export function browse(data) { queryNearby(data.tokens[Math.floor(Math.random() * data.tokens.length)]); }
