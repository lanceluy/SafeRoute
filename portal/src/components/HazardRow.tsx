import { memo } from 'react';
import type { Department, Hazard } from '../api/types';
import { ago, plural, shortDate } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { PRIORITY_LABEL, TYPE_LABEL, shortId } from '../lib/hazards';
import { departmentName } from '../state/departments';
import { usePlace } from '../state/places';
import { ConfidenceBadge, SeverityBadge, StatusBadge, TypeIcon } from './Badges';

/** One compact line in a hazard list: no inputs, no destructive buttons. */
export const HazardRow = memo(function HazardRow({ hazard, selected, isNew, barangays, departments, onSelect, checkable, checked, onCheck }: {
  hazard: Hazard; selected: boolean; isNew?: boolean; barangays: Barangay[]; departments: Department[];
  onSelect: (h: Hazard) => void;
  /** Select mode: a checkbox for bulk actions. */
  checkable?: boolean; checked?: boolean; onCheck?: (h: Hazard) => void;
}) {
  const place = usePlace(hazard.latitude, hazard.longitude, barangays);
  const department = departmentName(departments, hazard.assignedDepartment);
  return (
    <li className={checkable ? 'checkable' : undefined}>
      {checkable && (
        <input type="checkbox" className="row-check" checked={!!checked} onChange={() => onCheck?.(hazard)}
          aria-label={`Select ${TYPE_LABEL[hazard.type]} ${shortId(hazard.id)}`} />
      )}
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
          {(department || hazard.municipalPriority) && (
            <span className="row-response">
              {department ?? 'Unassigned'}
              {hazard.municipalPriority && <span className={`priority prio-${hazard.municipalPriority.toLowerCase()}`}>{PRIORITY_LABEL[hazard.municipalPriority]} priority</span>}
            </span>
          )}
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
