import { useEffect, useMemo, useRef, useState } from 'react';
import { contains, type Barangay } from '../lib/geo';
import { fetchRadarFrame, fetchRainHistory, fetchWeather, type RadarFrame, type RainHistory, type RainPoint, type Weather } from '../lib/weather';

export interface Polled<T> {
  data: T | null;
  /** The last refresh failed; `data` (if any) is from an earlier one. */
  error: string;
  /** When `data` was fetched. */
  fetchedAt: number | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetches now, again every `everyMs`, and when the tab comes back after being away that long.
 * A change of `key` refetches; the previous data stays on screen until the new data arrives.
 */
function usePolled<T>(load: (signal: AbortSignal) => Promise<T>, everyMs: number, key = '', enabled = true): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const refresh = () => { setLoading(true); setTick((n) => n + 1); };

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loadRef.current(controller.signal)
      .then((d) => { setData(d); setFetchedAt(Date.now()); setError(''); setLoading(false); })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
        setLoading(false);
      });
    // The next scheduled refresh; a manual reload or a returning tab restarts the clock.
    const timer = window.setTimeout(refresh, everyMs);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [tick, key, everyMs, enabled]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (fetchedAt == null || Date.now() - fetchedAt > everyMs)) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchedAt, everyMs]);

  return { data, error, fetchedAt, loading: enabled && loading, reload: refresh };
}

/** Live Makati weather. Open-Meteo refreshes current conditions every 15 minutes; checking every 10 keeps us close. */
export function useWeather() {
  const { data, ...rest } = usePolled(fetchWeather, 10 * 60_000);
  return { weather: data as Weather | null, ...rest };
}

/** Past rain per barangay; hourly totals only move once an hour, so every 30 minutes is plenty. */
export function useRainHistory(barangays: Barangay[]): Polled<RainHistory> {
  const points = useMemo(() => barangays.map(centerPoint), [barangays]);
  return usePolled((signal) => fetchRainHistory(points, signal), 30 * 60_000, points.map((p) => p.name).join('|'), points.length > 0);
}

/** The newest radar frame; RainViewer publishes every 10 minutes. */
export function useRadar(): Polled<RadarFrame> {
  return usePolled(fetchRadarFrame, 5 * 60_000);
}

/**
 * A point inside the barangay to ask about: the average of its largest part's outline, or, for a
 * long thin shape where that lands outside (Kasilawan), the nearest inside point on a fine grid.
 */
function centerPoint(b: Barangay): RainPoint {
  const ring = b.polygons.reduce((best, p) => (p[0].length > best.length ? p[0] : best), b.polygons[0][0]);
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  if (contains(b, lat, lon)) return { name: b.name, latitude: lat, longitude: lon };
  const [minLat, minLon, maxLat, maxLon] = b.bbox;
  let best: RainPoint = { name: b.name, latitude: lat, longitude: lon };
  let bestDist = Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const la = minLat + ((maxLat - minLat) * i) / steps;
      const lo = minLon + ((maxLon - minLon) * j) / steps;
      const dist = (la - lat) ** 2 + (lo - lon) ** 2;
      if (dist < bestDist && contains(b, la, lo)) { best = { name: b.name, latitude: la, longitude: lo }; bestDist = dist; }
    }
  }
  return best;
}
