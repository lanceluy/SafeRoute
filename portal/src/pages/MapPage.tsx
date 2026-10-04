import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowRight, BoxSelect, ChevronDown, ChevronUp, List, Map as MapIcon, PanelRight, X } from 'lucide-react';
import { api } from '../api/client';
import type { Hazard, HazardType } from '../api/types';
import { TypeIcon } from '../components/Badges';
import { HazardDrawer } from '../components/HazardDrawer';
import { LayersButton, MapLegend } from '../components/MapControls';
import { MapView, type MapLayer } from '../components/MapView';
import { QueuePanel, useQueueControls, useSearchLink } from '../components/QueuePanel';
import type { Barangay } from '../lib/geo';
import { TYPE_LABEL, SEVERITY_LABEL } from '../lib/hazards';
import { MAP_CHIPS, MAP_TABS } from '../lib/queue';
import { useShortcuts } from '../lib/shortcuts';
import { useBarangays, usePlace } from '../state/places';
import { useStats } from '../state/useStats';
import { useToast } from '../state/toast';
import { useRadar } from '../state/useWeather';
import { RADAR_MAX_ZOOM, RADAR_SOURCE_URL } from '../lib/weather';
import { Segmented } from '../components/Segmented';
import { useHoldForExit } from '../lib/motion';
import { AnimatePresence, motion } from 'motion/react';

type Mode = 'split' | 'map' | 'list';
const MODE_KEY = 'saferoute.map.mode';
const RAIN_KEY = 'saferoute.map.rain';
const SUMMARY_KEY = 'saferoute.map.summary';
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
  const [rain, setRainState] = useState(() => stored(RAIN_KEY, (v) => v === '1'));
  const setRain = (on: boolean) => { setRainState(on); remember(RAIN_KEY, on ? '1' : '0'); };
  const radar = useRadar(rain);
  const toast = useToast();
  const radarFailed = rain && !!radar.error && !radar.data;
  useEffect(() => { if (radarFailed) toast({ kind: 'error', message: 'Live radar unavailable right now.' }); }, [radarFailed, toast]);
  const weatherOverlay = rain && radar.data ? {
    url: radar.data.tileUrl, maxNativeZoom: RADAR_MAX_ZOOM + 1, attribution: `Radar: <a href="${RADAR_SOURCE_URL}">RainViewer</a>`,
  } : null;
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
  const preview = previewId && !selectedId ? mapHazards.find((h) => h.id === previewId) : undefined;
  const { shown: shownPreview, leaving: previewLeaving } = useHoldForExit(preview);
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

  const [resizing, setResizing] = useState(false);
  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX, startW = width;
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + startX - ev.clientX)));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      setWidth((w) => { remember(WIDTH_KEY, String(w)); return w; });
      setResizing(false);
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
    <div className={`map-page mode-${mode}${resizing ? ' resizing' : ''}`} style={{ '--queue-width': `${width}px` } as CSSProperties}>
      <section className="map-area" ref={mapRef}>
        <MapView hazards={mapHazards} selectedId={selectedId} highlightId={previewId} layer={layer}
          onSelect={(id) => { if (id !== selectedId) setPreviewId(id); }}
          barangays={barangays} highlightArea={c.area} pulseIds={c.queue.newIds} fitKey={c.filterKey}
          loading={c.queue.loading} insetRight={panelOpen ? width + GUTTER * 2 : 0}
          region={c.filters.region} drawing={drawing} controls weatherOverlay={weatherOverlay}
          onDrawn={(box) => { setDrawing(false); if (box) c.setFilters({ ...c.filters, region: box }); }}
          toolbar={<>
            <button type="button" className={drawing ? 'on' : undefined} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}
              aria-label={drawing ? 'Cancel area selection' : 'Select an area'} title={drawing ? 'Cancel (Esc)' : 'Select an area'}>
              <BoxSelect size={18} aria-hidden="true" />
            </button>
            <LayersButton layer={layer} onChange={setLayer} rain={rain} onRain={setRain} />
          </>} />

        <Segmented className="view-switch" label="View" value={mode} onChange={setMode} options={[
          { value: 'split', title: 'Map and list', label: <><PanelRight size={16} aria-hidden="true" /><span>Map + list</span></> },
          { value: 'map', title: 'Map only', label: <><MapIcon size={16} aria-hidden="true" /><span>Map</span></> },
          { value: 'list', title: 'List only', label: <><List size={16} aria-hidden="true" /><span>List</span></> },
        ]} />

        {(drawing || c.filters.region) && (
          <div className="map-hint" role="status">
            {drawing
              ? <>Drag on the map to select an area · Esc to cancel</>
              : <>Showing a selected area <button type="button" className="btn-link" onClick={() => c.setFilters({ ...c.filters, region: null })}>Clear</button></>}
          </div>
        )}

        <MapLegend layer={layer} rain={rain} />

        {mode !== 'list' && (
          <HazardSummary hazards={mapHazards} shown={c.shown} area={c.filters.area} needsReview={stats?.totals.needsReview}
            tabLabel={c.tab.label}
            onViewList={() => { if (mode === 'map') setMode('split'); window.setTimeout(() => searchRef.current?.focus(), 0); }} />
        )}

        {/* The card fades down on close (a CSS exit; Motion's transforms would fight its centring). */}
        {shownPreview && (
          <PreviewCard hazard={shownPreview} leaving={previewLeaving} barangays={barangays}
            onOpen={() => open(shownPreview.id)} onClose={() => setPreviewId(null)} />
        )}
      </section>

      {/* The panel slides 12 px and fades as it opens or closes; between Map + list and List it
          glides to its new edge (CSS). The list and a report's details crossfade inside it. */}
      <AnimatePresence initial={false}>
      {panelOpen && (
        <motion.aside key="panel" className="queue-panel floating" aria-label={selectedId ? 'Hazard details' : 'Hazard list'}
          initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0, transition: { duration: 0.24 } }}
          exit={{ opacity: 0, x: 12, transition: { duration: 0.18 } }}>
          {mode === 'split' && (
            <div className="panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize the panel"
              aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} tabIndex={0}
              onPointerDown={startResize} onKeyDown={resizeByKey} />
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={selectedId ?? 'list'} className="panel-swap"
              initial={{ opacity: 0, x: selectedId ? 16 : -8 }} animate={{ opacity: 1, x: 0, transition: { duration: 0.22 } }}
              exit={{ opacity: 0, x: selectedId ? 16 : -8, transition: { duration: 0.12 } }}>
              {selectedId
                ? <HazardDrawer variant="panel" hazardId={selectedId} barangays={barangays}
                    onClose={() => select(null)} onChanged={c.queue.reload} />
                : <QueuePanel c={c} tabs={MAP_TABS} stats={stats} barangays={barangays} selectedId={selectedId}
                    onSelect={(h) => select(h.id)} searchRef={searchRef} page="map" />}
            </motion.div>
          </AnimatePresence>
        </motion.aside>
      )}
      </AnimatePresence>
    </div>
  );
}

