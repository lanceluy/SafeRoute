// Live hazard changes over /ws/notifications. The portal watches the whole pilot area as a
// moderator session (a "watch" frame), so every report and status change arrives here.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { API_ORIGIN, refreshToken } from '../api/client';
import type { ClosureFrame, HazardFrame } from '../api/types';
import { useSession } from './session';

/** Metro Manila pilot area (saferoute.coverage in the backend's application.yml). */
const WATCH_BBOX = [14.35, 120.9, 14.8, 121.15];
const TOKEN_EXPIRED = 4001;
/** Refresh a little early so a reconnect never races the token's expiry. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Whether the access token has expired (or is about to). A handshake with an expired token is
 * refused with HTTP 401, which the browser reports only as close code 1006, so the client has
 * to check for itself rather than wait for the server's 4001.
 */
function tokenExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 - EXPIRY_MARGIN_MS < Date.now();
  } catch {
    return false;
  }
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface LiveState {
  status: LiveStatus;
  /** When the last hazard change arrived (or the connection opened). */
  updatedAt: number | null;
  /** Bumps on every hazard change, so pages can refetch. */
  version: number;
  subscribe(listener: (frame: HazardFrame) => void): () => void;
  subscribeClosures(listener: (frame: ClosureFrame) => void): () => void;
}

const LiveContext = createContext<LiveState>({
  status: 'offline', updatedAt: null, version: 0, subscribe: () => () => {}, subscribeClosures: () => () => {},
});

export function useLive() {
  return useContext(LiveContext);
}

/** Calls `listener` for every hazard frame while mounted. */
export function useHazardFrames(listener: (frame: HazardFrame) => void) {
  const { subscribe } = useLive();
  const ref = useRef(listener);
  useEffect(() => { ref.current = listener; });
  useEffect(() => subscribe((f) => ref.current(f)), [subscribe]);
}

/** Calls `listener` for every road-closure frame while mounted. */
export function useClosureFrames(listener: (frame: ClosureFrame) => void) {
  const { subscribeClosures } = useLive();
  const ref = useRef(listener);
  useEffect(() => { ref.current = listener; });
  useEffect(() => subscribeClosures((f) => ref.current(f)), [subscribeClosures]);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const token = session?.token;
  const [status, setStatus] = useState<LiveStatus>('offline');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const listeners = useRef(new Set<(f: HazardFrame) => void>());
  /** Survives token changes, so a reconnect with a fresh token still counts as a reconnect. */
  const connectedBefore = useRef(false);
  const [subscribe] = useState(() => (listener: (f: HazardFrame) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  });
  const closureListeners = useRef(new Set<(f: ClosureFrame) => void>());
  const [subscribeClosures] = useState(() => (listener: (f: ClosureFrame) => void) => {
    closureListeners.current.add(listener);
    return () => { closureListeners.current.delete(listener); };
  });

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let stopped = false;

    const retryLater = () => {
      attempts++;
      retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
    };

    const connect = async () => {
      setStatus(connectedBefore.current || attempts > 0 ? 'reconnecting' : 'connecting');
      if (tokenExpired(token)) {
        // A new token re-runs this effect, which connects with it.
        if (await refreshToken()) return;
        if (!stopped) retryLater();
        return;
      }
      if (stopped) return;
      const url = `${API_ORIGIN.replace(/^http/, 'ws')}/ws/notifications`;
      // Browsers can't send an Authorization header here, so the token rides as a subprotocol.
      socket = new WebSocket(url, ['bearer', token]);
      socket.onopen = () => {
        attempts = 0;
        setStatus('live');
        setUpdatedAt(Date.now());
        socket?.send(JSON.stringify({ type: 'watch', bbox: WATCH_BBOX }));
        // Changes made while disconnected never arrive as frames, so have pages refetch.
        if (connectedBefore.current) setVersion((v) => v + 1);
        connectedBefore.current = true;
      };
      socket.onmessage = (event) => {
        let frame: HazardFrame | ClosureFrame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (frame.type === 'closure_changed') {
          // Closures have their own listeners; they don't make every page refetch its hazards.
          setUpdatedAt(Date.now());
          closureListeners.current.forEach((l) => l(frame as ClosureFrame));
          return;
        }
        if (!frame.type?.startsWith('hazard_')) return;
        setUpdatedAt(Date.now());
        setVersion((v) => v + 1);
        listeners.current.forEach((l) => l(frame as HazardFrame));
      };
      socket.onclose = async (event) => {
        if (stopped) return;
        setStatus('reconnecting');
        // The session outlived its access token: get a new one; the token change reconnects.
        if (event.code === TOKEN_EXPIRED && await refreshToken()) return;
        if (!stopped) retryLater();
      };
    };
    connect();

    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [token]);

  return (
    <LiveContext.Provider value={{ status: token ? status : 'offline', updatedAt, version, subscribe, subscribeClosures }}>
      {children}
    </LiveContext.Provider>
  );
}
