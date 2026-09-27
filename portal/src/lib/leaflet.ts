// leaflet.markercluster and leaflet.heat extend a global `L`; this module runs before they load.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

(window as unknown as { L: typeof L }).L = L;

export default L;
