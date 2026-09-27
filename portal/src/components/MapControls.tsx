import { useState } from 'react';
import type { MapLayer } from './MapView';

const LAYERS: { value: MapLayer; label: string; hint: string }[] = [
  { value: 'markers', label: 'Hazard markers', hint: 'Each report, grouped when close together' },
  { value: 'density', label: 'Hazard density', hint: 'Where reports concentrate' },
  { value: 'severity', label: 'Severity heatmap', hint: 'Weighted by how dangerous they are' },
];

function readOpen(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function useRemembered(key: string, fallback: boolean) {
  const [open, setOpen] = useState(() => readOpen(key, fallback));
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* not remembered */ }
    return !o;
  });
  return [open, toggle] as const;
}

export function LayerSwitcher({ layer, onChange }: { layer: MapLayer; onChange: (l: MapLayer) => void }) {
  const [open, toggle] = useRemembered('saferoute.layers.open', false);
  return (
    <div className="map-panel map-layers">
      <button type="button" className="map-panel-toggle" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">◧</span> Map layers
      </button>
      {open && (
        <fieldset>
          <legend className="sr-only">Map layer</legend>
          {LAYERS.map((l) => (
            <label key={l.value} className="radio" title={l.hint}>
              <input type="radio" name="layer" checked={layer === l.value} onChange={() => onChange(l.value)} />
              {l.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

export function MapLegend({ layer }: { layer: MapLayer }) {
  const [open, toggle] = useRemembered('saferoute.legend.open', true);
  return (
    <div className="map-panel map-legend">
      <button type="button" className="map-panel-toggle" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">≡</span> Legend
      </button>
      {open && (layer === 'markers' ? (
        <div className="legend-body">
          <p className="legend-heading">Severity (color)</p>
          <ul>
            <li><span className="legend-swatch sev-bg-high" />High</li>
            <li><span className="legend-swatch sev-bg-medium" />Medium</li>
            <li><span className="legend-swatch sev-bg-low" />Low</li>
          </ul>
          <p className="legend-heading">Status (corner mark)</p>
          <ul>
            <li><span className="legend-mark">○</span>Reported</li>
            <li><span className="legend-mark">✓</span>Verified</li>
            <li><span className="legend-mark">!</span>Contested</li>
          </ul>
          <p className="legend-heading">Symbol = hazard type</p>
          <p className="legend-note">Numbers are groups of nearby hazards. Zoom in or click to separate them.</p>
        </div>
      ) : (
        <div className="legend-body">
          <p className="legend-heading">{layer === 'severity' ? 'Severity-weighted' : 'Report density'}</p>
          <div className={`legend-ramp ramp-${layer}`} />
          <div className="legend-ramp-labels"><span>Fewer</span><span>More</span></div>
          {layer === 'severity' && <p className="legend-note">High-severity hazards count most.</p>}
        </div>
      ))}
    </div>
  );
}
