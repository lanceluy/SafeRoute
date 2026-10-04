import { useEffect, useRef, type ReactNode } from 'react';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import L, { baseTiles, radarTiles } from '../lib/leaflet';
import { useThemeColors } from '../lib/theme';
import 'leaflet.markercluster';
import 'leaflet.heat';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { Hazard, Severity } from '../api/types';
import type { Barangay } from '../lib/geo';
import { STATUS_LABEL, TYPE_LABEL, typeIcon } from '../lib/hazards';

/** density: every hazard alike · severity: high counts most · high: high severity only · age: older counts more. */
export type MapLayer = 'markers' | 'density' | 'severity' | 'high' | 'age';

const MAKATI: L.LatLngTuple = [14.5547, 121.0244];
// The gray canvas tiles are native up to 16; beyond that they are upscaled and the labels blur.
const FOCUS_ZOOM = 16;
const HEAT_WEIGHT: Record<Severity, number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.3 };
/** In the age layer a hazard reaches full weight after two weeks unresolved. */
const AGE_FULL_DAYS = 14;

function heatWeight(h: Hazard, layer: MapLayer, now: number) {
  if (layer === 'severity') return HEAT_WEIGHT[h.severity];
  if (layer === 'age') return Math.max(0.15, Math.min(1, (now - Date.parse(h.createdAt)) / 86_400_000 / AGE_FULL_DAYS));
  return 0.7;
}

/**
 * One colour (severity) and one white glyph (type). Status lives in the list and the inspector;
 * only Contested earns a small corner mark. The selected marker grows and gets a halo.
 */
