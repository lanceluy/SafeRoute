import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ClosureFrame, RoadClosure } from '../api/types';
import { useClosureFrames, useLive } from './live';

/**
 * The active road closures, kept current by live frames. A frame carries the whole closure, so it
 * is applied in place; the list is refetched when the connection (re)opens to catch up on
 * anything missed while disconnected.
 */
export function useClosures() {
  const { status } = useLive();
  const [closures, setClosures] = useState<RoadClosure[]>([]);

  const reload = useCallback((signal?: AbortSignal) => {
    api.closures(signal).then(setClosures).catch(() => { /* keep what we have */ });
  }, []);

  useEffect(() => {
    if (status !== 'live') return;
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [status, reload]);

  useClosureFrames((f: ClosureFrame) => {
    setClosures((list) => {
      const existing = list.find((c) => c.id === f.closureId);
      if (existing && existing.version > f.version) return list; // stale
      const rest = list.filter((c) => c.id !== f.closureId);
      if (f.status !== 'ACTIVE') return rest;
      return [{
        id: f.closureId, name: f.name, reason: f.reason, category: f.category, status: f.status,
        bufferMeters: f.bufferMeters, startsAt: existing?.startsAt ?? f.occurredAt, endsAt: f.endsAt ?? null,
        createdAt: existing?.createdAt ?? f.occurredAt, version: f.version, coordinates: f.coordinates,
      }, ...rest];
    });
  });

  return { closures, reload };
}
