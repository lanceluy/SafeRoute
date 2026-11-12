import { WebSocket } from 'k6/websockets';
import { Trend } from 'k6/metrics';

const token = open(__ENV.SHUTDOWN_TOKEN_FILE).trim();
const clients = Number(__ENV.SHUTDOWN_CLIENTS);
const opened = new Trend('shutdown_opened_ms');
const closed = new Trend('shutdown_peer_closed_ms');
const errors = new Trend('shutdown_socket_error_ms');
const timedOut = new Trend('shutdown_client_timeout_ms');

export const options = {
  scenarios: {
    listeners: { executor: 'per-vu-iterations', vus: clients, iterations: 1, maxDuration: '95s' },
  },
};

export default function () {
  const tags = { listener: String(__VU) };
  const socket = new WebSocket('ws://127.0.0.1:18080/ws/notifications', [], {
    headers: { Authorization: 'Bearer ' + token },
  });
  let clientClosed = false;
  const deadline = setTimeout(() => {
    clientClosed = true;
    timedOut.add(Date.now(), tags);
    socket.close();
  }, 75000);
  socket.onopen = () => {
    opened.add(Date.now(), tags);
    socket.send(JSON.stringify({ type: 'subscribe', lat: 14.5547, lon: 121.0244 }));
  };
  socket.onerror = () => errors.add(Date.now(), tags);
  socket.onclose = () => {
    clearTimeout(deadline);
    if (!clientClosed) closed.add(Date.now(), tags);
  };
}
