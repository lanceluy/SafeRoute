// leaflet.markercluster and leaflet.heat extend a global `L`; this module runs before they load.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

(window as unknown as { L: typeof L }).L = L;

export default L;

/**
 * The muted base map: Esri's Light / Dark Gray Canvas (base plus a separate label layer), so the
 * hazards, not the streets, carry the colour. Light and dark are separate styles, not an inverted
 * light map. No API key needed; the canvas tiles stop at zoom 16 and are scaled beyond it.
 */
export function baseTiles(dark: boolean) {
  const style = dark ? 'Dark' : 'Light';
  const url = (kind: 'Base' | 'Reference') =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${style}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
  const options = { maxZoom: 20, maxNativeZoom: 16 };
  return L.layerGroup([
    L.tileLayer(url('Base'), {
      ...options,
      attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    L.tileLayer(url('Reference'), options),
  ]);
}
