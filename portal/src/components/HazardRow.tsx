import { memo } from 'react';
import type { Hazard } from '../api/types';
import { ago, plural, shortDate } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { TYPE_LABEL } from '../lib/hazards';
import { usePlace } from '../state/places';
import { ConfidenceBadge, SeverityBadge, StatusBadge, TypeIcon } from './Badges';

/** One compact line in a hazard list: no inputs, no destructive buttons. */
export const HazardRow = memo(function HazardRow({ hazard, selected, isNew, barangays, onSelect }: {
  hazard: Hazard; selected: boolean; isNew?: boolean; barangays: Barangay[]; onSelect: (h: Hazard) => void;
}) {
  const place = usePlace(hazard.latitude, hazard.longitude, barangays);
  return (
    <li>
      <button type="button" id={`row-${hazard.id}`}
        className={`hazard-row sev-edge-${hazard.severity.toLowerCase()}${selected ? ' selected' : ''}${isNew ? ' is-new' : ''}`}
        aria-current={selected ? 'true' : undefined} onClick={() => onSelect(hazard)}>
        <span className={`row-icon sev-bg-${hazard.severity.toLowerCase()}`}><TypeIcon type={hazard.type} /></span>
        <span className="row-body">
          <span className="row-title">
            {TYPE_LABEL[hazard.type]}
            {isNew && <span className="new-pill">New</span>}
          </span>
          <span className="row-badges">
            <SeverityBadge severity={hazard.severity} suffix={false} />
            <StatusBadge status={hazard.status} />
            {hazard.status !== 'DISPUTED' && <ConfidenceBadge confidence={hazard.confidence} />}
          </span>
          <span className="row-place">{place.label || 'Locating street…'}</span>
          <span className="row-meta">
            {plural(hazard.confirmationCount, 'confirmation')} · {plural(hazard.disputeCount, 'dispute')}
            {' · '}
            <span title={shortDate(hazard.createdAt)}>Reported {ago(hazard.createdAt)}</span>
          </span>
        </span>
        <span className="row-chevron" aria-hidden="true">›</span>
      </button>
    </li>
  );
});
