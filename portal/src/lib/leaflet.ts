// leaflet.markercluster and leaflet.heat extend a global `L`; this module runs before they load.
import L from 'leaflet';
import type { Barangay } from './geo';
import 'leaflet/dist/leaflet.css';

(window as unknown as { L: typeof L }).L = L;

export default L;

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const GRAY_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Makati as outer rings ([lon, lat]) and a bounding box, from the bundled barangay boundaries. */
interface Shape { rings: number[][][]; minLat: number; minLon: number; maxLat: number; maxLon: number }

function makatiShape(barangays: Barangay[]): Shape | null {
  if (!barangays.length) return null;
  const rings = barangays.flatMap((b) => b.polygons.map((p) => p[0]));
  return {
    rings,
    minLat: Math.min(...barangays.map((b) => b.bbox[0])), minLon: Math.min(...barangays.map((b) => b.bbox[1])),
    maxLat: Math.max(...barangays.map((b) => b.bbox[2])), maxLon: Math.max(...barangays.map((b) => b.bbox[3])),
  };
}

/**
 * Esri tiles drawn on canvases and clipped to Makati: `inside` keeps only Makati, `outside` cuts
 * it out. Clipping per tile keeps the edge aligned through pans and zoom animations. Filling every
 * barangay's outer ring with the nonzero rule paints their union, so inner borders never show.
 */
const ClippedTiles = L.GridLayer.extend({
  initialize(this: L.GridLayer & { _url: string; _shape: Shape; _mode: 'inside' | 'outside' }, url: string, shape: Shape,
    mode: 'inside' | 'outside', options: L.GridLayerOptions) {
    this._url = url;
    this._shape = shape;
    this._mode = mode;
    L.setOptions(this, options);
  },
  createTile(this: L.GridLayer & { _url: string; _shape: Shape; _mode: 'inside' | 'outside'; _map: L.Map },
    coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const origin = coords.scaleBy(size);
    const nw = this._map.unproject(origin, coords.z);
    const se = this._map.unproject(origin.add(size), coords.z);
    const s = this._shape;
    const touches = !(se.lat > s.maxLat || nw.lat < s.minLat || se.lng < s.minLon || nw.lng > s.maxLon);
    if (this._mode === 'inside' && !touches) {
      window.setTimeout(() => done(undefined, tile), 0);
      return tile;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = tile.getContext('2d')!;
      const path = new Path2D();
      if (touches) {
        for (const ring of s.rings) {
          ring.forEach(([lon, lat], i) => {
            const p = this._map.project([lat, lon], coords.z).subtract(origin);
            if (i) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
          });
          path.closePath();
        }
      }
      if (this._mode === 'inside') {
        ctx.save();
        ctx.clip(path, 'nonzero');
        ctx.drawImage(img, 0, 0, size.x, size.y);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, size.x, size.y);
        if (touches) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fill(path, 'nonzero');
        }
      }
      done(undefined, tile);
    };
    img.onerror = () => done(new Error('tile failed'), tile);
    img.src = this._url.replace('{z}', String(coords.z)).replace('{y}', String(coords.y)).replace('{x}', String(coords.x));
    return tile;
  },
}) as unknown as new (url: string, shape: Shape, mode: 'inside' | 'outside', options: L.GridLayerOptions) => L.GridLayer;

/**
 * The base map: Esri's Light / Dark Gray Canvas everywhere, with Makati itself drawn from Esri's
 * detailed, coloured street map, so the city stands out and its surroundings recede. The gray
 * canvas labels skip Makati (the street map has its own). No API keys. Without barangays (still
 * loading) it is the plain gray canvas.
 */
export function baseTiles(dark: boolean, barangays: Barangay[] = []) {
  const style = dark ? 'Dark' : 'Light';
  const gray = (kind: 'Base' | 'Reference') => `${ESRI}/Canvas/World_${style}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
  const canvas = { maxZoom: 20, maxNativeZoom: 16 };
  const shape = makatiShape(barangays);
  if (!shape) {
    return L.layerGroup([
      L.tileLayer(gray('Base'), { ...canvas, attribution: GRAY_ATTRIBUTION }),
      L.tileLayer(gray('Reference'), canvas),
    ]);
  }
  return L.layerGroup([
    L.tileLayer(gray('Base'), { ...canvas, attribution: GRAY_ATTRIBUTION }),
    new ClippedTiles(`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, shape, 'inside',
      { maxZoom: 20, maxNativeZoom: 19, className: 'makati-detail' }),
    new ClippedTiles(gray('Reference'), shape, 'outside', { ...canvas }),
  ]);
}
