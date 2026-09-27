// Where a hazard is, in words: the Makati barangay it falls in (bundled OSM boundaries) and the
// street (OpenStreetMap Nominatim, looked up slowly and remembered in this browser).

export interface Barangay {
  name: string;
  /** Outer rings then holes, as [lon, lat] pairs; one entry per polygon part. */
  polygons: number[][][][];
  /** [minLat, minLon, maxLat, maxLon] */
  bbox: [number, number, number, number];
}

type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

let barangays: Promise<Barangay[]> | null = null;

export function loadBarangays(): Promise<Barangay[]> {
  if (!barangays) {
    barangays = fetch(`${import.meta.env.BASE_URL}makati-barangays.geojson`)
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((fc: { features: { properties: { name: string }; geometry: Geometry }[] }) =>
        fc.features.map((f) => {
          const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
          let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
          for (const poly of polygons) for (const [lon, lat] of poly[0]) {
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
          }
          return { name: f.properties.name, polygons, bbox: [minLat, minLon, maxLat, maxLon] as Barangay['bbox'] };
        })
        .sort((a, b) => a.name.localeCompare(b.name)))
      .catch(() => []);
  }
  return barangays;
}

function inRing(lat: number, lon: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(b: Barangay, lat: number, lon: number) {
  const [minLat, minLon, maxLat, maxLon] = b.bbox;
  if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) return false;
  return b.polygons.some(([outer, ...holes]) => inRing(lat, lon, outer) && !holes.some((h) => inRing(lat, lon, h)));
}

export function barangayAt(list: Barangay[], lat: number, lon: number): Barangay | undefined {
  return list.find((b) => contains(b, lat, lon));
}

// --- Streets ---------------------------------------------------------------------------------

const STREET_CACHE_KEY = 'saferoute.streets.v1';
/** ~11 m: hazards this close share a street name. */
const key = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

const streets: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(STREET_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
})();
const pending = new Map<string, { lat: number; lon: number }>();
const streetListeners = new Set<() => void>();
let timer: number | undefined;

function save() {
  try {
    localStorage.setItem(STREET_CACHE_KEY, JSON.stringify(streets));
  } catch { /* storage full or blocked: names are just looked up again */ }
}

/** The cached street name, or undefined (and a lookup is queued). Empty string = none found. */
export function streetAt(lat: number, lon: number): string | undefined {
  const k = key(lat, lon);
  if (k in streets) return streets[k];
  if (!pending.has(k)) {
    pending.set(k, { lat, lon });
    schedule();
  }
  return undefined;
}

export function onStreetsChange(listener: () => void) {
  streetListeners.add(listener);
  return () => { streetListeners.delete(listener); };
}

/** Nominatim's usage policy allows one request per second. */
function schedule() {
  if (timer !== undefined) return;
  timer = window.setTimeout(async () => {
    timer = undefined;
    const next = pending.entries().next();
    if (next.done) return;
    const [k, { lat, lon }] = next.value;
    pending.delete(k);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (res.ok) {
        const data = await res.json();
        const a = data.address ?? {};
        streets[k] = a.road || a.pedestrian || a.footway || a.path || a.square || a.neighbourhood || '';
        save();
        streetListeners.forEach((l) => l());
      }
    } catch { /* offline: leave it for next time */ }
    if (pending.size) schedule();
  }, 1100);
}

/** Every cached street name, for search. */
export function cachedStreet(lat: number, lon: number) {
  return streets[key(lat, lon)];
}
