import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Hazard, QueueQuery } from '../api/types';
import { useLive } from './live';

export interface QueueState {
  hazards: Hazard[];
  total: number;
  truncated: boolean;
  loading: boolean;
  error: string;
  /** Hazards that appeared through a live update since the last filter change. */
  newIds: Set<string>;
  reload: () => void;
  clearNew: () => void;
}

/** The hazards matching `query`, refetched (quietly) whenever a live change arrives. */
export function useQueue(query: QueueQuery, max = 500): QueueState {
  const key = JSON.stringify(query);
  const liveTick = useLiveTick();
  const [state, setState] = useState({ hazards: [] as Hazard[], total: 0, truncated: false, loading: true, error: '' });
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const lastKey = useRef(key);

  useEffect(() => {
    const controller = new AbortController();
    const filterChanged = lastKey.current !== key;
    lastKey.current = key;
    if (filterChanged) {
      known.current = null;
      setNewIds(new Set());
    }
    setState((s) => ({ ...s, loading: filterChanged || s.hazards.length === 0, error: '' }));
    api.queueAll(JSON.parse(key) as QueueQuery, max, controller.signal)
      .then((res) => {
        if (known.current) {
          const fresh = res.items.filter((h) => !known.current!.has(h.id)).map((h) => h.id);
          if (fresh.length) setNewIds((prev) => new Set([...prev, ...fresh]));
        }
        known.current = new Set(res.items.map((h) => h.id));
        setState({ hazards: res.items, total: res.total, truncated: res.truncated, loading: false, error: '' });
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, loading: false, error: err instanceof ApiError ? err.message : 'Something went wrong.' }));
      });
    return () => controller.abort();
  }, [key, max, liveTick, manual]);

  const reload = useCallback(() => setManual((n) => n + 1), []);
  const clearNew = useCallback(() => setNewIds(new Set()), []);
  return { ...state, newIds, reload, clearNew };
}

/** Increments shortly after live changes arrive; a burst (a verification sends several frames) counts once. */
export function useLiveTick() {
  const { version } = useLive();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!version) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), 700);
    return () => window.clearTimeout(t);
  }, [version]);
  return tick;
}
