import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowRight, BoxSelect, List, Map as MapIcon, PanelRight, X } from 'lucide-react';
import { api } from '../api/client';
import type { Hazard, HazardType } from '../api/types';
import { SeverityDot, StatusBadge, TypeIcon } from '../components/Badges';
import { HazardDrawer } from '../components/HazardDrawer';
import { LayersButton, MapLegend } from '../components/MapControls';
import { MapView, type MapLayer } from '../components/MapView';
import { QueuePanel, useQueueControls, useSearchLink } from '../components/QueuePanel';
import { ago } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { TYPE_LABEL } from '../lib/hazards';
import { MAP_CHIPS, MAP_TABS } from '../lib/queue';
import { useShortcuts } from '../lib/shortcuts';
import { useBarangays, usePlace } from '../state/places';
import { useStats } from '../state/useStats';

type Mode = 'split' | 'map' | 'list';
const MODE_KEY = 'saferoute.map.mode';
const WIDTH_KEY = 'saferoute.queue.width';
const MIN_WIDTH = 340;
const MAX_WIDTH = 560;
/** The floating panel's margin from the map edge. */
const GUTTER = 12;

function stored<T>(key: string, read: (v: string | null) => T): T {
  try { return read(localStorage.getItem(key)); } catch { return read(null); }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}

/**
 * The map is the page; the report panel floats over it. The panel shows the list, or one
 * report's inspector (never both). Clicking a marker previews it in a small card first.
 */
