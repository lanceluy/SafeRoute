// Live hazard changes over /ws/notifications. The portal watches the whole pilot area as a
// moderator session (a "watch" frame), so every report and status change arrives here.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { API_ORIGIN, refreshToken } from '../api/client';
import type { HazardFrame } from '../api/types';
import { useSession } from './session';

/** Metro Manila pilot area (saferoute.coverage in the backend's application.yml). */
const WATCH_BBOX = [14.35, 120.9, 14.8, 121.15];
const TOKEN_EXPIRED = 4001;

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface LiveState {
  status: LiveStatus;
  /** When the last hazard change arrived (or the connection opened). */
  updatedAt: number | null;
  /** Bumps on every hazard change, so pages can refetch. */
  version: number;
  subscribe(listener: (frame: HazardFrame) => void): () => void;
}

const LiveContext = createContext<LiveState>({
  status: 'offline', updatedAt: null, version: 0, subscribe: () => () => {},
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

export function LiveProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const token = session?.token;
  const [status, setStatus] = useState<LiveStatus>('offline');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const listeners = useRef(new Set<(f: HazardFrame) => void>());
  const [subscribe] = useState(() => (listener: (f: HazardFrame) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  });

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
      const url = `${API_ORIGIN.replace(/^http/, 'ws')}/ws/notifications`;
      // Browsers can't send an Authorization header here, so the token rides as a subprotocol.
      socket = new WebSocket(url, ['bearer', token]);
      socket.onopen = () => {
        attempts = 0;
        setStatus('live');
        setUpdatedAt(Date.now());
        socket?.send(JSON.stringify({ type: 'watch', bbox: WATCH_BBOX }));
      };
      socket.onmessage = (event) => {
        let frame: HazardFrame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!frame.type?.startsWith('hazard_')) return;
        setUpdatedAt(Date.now());
        setVersion((v) => v + 1);
        listeners.current.forEach((l) => l(frame));
      };
      socket.onclose = async (event) => {
        if (stopped) return;
        setStatus('reconnecting');
        // The session outlived its access token: get a new one; the token change reconnects.
        if (event.code === TOKEN_EXPIRED && await refreshToken()) return;
        attempts++;
        retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
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
    <LiveContext.Provider value={{ status: token ? status : 'offline', updatedAt, version, subscribe }}>
      {children}
    </LiveContext.Provider>
  );
}
