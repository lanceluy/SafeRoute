import { useEffect, useRef } from 'react';
import L from '../lib/leaflet';
import type { Barangay } from '../lib/geo';
import { sequentialColor } from '../lib/scales';
import { useThemeColors } from '../lib/theme';

const MAKATI: L.LatLngTuple = [14.5547, 121.0244];
/** The "wide" framing: Metro Manila around Makati, e.g. for live radar. */
const WIDE_ZOOM = 11;

export interface MapOverlay {
  /** Leaflet tile URL template. */
  url: string;
  attribution: string;
  /** Leaflet caps the zoom before applying the offset, so a 512 px layer capped at zoom N passes N + 1. */
  maxNativeZoom?: number;
  tileSize?: number;
  zoomOffset?: number;
}

/**
 * Makati's barangays shaded by a value on the shared blue ramp (0 → `max`), with a tooltip per
 * barangay; or outlines only over a tile overlay such as radar. The overlay gets its own pane:
 * dark mode inverts the street tiles, and an overlay's colours must not be inverted with them.
 */
export function AreaMap({ barangays, values, max, format, overlay, framing = 'fit', label }: {
  barangays: Barangay[];
  /** Value per barangay name; null draws outlines only. */
  values: Map<string, number | null> | null;
  max: number;
  /** Tooltip text for a barangay's value (null = not shaded or no data). */
  format: (value: number | null, name: string) => string;
  overlay?: MapOverlay | null;
  framing?: 'fit' | 'wide';
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shapes = useRef<L.GeoJSON | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const colors = useThemeColors();
  const formatRef = useRef(format);
  useEffect(() => { formatRef.current = format; });

  useEffect(() => {
    const m = L.map(el.current!, { scrollWheelZoom: false, zoomControl: true }).setView(MAKATI, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
    }).addTo(m);
    m.createPane('overlay').style.zIndex = '250'; // above the street tiles (200), below the shapes (400)
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current!);
    return () => { resize.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !barangays.length) return;
    if (framing === 'wide') {
      m.setView(MAKATI, WIDE_ZOOM);
    } else {
      m.fitBounds(L.latLngBounds(barangays.flatMap((b) => [[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[3]]] as L.LatLngTuple[])),
        { padding: [12, 12] });
    }
  }, [framing, barangays]);

  useEffect(() => {
    const m = map.current;
    if (!m || !barangays.length) return;
    shapes.current?.remove();
    const outline = { color: colors.navy, weight: 1, opacity: colors.dark ? 0.6 : 0.5 };
    shapes.current = L.geoJSON({
      type: 'FeatureCollection',
      features: barangays.map((b) => ({
        type: 'Feature', properties: { name: b.name }, geometry: { type: 'MultiPolygon', coordinates: b.polygons },
      })),
    } as GeoJSON.FeatureCollection, {
      style: (f) => {
        const value = values?.get(f?.properties.name);
        return value == null
          ? { ...outline, fillColor: colors.navy, fillOpacity: values ? 0.08 : 0 }
          : { ...outline, fillColor: sequentialColor(value, max), fillOpacity: 0.62 };
      },
      onEachFeature: (f, layer) => {
        layer.bindTooltip(() => `<strong>${f.properties.name}</strong><br>${formatRef.current(values?.get(f.properties.name) ?? null, f.properties.name)}`,
          { sticky: true, className: 'area-tip' });
        layer.on({
          mouseover: () => (layer as L.Path).setStyle({ weight: 3, opacity: 1 }),
          mouseout: () => shapes.current?.resetStyle(layer),
        });
      },
    }).addTo(m);
  }, [barangays, values, max, colors.navy, colors.dark]);

  useEffect(() => {
    const m = map.current;
    tiles.current?.remove();
    tiles.current = null;
    if (!m || !overlay) return;
    tiles.current = L.tileLayer(overlay.url, {
      pane: 'overlay', opacity: 0.7, attribution: overlay.attribution,
      tileSize: overlay.tileSize ?? 256, zoomOffset: overlay.zoomOffset ?? 0, maxNativeZoom: overlay.maxNativeZoom,
    }).addTo(m);
  }, [overlay?.url, overlay?.attribution, overlay?.maxNativeZoom, overlay?.tileSize, overlay?.zoomOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="area-map" role="img" aria-label={label} />;
}
