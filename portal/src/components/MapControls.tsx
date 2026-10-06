import { useState } from 'react';
import { Info, Layers, X } from 'lucide-react';
import type { MapLayer } from './MapView';
import { Menu } from './Menu';

const LAYERS: { value: MapLayer; label: string; hint: string }[] = [
  { value: 'markers', label: 'Hazard markers', hint: 'Each report, grouped when close together' },
  { value: 'density', label: 'Hazard density', hint: 'Where reports concentrate' },
  { value: 'severity', label: 'Severity heatmap', hint: 'Weighted by how dangerous they are' },
];

/** RainViewer's "Universal Blue" rain colours, light to heavy (same as the Weather page). */
const RAIN_KEY = ['#00a3e0', '#005588', '#ffee00', '#ffaa00', '#c10000'];

/**
 * A toolbar button for the hazard layer (one of) and the rain overlay (on top of any of them).
 * Picking a hazard layer closes the menu; the overlay checkbox leaves it open.
 */
export function LayersButton({ layer, onChange, rain, onRain }: {
  layer: MapLayer; onChange: (l: MapLayer) => void; rain: boolean; onRain: (on: boolean) => void;
}) {
  return (
    <Menu label={`Map layers: ${LAYERS.find((l) => l.value === layer)?.label}${rain ? ', rain radar' : ''}`} align="left"
      trigger={<span className={`map-tool-btn${layer !== 'markers' || rain ? ' on' : ''}`} title="Layers"><Layers size={18} aria-hidden="true" /></span>}
      items={[
        { heading: 'Hazards' },
        ...LAYERS.map((l) => ({ label: l.label, hint: l.hint, checked: layer === l.value, radio: true, onSelect: () => onChange(l.value) })),
        { heading: 'Weather' },
        { label: 'Rain radar (live)', hint: 'Where it is raining now, under the hazards', checked: rain, onSelect: () => onRain(!rain) },
      ]} />
  );
}

/**
 * The severity key as one small strip; the full explanation opens from ⓘ. Experienced users
 * need the colours, not the paragraph.
 */
export function MapLegend({ layer, rain = false, closures = 0 }: { layer: MapLayer; rain?: boolean; closures?: number }) {
  const [open, setOpen] = useState(false);
  const heat = layer !== 'markers';
  return (
    <div className="map-legend">
      {open && (
        <div className="map-legend-card" role="dialog" aria-label="Legend">
          <button type="button" className="icon-btn map-legend-close" onClick={() => setOpen(false)} aria-label="Close legend"><X size={15} aria-hidden="true" /></button>
          {heat ? (
            <>
              <p className="legend-heading">{layer === 'severity' ? 'Severity-weighted' : 'Report density'}</p>
              <div className={`legend-ramp ramp-${layer}`} />
              <div className="legend-ramp-labels"><span>Fewer</span><span>More</span></div>
              {layer === 'severity' && <p className="legend-note">High-severity hazards count most.</p>}
            </>
          ) : (
            <>
              {rain && <>
                <p className="legend-heading">Rain radar</p>
                <div className="legend-ramp" style={{ background: `linear-gradient(90deg, ${RAIN_KEY.join(', ')})` }} />
                <div className="legend-ramp-labels"><span>Light</span><span>Torrential</span></div>
                <p className="legend-note">Live from RainViewer, about 600 m detail, updated every few minutes.</p>
              </>}
              <p className="legend-heading">Markers</p>
              <p className="legend-note">Colour is severity; the white symbol is the hazard type. Selecting one dims the rest.</p>
              <p className="legend-note"><span className="legend-mark">!</span> Contested: the community disagrees.</p>
              <p className="legend-note"><span className="legend-cluster">12</span> A group of nearby hazards. A red ring means at least one is high severity. Zoom in or click to separate them.</p>
            </>
          )}
        </div>
      )}
      <div className="map-legend-strip">
        {heat ? (
          <span className="legend-strip-ramp"><span className={`legend-ramp ramp-${layer}`} />Fewer → more</span>
        ) : (
          <>
            <span><i className="sev-bg-high" />High</span>
            <span><i className="sev-bg-medium" />Medium</span>
            <span><i className="sev-bg-low" />Low</span>
          </>
        )}
        {closures > 0 && <span><i className="closure-key" />Closed road{closures > 1 ? ` (${closures})` : ''}</span>}
        {rain && <span className="legend-strip-ramp"><span className="legend-ramp" style={{ background: `linear-gradient(90deg, ${RAIN_KEY.join(', ')})` }} />Rain</span>}
        <button type="button" className="legend-info" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Explain the map" title="Legend">
          <Info size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
