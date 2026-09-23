// Stress: ramp report submissions until latency/errors degrade, to find the breaking point.
import { registerUsers, submitHazard } from './common.js';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s', preAllocatedVUs: 100, maxVUs: 1000,
      stages: [
        { target: 50, duration: '1m' }, { target: 150, duration: '1m' },
        { target: 300, duration: '1m' }, { target: 500, duration: '1m' }, { target: 0, duration: '30s' },
      ],
    },
  },
  // Informational: stress runs are expected to cross these; k6 reports where.
  thresholds: { 'http_req_failed': ['rate<0.05'], 'http_req_duration{name:submit}': ['p(95)<1000'] },
};

export function setup() { return { tokens: registerUsers(300) }; }
export default function (data) { submitHazard(data.tokens[Math.floor(Math.random() * data.tokens.length)]); }