/** A marker's first click: what, where, how bad, and a way into the full report. */
function PreviewCard({ hazard: h, barangays, onOpen, onClose, leaving = false }: {
  hazard: Hazard; barangays: Barangay[]; onOpen: () => void; onClose: () => void; leaving?: boolean;
}) {
  const place = usePlace(h.latitude, h.longitude, barangays);
  return (
    <div className={`preview-card${leaving ? ' leaving' : ''}`} inert={leaving} role="dialog" aria-label={`${TYPE_LABEL[h.type]} preview`}>
      {/* Severity is the icon's colour, as in the hazard list. */}
      <span className={`row-icon sev-fill-${h.severity.toLowerCase()}`} title={`${SEVERITY_LABEL[h.severity]} severity`}>
        <TypeIcon type={h.type} size={18} />
        <span className="sr-only">{SEVERITY_LABEL[h.severity]} severity</span>
      </span>
      <div className="preview-main">
        <strong>{TYPE_LABEL[h.type]}</strong>
        <span className="muted">{place.label || 'Locating street…'}</span>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={onOpen} autoFocus>Open report<ArrowRight size={15} aria-hidden="true" /></button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close preview"><X size={16} aria-hidden="true" /></button>
    </div>
  );
}

/**
 * Totals for what the map shows, floating over it: Makati by default, or the barangay picked
 * through the filters, search or a Places suggestion. Collapses to a pill.
 */
function HazardSummary({ hazards, shown, area, needsReview, tabLabel, onViewList }: {
  hazards: Hazard[]; shown: Hazard[]; area: string; needsReview?: number; tabLabel: string; onViewList: () => void;
}) {
  const [open, setOpen] = useState(() => stored(SUMMARY_KEY, (v) => v !== '0'));
  const toggle = () => setOpen((o) => { remember(SUMMARY_KEY, o ? '0' : '1'); return !o; });
  const list = area ? shown : hazards;
  const high = list.filter((h) => h.severity === 'HIGH').length;
  const byType = new Map<HazardType, number>();
  for (const h of list) byType.set(h.type, (byType.get(h.type) ?? 0) + 1);
  const top = [...byType].sort((a, b) => b[1] - a[1])[0];
  const title = area || 'Makati';

  if (!open) {
    return (
      <button type="button" className="hazard-summary-pill glass" onClick={toggle} aria-expanded={false}>
        <strong>{title}</strong><span>{list.length}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
    );
  }
  return (
    <section className="hazard-summary glass" aria-label={`${title} summary`}>
      <div className="hazard-summary-head">
        <span><strong>{title}</strong><small>{tabLabel}</small></span>
        <button type="button" className="icon-btn" onClick={toggle} aria-label="Collapse summary" aria-expanded={true}><ChevronUp size={15} aria-hidden="true" /></button>
      </div>
      <dl>
        <div><dt>Hazards</dt><dd>{list.length}</dd></div>
        <div><dt>High severity</dt><dd className={high ? 'hot' : undefined}>{high}</dd></div>
        {area
          ? <div><dt>Most common</dt><dd>{top ? `${top[1]} ${TYPE_LABEL[top[0]].toLowerCase()}` : '—'}</dd></div>
          : <div><dt>Needs review</dt><dd>{needsReview ?? '–'}</dd></div>}
      </dl>
      <button type="button" className="btn-link" onClick={onViewList}>View list<ArrowRight size={14} aria-hidden="true" /></button>
    </section>
  );
}
