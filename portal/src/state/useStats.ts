import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Stats } from '../api/types';
import { useLiveTick } from './useQueue';

export function useStats(from?: string, to?: string) {
  const tick = useLiveTick();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.stats(from, to, controller.signal)
      .then((s) => { setStats(s); setError(''); })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
    return () => controller.abort();
  }, [from, to, tick, retry]);

  return { stats, error, reload: () => setRetry((n) => n + 1) };
}
