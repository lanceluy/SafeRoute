import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { Hazard } from '../api/types';
import { HazardDrawer } from '../components/HazardDrawer';
import { LayerSwitcher, MapLegend } from '../components/MapControls';
import { MapView, type MapLayer } from '../components/MapView';
import { QueuePanel, useQueueControls } from '../components/QueuePanel';
import { plural } from '../lib/format';
import { MAP_TABS } from '../lib/queue';
import { useShortcuts } from '../lib/shortcuts';
import { useBarangays } from '../state/places';
import { useStats } from '../state/useStats';

/** The details drawer's width plus its margin (see .drawer). */
const DRAWER_WIDTH = 432;
const WIDTH_KEY = 'saferoute.queue.width';
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;

function storedWidth() {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_WIDTH && n <= MAX_WIDTH ? n : 400;
  } catch {
    return 400;
  }
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const barangays = useBarangays();
  const c = useQueueControls(MAP_TABS, barangays, params.get('tab') ?? undefined, params.get('area') ?? undefined);
  const { stats } = useStats();
  const selectedId = params.get('hazard');
  const [layer, setLayer] = useState<MapLayer>('markers');
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(storedWidth);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const searchRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // A deep link (?area=) may arrive before the boundaries load; apply it once they do.
  const areaParam = params.get('area');
  const { setFilters, filters } = c;
  useEffect(() => {
    if (areaParam && barangays.length && filters.area !== areaParam) setFilters({ ...filters, area: areaParam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaParam, barangays.length]);

  const select = useCallback((id: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id) next.set('hazard', id); else next.delete('hazard');
      return next;
    }, { replace: true });
  }, [setParams]);

  // A hazard opened from elsewhere (Activity, Overview) may be outside the current tab: still show its marker.
  const [extra, setExtra] = useState<Hazard | null>(null);
  const inList = !!selectedId && c.shown.some((h) => h.id === selectedId);
  const needsExtra = !!selectedId && !inList && !c.queue.loading;
  useEffect(() => {
    if (!needsExtra || !selectedId) return;
    const controller = new AbortController();
    api.hazard(selectedId, controller.signal).then((d) => setExtra(d.hazard)).catch(() => {});
    return () => controller.abort();
  }, [needsExtra, selectedId]);
  const mapHazards = needsExtra && extra?.id === selectedId ? [...c.shown, extra] : c.shown;

  const onRow = useCallback((h: Hazard) => { select(h.id); setMobileView('map'); }, [select]);

  useShortcuts({
    '/': () => { setCollapsed(false); setMobileView('list'); window.setTimeout(() => searchRef.current?.focus(), 0); },
    f: () => { setCollapsed(false); c.toggleFilters(); },
    m: () => { setMobileView('map'); mapRef.current?.querySelector<HTMLElement>('.leaflet-container')?.focus(); },
  });

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + startX - ev.clientX)));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      setWidth((w) => { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* not remembered */ } return w; });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const resizeByKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setWidth((w) => Math.min(MAX_WIDTH, w + 24));
    if (e.key === 'ArrowRight') setWidth((w) => Math.max(MIN_WIDTH, w - 24));
  };

  return (
    <div className={`map-page${collapsed ? ' collapsed' : ''} show-${mobileView}`} style={{ '--queue-width': `${width}px` } as CSSProperties}>
      <div className="mobile-switch" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={mobileView === 'list'} onClick={() => setMobileView('list')}>List</button>
        <button type="button" role="tab" aria-selected={mobileView === 'map'} onClick={() => setMobileView('map')}>Map</button>
      </div>

      <section className="map-area" ref={mapRef}>
        <MapView hazards={mapHazards} selectedId={selectedId} onSelect={(id) => select(id)} layer={layer}
          barangays={barangays} highlightArea={c.area} pulseIds={c.queue.newIds} fitKey={c.filterKey}
          loading={c.queue.loading} insetRight={selectedId ? DRAWER_WIDTH : 0} />
        <div className="map-overlays">
          <LayerSwitcher layer={layer} onChange={setLayer} />
          <MapLegend layer={layer} />
        </div>
        {selectedId && (
          <HazardDrawer key={selectedId} hazardId={selectedId} barangays={barangays} onClose={() => select(null)} onChanged={c.queue.reload} />
        )}
      </section>

      {collapsed ? (
        <button type="button" className="queue-rail" onClick={() => setCollapsed(false)} aria-label="Show hazard queue">
          <span aria-hidden="true">‹</span>
          <strong>{c.shown.length}</strong>
          <span className="rail-label">{plural(c.shown.length, 'hazard').replace(/^\d+ /, '')}</span>
        </button>
      ) : (
        <>
          <div className="divider" role="separator" aria-orientation="vertical" aria-label="Resize the hazard queue"
            aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} tabIndex={0}
            onPointerDown={startResize} onKeyDown={resizeByKey} />
          <aside className="queue-panel" aria-label="Hazard queue">
            <button type="button" className="icon-btn collapse-btn" onClick={() => setCollapsed(true)} aria-label="Hide hazard queue" title="Hide queue">›</button>
            <QueuePanel c={c} tabs={MAP_TABS} stats={stats} barangays={barangays} selectedId={selectedId}
              onSelect={onRow} searchRef={searchRef} />
          </aside>
        </>
      )}
    </div>
  );
}
