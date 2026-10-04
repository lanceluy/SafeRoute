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

const TILE = 256;

/** One outer ring in world pixels at one zoom, with its bounds, so a tile only walks the rings it touches. */
interface PixelRing { pts: Float64Array; minX: number; minY: number; maxX: number; maxY: number }

type MakatiSelf = L.GridLayer & {
  _shape: Shape; _dark: boolean; _rings: Map<number, PixelRing[]>; _map: L.Map; _scratch?: HTMLCanvasElement;
  _ringsFor(z: number): PixelRing[];
};

/** A tile of an Esri source at a (possibly lower) native zoom, and which part of it covers our tile. */
function loadSource(template: string, maxNative: number, coords: L.Coords) {
  const factor = 2 ** Math.max(0, coords.z - maxNative);
  const z = coords.z - Math.log2(factor);
  const x = Math.floor(coords.x / factor), y = Math.floor(coords.y / factor);
  const url = template.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
  const sw = TILE / factor;
  const sx = (((coords.x % factor) + factor) % factor) * sw, sy = (((coords.y % factor) + factor) % factor) * sw;
  return new Promise<{ img: HTMLImageElement; sx: number; sy: number; sw: number } | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ img, sx, sy, sw });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The whole base map as ONE canvas per tile: Esri's Light / Dark Gray Canvas everywhere, Makati
 * itself from Esri's detailed street map (clipped to the city outline), and the gray canvas's
 * labels everywhere except inside Makati (the street map has its own). Three stacked tile layers
 * used to mean three full-screen layers to composite on every pan frame; this is one.
 *
 * Clipping per tile keeps the edge aligned through pans and zooms. Filling every barangay's outer
 * ring with the nonzero rule paints their union, so inner borders never show.
 */
const MakatiTiles = L.GridLayer.extend({
  initialize(this: MakatiSelf, shape: Shape, dark: boolean, options: L.GridLayerOptions) {
    this._shape = shape;
    this._dark = dark;
    this._rings = new Map();
    L.setOptions(this, options);
  },
  _ringsFor(this: MakatiSelf, z: number) {
    let rings = this._rings.get(z);
    if (!rings) {
      rings = this._shape.rings.map((ring) => {
        const pts = new Float64Array(ring.length * 2);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ring.forEach(([lon, lat], i) => {
          const p = this._map.project([lat, lon], z);
          pts[i * 2] = p.x; pts[i * 2 + 1] = p.y;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        return { pts, minX, minY, maxX, maxY };
      });
      this._rings.set(z, rings);
    }
    return rings;
  },
  createTile(this: MakatiSelf, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('canvas');
    tile.width = TILE;
    tile.height = TILE;
    const ox = coords.x * TILE, oy = coords.y * TILE;
    const near = this._ringsFor(coords.z).filter((r) => !(r.maxX < ox || r.minX > ox + TILE || r.maxY < oy || r.minY > oy + TILE));
    const touches = near.length > 0;
    const makatiPath = () => {
      const path = new Path2D();
      for (const r of near) {
        for (let i = 0; i < r.pts.length; i += 2) {
          if (i) path.lineTo(r.pts[i] - ox, r.pts[i + 1] - oy); else path.moveTo(r.pts[i] - ox, r.pts[i + 1] - oy);
        }
        path.closePath();
      }
      return path;
    };
    const style = this._dark ? 'Dark' : 'Light';
    const gray = (kind: 'Base' | 'Reference') => `${ESRI}/Canvas/World_${style}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
    Promise.all([
      loadSource(gray('Base'), 16, coords),
      touches ? loadSource(`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, 19, coords) : Promise.resolve(null),
      loadSource(gray('Reference'), 16, coords),
    ]).then(([base, street, labels]) => {
      if (!base && !street && !labels) { done(new Error('tile failed'), tile); return; }
      const ctx = tile.getContext('2d')!;
      const draw = (c: CanvasRenderingContext2D, src: NonNullable<typeof base>) => c.drawImage(src.img, src.sx, src.sy, src.sw, src.sw, 0, 0, TILE, TILE);
      if (base) draw(ctx, base);
      let path: Path2D | null = null;
      if (street) {
        path = makatiPath();
        ctx.save();
        ctx.clip(path, 'nonzero');
        // The dark theme dims the coloured street map here, once per tile, instead of with a CSS filter on the whole layer.
        if (this._dark) ctx.filter = 'brightness(0.8) saturate(0.85)';
        draw(ctx, street);
        ctx.restore();
      }
      if (labels) {
        if (touches) {
          // Labels everywhere except inside Makati: draw them on a scratch canvas, cut the city out, then composite.
          const scratch = this._scratch ?? (this._scratch = document.createElement('canvas'));
          scratch.width = TILE; scratch.height = TILE;
          const sctx = scratch.getContext('2d')!;
          draw(sctx, labels);
          sctx.globalCompositeOperation = 'destination-out';
          sctx.fill(path ?? makatiPath(), 'nonzero');
          ctx.drawImage(scratch, 0, 0);
        } else draw(ctx, labels);
      }
      done(undefined, tile);
    });
    return tile;
  },
}) as unknown as new (shape: Shape, dark: boolean, options: L.GridLayerOptions) => L.GridLayer;