function pinIcon(h: Hazard, selected: boolean, pulse: boolean) {
  const size = selected ? 46 : 34;
  return L.divIcon({
    className: 'pin-wrap',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="pin sev-bg-${h.severity.toLowerCase()} pin-${h.status.toLowerCase()}${selected ? ' pin-selected' : ''}${pulse ? ' pin-pulse' : ''}">`
      + `${typeIcon(h.type, selected ? 22 : 17)}${h.status === 'DISPUTED' ? '<span class="pin-status" aria-hidden="true">!</span>' : ''}</div>`,
  });
}

/**
 * Clusters are neutral: a group mixes severities, so one fill colour would mislead. A red ring
 * says "at least one high severity inside".
 */
function clusterIcon(cluster: L.MarkerCluster) {
  const markers = cluster.getAllChildMarkers() as (L.Marker & { hazard?: Hazard })[];
  const high = markers.filter((m) => m.hazard?.severity === 'HIGH').length;
  const n = cluster.getChildCount();
  const size = n < 10 ? 40 : n < 50 ? 48 : 56;
  const label = `${n} hazards${high ? `, ${high} high severity` : ''}`;
  return L.divIcon({
    className: 'pin-wrap',
    iconSize: [size, size],
    // Just the number on the map; the full wording stays for hover and screen readers.
    html: `<div class="cluster${high ? ' cluster-has-high' : ''}" style="width:${size}px;height:${size}px" role="img" aria-label="${label}" title="${label}"><strong>${n}</strong></div>`,
  });
}

/**
 * Leaflet map of hazards: clustered markers (color = severity, glyph = type, corner mark =
 * status) or a heatmap, plus barangay outlines. Selecting reveals and enlarges the marker.
 */
export function MapView({ hazards, selectedId, highlightId, onSelect, layer, barangays, highlightArea, pulseIds, fitKey, loading, insetRight = 0,
  region, drawing = false, onDrawn, toolbar, controls = false, weatherOverlay }: {
  hazards: Hazard[];
  selectedId?: string | null;
  /** Shown like the selection (bigger, others dimmed) without moving the map: a marker preview. */
  highlightId?: string | null;
  /** Extra buttons for the floating toolbar, after zoom and recenter. */
  toolbar?: ReactNode;
  /** Show the floating toolbar (zoom, recenter, then `toolbar`). Otherwise Leaflet's zoom control. */
  controls?: boolean;
  /** Live rain radar tiles drawn above the streets and below the markers. */
  weatherOverlay?: { url: string; maxNativeZoom: number; attribution: string } | null;
  onSelect?: (id: string) => void;
  layer: MapLayer;
  barangays?: Barangay[];
  highlightArea?: Barangay | null;
  pulseIds?: Set<string>;
  /** Changing it re-fits the map to the hazards (e.g. after a filter change). */
  fitKey?: string;
  loading?: boolean;
  /** Pixels on the right hidden behind an overlay (the details drawer). */
  insetRight?: number;
  /** A selected area to outline: [minLat, minLon, maxLat, maxLon]. */
  region?: [number, number, number, number] | null;
  /** While true, dragging draws a box instead of panning; onDrawn gets the box. */
  drawing?: boolean;
  onDrawn?: (box: [number, number, number, number] | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const cluster = useRef<L.MarkerClusterGroup | null>(null);
  const heat = useRef<L.HeatLayer | null>(null);
  const areas = useRef<L.GeoJSON | null>(null);
  const highlight = useRef<L.GeoJSON | null>(null);
  const markers = useRef(new Map<string, L.Marker & { hazard?: Hazard }>());
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  const colors = useThemeColors();
  const navyRef = useRef(colors.navy);
  useEffect(() => { navyRef.current = colors.navy; });

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: !controls, preferCanvas: false }).setView(MAKATI, 14);
    // Group generously at city scale; street level shows every hazard.
    cluster.current = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 80, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon,
      // Street level shows every hazard, so selecting one never needs to zoom further than this.
      disableClusteringAtZoom: FOCUS_ZOOM,
      chunkedLoading: true,
    });
    // Rain radar sits above the tiles and outlines (400 is the overlay pane) but below the markers (600).
    m.createPane('weather').style.zIndex = '450';
    m.getPane('weather')!.style.pointerEvents = 'none';
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current!);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The base map follows the theme.
  const base = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    base.current?.remove();
    base.current = baseTiles(colors.dark, barangays).addTo(m);
  }, [colors.dark, barangays]);

  // Live rain radar, when asked for.
  const radar = useRef<L.GridLayer | null>(null);
  useEffect(() => {
    const m = map.current;
    radar.current?.remove();
    radar.current = null;
    if (!m || !weatherOverlay) return;
    radar.current = radarTiles(weatherOverlay.url, {
      pane: 'weather', opacity: 0.6, maxUrlZoom: weatherOverlay.maxNativeZoom - 1, attribution: weatherOverlay.attribution,
    }).addTo(m);
  }, [weatherOverlay?.url, weatherOverlay?.maxNativeZoom, weatherOverlay?.attribution]); // eslint-disable-line react-hooks/exhaustive-deps

  // Barangay outlines, faint; the selected area stands out.
  useEffect(() => {
    const m = map.current;
    if (!m || !barangays?.length) return;
    areas.current?.remove();
    areas.current = L.geoJSON({
      type: 'FeatureCollection',
      features: barangays.map((b) => ({
        type: 'Feature', properties: { name: b.name }, geometry: { type: 'MultiPolygon', coordinates: b.polygons },
      })),
    } as GeoJSON.FeatureCollection, {
      interactive: false,
      style: { color: colors.navy, weight: 1, opacity: colors.dark ? 0.45 : 0.25, fillOpacity: 0 },
    }).addTo(m);
    areas.current.bringToBack();
  }, [barangays, colors.navy, colors.dark]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    highlight.current?.remove();
    highlight.current = null;
    if (!highlightArea) return;
    highlight.current = L.geoJSON({
      type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: highlightArea.polygons },
    } as GeoJSON.Feature, { interactive: false, style: { color: colors.navy, weight: 2.5, opacity: 0.9, fillColor: colors.navy, fillOpacity: 0.08 } })
      .addTo(m);
    const [a, b, c, d] = highlightArea.bbox;
    m.flyToBounds([[a, b], [c, d]], { padding: [24, 24], duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightArea]);

  // Markers or heat.
  useEffect(() => {
    const m = map.current;
    const group = cluster.current;
    if (!m || !group) return;
    group.clearLayers();
    markers.current.clear();
    heat.current?.remove();
    heat.current = null;
    if (layer === 'markers') {
      const list = hazards.map((h) => {
        const marker = L.marker([h.latitude, h.longitude], {
          icon: pinIcon(h, h.id === selectedId, !!pulseIds?.has(h.id)),
          keyboard: true,
          title: `${TYPE_LABEL[h.type]}, ${h.severity.toLowerCase()} severity, ${STATUS_LABEL[h.status].toLowerCase()}`,
          riseOnHover: true,
          zIndexOffset: h.id === selectedId ? 1000 : 0,
        }) as L.Marker & { hazard?: Hazard };
        marker.hazard = h;
        marker.on('click', () => onSelectRef.current?.(h.id));
        markers.current.set(h.id, marker);
        return marker;
      });
      group.addLayers(list);
      if (!m.hasLayer(group)) m.addLayer(group);
    } else {
      if (m.hasLayer(group)) m.removeLayer(group);
      const now = Date.now();
      heat.current = L.heatLayer(
        (layer === 'high' ? hazards.filter((h) => h.severity === 'HIGH') : hazards)
          .map((h) => [h.latitude, h.longitude, heatWeight(h, layer, now)] as L.HeatLatLngTuple),
        {
          radius: 28, blur: 22, maxZoom: 17, minOpacity: 0.3,
          gradient: layer === 'severity' || layer === 'high'
            ? { 0.2: '#F6D365', 0.5: '#F79009', 0.8: '#D92D20', 1: '#7A1A12' }
            : { 0.2: '#9EC5F8', 0.5: '#3B7DD8', 0.8: '#173B67', 1: '#0B1F3A' },
        },
      ).addTo(m);
    }
    // Selection and pulses are applied below without rebuilding everything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazards, layer]);

  // Selected (or previewed) marker: bigger and on top; a selection is also revealed and centered.
  const focusId = selectedId ?? highlightId ?? null;
  const lastSelected = useRef<string | null>(null);
  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastSelected.current;
    if (prev && prev !== focusId) {
      const old = markers.current.get(prev);
      if (old?.hazard) { old.setIcon(pinIcon(old.hazard, false, false)); old.setZIndexOffset(0); }
    }
    lastSelected.current = focusId;
    if (!selectedId) flownTo.current = null;
    const m = map.current;
    const focused = focusId ? markers.current.get(focusId) : undefined;
    if (focused?.hazard) { focused.setIcon(pinIcon(focused.hazard, true, false)); focused.setZIndexOffset(1000); }
    const marker = selectedId ? markers.current.get(selectedId) : undefined;
    if (!m || !marker?.hazard) return;
    // Live refreshes rebuild the markers; only move the map when the selection itself changes.
    if (flownTo.current === selectedId) return;
    flownTo.current = selectedId ?? null;
    // Center it in the part of the map the details drawer doesn't cover.
    const zoom = Math.max(m.getZoom(), FOCUS_ZOOM);
    const point = m.project(marker.getLatLng(), zoom).add([insetRight / 2, 0]);
    m.flyTo(m.unproject(point, zoom), zoom, { duration: 0.5 });
  }, [selectedId, focusId, hazards, layer, insetRight]);

  useEffect(() => {
    if (!pulseIds?.size) return;
    for (const id of pulseIds) {
      const marker = markers.current.get(id);
      if (marker?.hazard && id !== selectedId) marker.setIcon(pinIcon(marker.hazard, false, true));
    }
  }, [pulseIds, selectedId]);

  // The selected area, outlined.
  const regionLayer = useRef<L.Rectangle | null>(null);
  useEffect(() => {
    const m = map.current;
    regionLayer.current?.remove();
    regionLayer.current = null;
    if (!m || !region) return;
    regionLayer.current = L.rectangle([[region[0], region[1]], [region[2], region[3]]], {
      color: colors.navy, weight: 2, dashArray: '6 4', fillColor: colors.navy, fillOpacity: 0.06, interactive: false,
    }).addTo(m);
  }, [region, colors.navy]);

  // Drawing a box: press, drag, release. Panning is off meanwhile; Esc cancels.
  const onDrawnRef = useRef(onDrawn);
  useEffect(() => { onDrawnRef.current = onDrawn; });
  useEffect(() => {
    const m = map.current;
    if (!m || !drawing) return;
    m.dragging.disable();
    const container = m.getContainer();
    container.classList.add('drawing');
    let start: L.LatLng | null = null;
    let box: L.Rectangle | null = null;
    const down = (e: L.LeafletMouseEvent) => { start = e.latlng; };
    const move = (e: L.LeafletMouseEvent) => {
      if (!start) return;
      const bounds = L.latLngBounds(start, e.latlng);
      if (box) box.setBounds(bounds);
      else box = L.rectangle(bounds, { color: navyRef.current, weight: 2, fillOpacity: 0.08, interactive: false }).addTo(m);
    };
    const up = (e: L.LeafletMouseEvent) => {
      if (!start) return;
      const b = L.latLngBounds(start, e.latlng);
      start = null;
      box?.remove();
      box = null;
      // A click without a drag isn't an area.
      if (b.getNorth() - b.getSouth() < 1e-4 || b.getEast() - b.getWest() < 1e-4) return;
      onDrawnRef.current?.([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onDrawnRef.current?.(null); };
    m.on('mousedown', down);
    m.on('mousemove', move);
    m.on('mouseup', up);
    document.addEventListener('keydown', key);
    return () => {
      m.off('mousedown', down);
      m.off('mousemove', move);
      m.off('mouseup', up);
      document.removeEventListener('keydown', key);
      box?.remove();
      container.classList.remove('drawing');
      m.dragging.enable();
    };
  }, [drawing]);

  // Fit to the hazards once per filter change, when they arrive (not on every live update).
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !fitKey || !hazards.length || fittedFor.current === fitKey) return;
    fittedFor.current = fitKey;
    if (selectedId || highlightArea) return;
    const bounds = L.latLngBounds(hazards.map((h) => [h.latitude, h.longitude] as L.LatLngTuple));
    m.fitBounds(bounds.pad(0.15), { maxZoom: 16, animate: true });
  }, [fitKey, hazards, selectedId, highlightArea]);

  const zoom = (by: number) => map.current?.setZoom(map.current.getZoom() + by);
  // Back to the whole picture: every hazard shown, or Makati when there are none.
  const recenter = () => {
    const m = map.current;
    if (!m) return;
    if (hazards.length) m.flyToBounds(L.latLngBounds(hazards.map((h) => [h.latitude, h.longitude] as L.LatLngTuple)).pad(0.15), { maxZoom: 16, duration: 0.5 });
    else m.flyTo(MAKATI, 14, { duration: 0.5 });
  };

  return (
    <div className={`map-shell${focusId ? ' has-focus' : ''}`}>
      <div ref={el} className="map" role="region" aria-label="Hazard map" />
      {controls && (
        <div className="map-toolbar" role="toolbar" aria-label="Map controls">
          <div className="map-toolbar-group">
            <button type="button" onClick={() => zoom(1)} aria-label="Zoom in" title="Zoom in"><Plus size={18} aria-hidden="true" /></button>
            <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out" title="Zoom out"><Minus size={18} aria-hidden="true" /></button>
          </div>
          <div className="map-toolbar-group">
            <button type="button" onClick={recenter} aria-label="Show all hazards" title="Show all hazards"><LocateFixed size={18} aria-hidden="true" /></button>
            {toolbar}
          </div>
        </div>
      )}
      {loading && <div className="map-loading" role="status"><span className="spinner" aria-hidden="true" />Loading hazards…</div>}
    </div>
  );
}
