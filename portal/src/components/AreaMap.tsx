import { useEffect, useLayoutEffect, useRef } from 'react';
import L, { baseTiles, radarTiles } from '../lib/leaflet';
import type { Barangay } from '../lib/geo';
import { sequentialColor } from '../lib/scales';
import { useThemeColors } from '../lib/theme';
import { prefersReducedMotion } from '../lib/motion';

const OVERLAY_PANES = ['overlay-a', 'overlay-b'] as const;
const MAKATI: L.LatLngTuple = [14.5547, 121.0244];

/** Makati framed with even padding at the map's real size. */
function fitMakati(m: L.Map, barangays: Barangay[], animate: boolean) {
  if (!barangays.length) return;
  m.invalidateSize();
  const bounds = L.latLngBounds(barangays.flatMap((b) => [[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[3]]] as L.LatLngTuple[]));
  if (animate) m.flyToBounds(bounds, { padding: [28, 28], duration: 0.6 });
  else m.fitBounds(bounds, { padding: [28, 28], animate: false });
}

export interface MapOverlay {
  /** Leaflet tile URL template. */
  url: string;
  attribution: string;
  /** The highest zoom the radar serves, counted on Leaflet's 256 px grid (RainViewer's own 512 px zoom + 1). */
  maxNativeZoom?: number;
}

/**
 * Makati's barangays shaded by a value on the shared blue ramp (0 → `max`), with a tooltip per
 * barangay; or outlines only over a tile overlay such as radar. The overlay gets its own pane:
 * dark mode inverts the street tiles, and an overlay's colours must not be inverted with them.
 */
export function AreaMap({ barangays, values, max, format, overlay, label }: {
  barangays: Barangay[];
  /** Value per barangay name; null draws outlines only. */
  values: Map<string, number | null> | null;
  max: number;
  /** Tooltip text for a barangay's value (null = not shaded or no data). */
  format: (value: number | null, name: string) => string;
  overlay?: MapOverlay | null;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shapes = useRef<L.GeoJSON | null>(null);
  const tiles = useRef<L.GridLayer | null>(null);
  const colors = useThemeColors();
  const formatRef = useRef(format);
  useEffect(() => { formatRef.current = format; });
  const barangaysRef = useRef(barangays);
  useEffect(() => { barangaysRef.current = barangays; });

  useEffect(() => {
    // Quarter-zoom steps let a fit frame Makati snugly instead of rounding down a whole level.
    const m = L.map(el.current!, { scrollWheelZoom: false, zoomControl: true, zoomSnap: 0.25 }).setView(MAKATI, 13);
    // Two overlay panes, above the street tiles (200) and below the shapes (400): the old and new
    // overlays fade in their own panes. (Leaflet resets a tile layer's own opacity as tiles load.)
    for (const name of OVERLAY_PANES) {
      const pane = m.createPane(name);
      pane.style.zIndex = '250';
      pane.style.transition = 'opacity 300ms cubic-bezier(0.2, 0.7, 0.2, 1)';
    }
    map.current = m;
    const resize = new ResizeObserver(() => {
      fitMakati(m, barangaysRef.current, false);
    });
    resize.observe(el.current!);
    return () => { resize.disconnect(); m.remove(); map.current = null; };
  }, []);

  // The base map follows the theme.
  const base = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    base.current?.remove();
    base.current = baseTiles(colors.dark, barangays).addTo(m);
  }, [colors.dark, barangays]);

  useEffect(() => {
    const m = map.current;
    if (m) fitMakati(m, barangays, false);
  }, [barangays]);

  // The selected barangay keeps a bold outline (the browser's focus box around an SVG path is a rectangle).
  const selected = useRef<string | null>(null);

  // Shading reads the latest values through a ref, so new values restyle the same shapes (and
  // their fills ease, see .area-map in CSS) instead of redrawing the map.
  const shade = useRef({ values, max });
  useLayoutEffect(() => { shade.current = { values, max }; });
  const styleFor = useRef<(f?: GeoJSON.Feature) => L.PathOptions>(() => ({}));

  useEffect(() => {
    const m = map.current;
    if (!m || !barangays.length) return;
    shapes.current?.remove();
    const outline = { color: colors.navy, weight: 1, opacity: colors.dark ? 0.6 : 0.5 };
    const bold = { weight: 3, opacity: 1 };
    styleFor.current = (f) => {
      const { values: v, max: top } = shade.current;
      const value = v?.get(f?.properties?.name);
      const edge = f?.properties?.name === selected.current ? { ...outline, ...bold } : outline;
      return value == null
        ? { ...edge, fillColor: colors.navy, fillOpacity: v ? 0.08 : 0 }
        // Lighter than before so Makati's streets still read under the shading.
        : { ...edge, fillColor: sequentialColor(value, top), fillOpacity: 0.5 };
    };
    shapes.current = L.geoJSON({
      type: 'FeatureCollection',
      features: barangays.map((b) => ({
        type: 'Feature', properties: { name: b.name }, geometry: { type: 'MultiPolygon', coordinates: b.polygons },
      })),
    } as GeoJSON.FeatureCollection, {
      style: (f) => styleFor.current(f),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(() => `<strong>${f.properties.name}</strong><br>${formatRef.current(shade.current.values?.get(f.properties.name) ?? null, f.properties.name)}`,
          { sticky: true, className: 'area-tip' });
        const path = layer as L.Path;
        const select = () => {
          selected.current = f.properties.name;
          shapes.current?.resetStyle();
          path.setStyle(bold).bringToFront();
        };
        layer.on({
          mouseover: () => path.setStyle(bold),
          mouseout: () => { if (selected.current !== f.properties.name) shapes.current?.resetStyle(layer); },
          click: select,
          add: () => path.getElement()?.addEventListener('focus', select),
        });
      },
    }).addTo(m);
  }, [barangays, colors.navy, colors.dark]);

  useEffect(() => { shapes.current?.setStyle((f) => styleFor.current(f)); }, [values, max]);

  // The overlay crossfades over 300 ms when it's switched on, off or replaced.
  const paneTurn = useRef(0);
  useEffect(() => {
    const m = map.current;
    const old = tiles.current;
    tiles.current = null;
    if (old && m) {
      const pane = m.getPane(old.options.pane!)!;
      pane.style.opacity = '0';
      window.setTimeout(() => old.remove(), prefersReducedMotion() ? 0 : 300);
    }
    if (!m || !overlay) return;
    paneTurn.current = 1 - paneTurn.current;
    const name = OVERLAY_PANES[paneTurn.current];
    const pane = m.getPane(name)!;
    pane.style.transition = 'none';
    pane.style.opacity = '0';
    tiles.current = radarTiles(overlay.url, {
      pane: name, opacity: 0.7, maxUrlZoom: (overlay.maxNativeZoom ?? 8) - 1, attribution: overlay.attribution,
    }).addTo(m);
    void pane.offsetWidth; // commit opacity 0 before fading in
    pane.style.transition = 'opacity 300ms cubic-bezier(0.2, 0.7, 0.2, 1)';
    pane.style.opacity = '1';
  }, [overlay?.url, overlay?.attribution, overlay?.maxNativeZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="area-map" role="img" aria-label={label} />;
}