/**
 * The base map: Esri's Light / Dark Gray Canvas everywhere, with Makati itself drawn from Esri's
 * detailed, coloured street map, so the city stands out and its surroundings recede. No API keys.
 * Without barangays (still loading) it is the plain gray canvas.
 */
export function baseTiles(dark: boolean, barangays: Barangay[] = []) {
  const style = dark ? 'Dark' : 'Light';
  const gray = (kind: 'Base' | 'Reference') => `${ESRI}/Canvas/World_${style}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
  const shape = makatiShape(barangays);
  if (!shape) {
    const canvas = { maxZoom: 20, maxNativeZoom: 16 };
    return L.layerGroup([
      L.tileLayer(gray('Base'), { ...canvas, attribution: GRAY_ATTRIBUTION }),
      L.tileLayer(gray('Reference'), canvas),
    ]);
  }
  // keepBuffer 1: keep one ring of off-screen tiles for smooth panning, not two.
  const layer = new MakatiTiles(shape, dark, { maxZoom: 20, maxNativeZoom: 19, keepBuffer: 1, attribution: GRAY_ATTRIBUTION });
  return L.layerGroup([layer]);
}

// ------------------------------------------------------------------ rain radar

/** Source images by URL, shared by every tile that crops from them (a handful of radar images cover the city). */
const radarImages = new Map<string, Promise<HTMLImageElement | null>>();

function loadRadarImage(url: string) {
  let p = radarImages.get(url);
  if (!p) {
    if (radarImages.size > 40) radarImages.clear();
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    radarImages.set(url, p);
  }
  return p;
}

/**
 * RainViewer's radar as ordinary 256 px canvas tiles. Its images stop at zoom 7, so close in, the
 * browser used to scale one 512 px image up by 64x or more and the compositor had to draw that
 * enormous translucent layer every frame of a pan. Here each tile crops just its own slice of the
 * image, and the opacity is baked in, so there is no group opacity to composite either.
 * `url` is RainViewer's 512 px template (`{z}/{x}/{y}` at the 512 px grid); `maxUrlZoom` is the
 * highest zoom it serves.
 */
export function radarTiles(url: string, { pane, opacity, maxUrlZoom, attribution }: {
  pane: string; opacity: number; maxUrlZoom: number; attribution: string;
}) {
  const Radar = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const tile = document.createElement('canvas');
      tile.width = TILE;
      tile.height = TILE;
      // The 512 px grid is one zoom level behind the 256 px grid that Leaflet counts in.
      const u = Math.max(0, Math.min(coords.z - 1, maxUrlZoom));
      const factor = 2 ** (coords.z - u);
      const size = 512 / factor;
      const x = Math.floor(coords.x / factor), y = Math.floor(coords.y / factor);
      const sx = (((coords.x % factor) + factor) % factor) * size, sy = (((coords.y % factor) + factor) % factor) * size;
      loadRadarImage(url.replace('{z}', String(u)).replace('{x}', String(x)).replace('{y}', String(y))).then((img) => {
        if (!img) { done(new Error('radar tile failed'), tile); return; }
        const ctx = tile.getContext('2d')!;
        ctx.globalAlpha = opacity;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TILE, TILE);
        // A tile with no rain in it draws nothing, but it would still be a full layer to composite on every pan frame
        // (two stacked layers halve the frame rate), so a dry tile is taken out of the page (.tile-dry).
        const px = new Uint32Array(ctx.getImageData(0, 0, TILE, TILE).data.buffer);
        let wet = false;
        for (let i = 0; i < px.length; i++) if (px[i] >>> 24) { wet = true; break; }
        if (!wet) tile.classList.add('tile-dry');
        done(undefined, tile);
      });
      return tile;
    },
  }) as unknown as new (options: L.GridLayerOptions) => L.GridLayer;
  return new Radar({ pane, attribution, maxZoom: 20, keepBuffer: 1 });
}