export function MapPage() {
  const [params, setParams] = useSearchParams();
  const barangays = useBarangays();
  const typeParam = params.get('type');
  const c = useQueueControls(MAP_TABS, MAP_CHIPS, barangays, params.get('tab') ?? undefined, params.get('area') ?? undefined,
    typeParam && typeParam in TYPE_LABEL ? typeParam as HazardType : undefined);
  useSearchLink(c);
  const { stats } = useStats();
  const selectedId = params.get('hazard');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('markers');
  const [drawing, setDrawing] = useState(false);
  const [mode, setModeState] = useState<Mode>(() => stored(MODE_KEY, (v) => (v === 'map' || v === 'list' ? v : 'split')));
  const [width, setWidth] = useState(() => stored(WIDTH_KEY, (v) => {
    const n = Number(v);
    return n >= MIN_WIDTH && n <= MAX_WIDTH ? n : 400;
  }));
  const searchRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const setMode = (m: Mode) => { setModeState(m); remember(MODE_KEY, m); };

  // A deep link (?area=) may arrive before the boundaries load; apply it once they do.
  const areaParam = params.get('area');
  const { setFilters, filters } = c;
  useEffect(() => {
    if (areaParam && barangays.length && filters.area !== areaParam) setFilters({ ...filters, area: areaParam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaParam, barangays.length]);

  const select = useCallback((id: string | null) => {
    setPreviewId(null);
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
  const preview = previewId ? mapHazards.find((h) => h.id === previewId) : undefined;
  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setPreviewId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewId]);

  // The inspector needs the panel, so opening a report from map-only mode brings it back.
  const open = useCallback((id: string) => {
    select(id);
    if (mode !== 'split') setMode('split');
  }, [select, mode]);

  useShortcuts({
    '/': () => { if (mode === 'map') setMode('split'); window.setTimeout(() => searchRef.current?.focus(), 0); },
    f: () => { if (mode === 'map') setMode('split'); c.toggleFilters(); },
    m: () => { mapRef.current?.querySelector<HTMLElement>('.leaflet-container')?.focus(); },
  });

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + startX - ev.clientX)));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      setWidth((w) => { remember(WIDTH_KEY, String(w)); return w; });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const resizeByKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setWidth((w) => Math.min(MAX_WIDTH, w + 24));
    if (e.key === 'ArrowRight') setWidth((w) => Math.max(MIN_WIDTH, w - 24));
  };

  const panelOpen = mode !== 'map';
  return (
    <div className={`map-page mode-${mode}`} style={{ '--queue-width': `${width}px` } as CSSProperties}>
      <section className="map-area" ref={mapRef}>
        <MapView hazards={mapHazards} selectedId={selectedId} highlightId={previewId} layer={layer}
          onSelect={(id) => { if (id !== selectedId) setPreviewId(id); }}
          barangays={barangays} highlightArea={c.area} pulseIds={c.queue.newIds} fitKey={c.filterKey}
          loading={c.queue.loading} insetRight={panelOpen ? width + GUTTER * 2 : 0}
          region={c.filters.region} drawing={drawing} controls
          onDrawn={(box) => { setDrawing(false); if (box) c.setFilters({ ...c.filters, region: box }); }}
          toolbar={<>
            <button type="button" className={drawing ? 'on' : undefined} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}
              aria-label={drawing ? 'Cancel area selection' : 'Select an area'} title={drawing ? 'Cancel (Esc)' : 'Select an area'}>
              <BoxSelect size={18} aria-hidden="true" />
            </button>
            <LayersButton layer={layer} onChange={setLayer} />
          </>} />

        <div className="view-switch" role="group" aria-label="View">
          <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')} title="Map and list"><PanelRight size={16} aria-hidden="true" /><span>Map + list</span></button>
          <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')} title="Map only"><MapIcon size={16} aria-hidden="true" /><span>Map</span></button>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')} title="List only"><List size={16} aria-hidden="true" /><span>List</span></button>
        </div>

        {(drawing || c.filters.region) && (
          <div className="map-hint" role="status">
            {drawing
              ? <>Drag on the map to select an area · Esc to cancel</>
              : <>Showing a selected area <button type="button" className="btn-link" onClick={() => c.setFilters({ ...c.filters, region: null })}>Clear</button></>}
          </div>
        )}

        <MapLegend layer={layer} />

        {preview && !selectedId && (
          <PreviewCard hazard={preview} barangays={barangays} onOpen={() => open(preview.id)} onClose={() => setPreviewId(null)} />
        )}
      </section>

      {panelOpen && (
        <aside className="queue-panel floating" aria-label={selectedId ? 'Hazard details' : 'Hazard list'}>
          {mode === 'split' && (
            <div className="panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize the panel"
              aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} tabIndex={0}
              onPointerDown={startResize} onKeyDown={resizeByKey} />
          )}
          {selectedId
            ? <HazardDrawer key={selectedId} variant="panel" hazardId={selectedId} barangays={barangays}
                onClose={() => select(null)} onChanged={c.queue.reload} />
            : <QueuePanel c={c} tabs={MAP_TABS} stats={stats} barangays={barangays} selectedId={selectedId}
                onSelect={(h) => select(h.id)} searchRef={searchRef} page="map" />}
        </aside>
      )}
    </div>
  );
}

/** A marker's first click: what, where, how bad, and a way into the full report. */
function PreviewCard({ hazard: h, barangays, onOpen, onClose }: {
  hazard: Hazard; barangays: Barangay[]; onOpen: () => void; onClose: () => void;
}) {
  const place = usePlace(h.latitude, h.longitude, barangays);
  return (
    <div className="preview-card" role="dialog" aria-label={`${TYPE_LABEL[h.type]} preview`}>
      <span className="row-icon type-tile"><TypeIcon type={h.type} size={18} /></span>
      <div className="preview-main">
        <strong>{TYPE_LABEL[h.type]}</strong>
        <span className="muted">{place.label || 'Locating street…'}</span>
      </div>
      <div className="preview-facts">
        <SeverityDot severity={h.severity} />
        {h.status === 'DISPUTED' ? <span className="pill pill-contested">Contested</span> : <StatusBadge status={h.status} plain />}
        <span className="muted">{ago(h.createdAt)}</span>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={onOpen} autoFocus>Open report<ArrowRight size={15} aria-hidden="true" /></button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close preview"><X size={16} aria-hidden="true" /></button>
    </div>
  );
}
