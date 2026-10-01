import { memo } from 'react';
import type { Department, Hazard } from '../api/types';
import { ago, plural, shortDate } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { PRIORITY_LABEL, TYPE_LABEL, isActive, shortId } from '../lib/hazards';
import { STALE_DAYS, ageDays, isStale, needsAction, queueReason, shortAge } from '../lib/queue';
import { departmentName } from '../state/departments';
import { usePlace } from '../state/places';
import { ConfidenceBadge, SeverityBadge, StatusBadge, TypeIcon } from './Badges';

/**
 * One hazard in a queue: no inputs, no destructive buttons (Remove stays in the detail drawer).
 * The same markup reads as a stacked card in a narrow rail and as a table row when the queue is
 * wide; CSS container queries on `.queue` choose which parts show.
 */
export const HazardRow = memo(function HazardRow({
  hazard, selected, isNew, barangays, departments, onSelect, checkable, checked, onCheck, tabKey, chipKeys, now, onResolve, onShowOnMap,
}: {
  hazard: Hazard; selected: boolean; isNew?: boolean; barangays: Barangay[]; departments: Department[];
  onSelect: (h: Hazard) => void;
  /** Select mode: a checkbox for bulk actions. */
  checkable?: boolean; checked?: boolean; onCheck?: (h: Hazard) => void;
  /** The queue tab and "Filter by" chips, for the "why it's here" line. */
  tabKey: string; chipKeys: string[];
  now: number;
  /** Quick actions, revealed on hover or focus. */
  onResolve?: (h: Hazard) => void; onShowOnMap?: (h: Hazard) => void;
}) {
  const place = usePlace(hazard.latitude, hazard.longitude, barangays);
  const department = departmentName(departments, hazard.assignedDepartment);
  const active = isActive(hazard.status);
  const reason = queueReason(tabKey, chipKeys, hazard, now);
  const action = needsAction(hazard, now);
  const stale = isStale(hazard, now);
  const days = Math.floor(ageDays(hazard, now));
  const ageText = stale ? `${days} days unresolved` : `Reported ${ago(hazard.createdAt)}`;
  const assignment = active ? (department ?? 'Unassigned') : null;
  // When the reason line already gives the community counts (contested), don't repeat them.
  const showCounts = !reason?.includes('confirmation');

  return (
    <li className={`hazard-item${checkable ? ' checkable' : ''}`}>
      {checkable && (
        <input type="checkbox" className="row-check" checked={!!checked} onChange={() => onCheck?.(hazard)}
          aria-label={`Select ${TYPE_LABEL[hazard.type]} ${shortId(hazard.id)}`} />
      )}
      <button type="button" id={`row-${hazard.id}`}
        className={`hazard-row${selected ? ' selected' : ''}${action ? ' needs-action' : ''}${isNew ? ' is-new' : ''}`}
        aria-current={selected ? 'true' : undefined} onClick={() => onSelect(hazard)}>
        <span className={`row-icon sev-bg-${hazard.severity.toLowerCase()}`}><TypeIcon type={hazard.type} /></span>

        {/* Hazard → severity / status / confidence → location → community and age */}
        <span className="row-body">
          <span className="row-title">
            {TYPE_LABEL[hazard.type]}
            {isNew && <span className="new-pill">New</span>}
            {action && <span className="action-pill" title={action}>Needs action</span>}
            {hazard.archivedAt && active && <span className="info-pill" title="No staff review within 7 days. Still on the commuter map.">Archived</span>}
            {hazard.mergedReportCount > 0 && (
              <span className="info-pill" title={`${plural(hazard.mergedReportCount, 'matching report')} from other people combined into this one`}>
                {hazard.mergedReportCount + 1} reports
              </span>
            )}
          </span>
          <span className="row-badges stacked-only">
            <SeverityBadge severity={hazard.severity} />
            <StatusBadge status={hazard.status} />
            {hazard.status !== 'DISPUTED' && <ConfidenceBadge confidence={hazard.confidence} long />}
          </span>
          <span className="row-place">{(place.street || place.label) || 'Locating street…'}
            {place.street && place.barangay && <span className="stacked-only"> · {place.barangay}</span>}
          </span>
          {reason && <span className="row-reason">{reason}</span>}
          <span className="row-meta stacked-only">
            {showCounts && <>{plural(hazard.confirmationCount, 'confirmation')} · {plural(hazard.disputeCount, 'dispute')}{' · '}</>}
            <span className={stale ? 'stale' : undefined} title={`Reported ${shortDate(hazard.createdAt)}`}>
              {stale && <span aria-hidden="true">⚠ </span>}{ageText}
            </span>
          </span>
          {(assignment || hazard.municipalPriority) && (
            <span className="row-response stacked-only">
              {assignment && <span className={`assign-chip${department ? '' : ' unassigned'}`}>{department ? `Assigned to ${department}` : 'Unassigned'}</span>}
              {hazard.municipalPriority && <span className={`priority prio-${hazard.municipalPriority.toLowerCase()}`}>{PRIORITY_LABEL[hazard.municipalPriority]} priority</span>}
            </span>
          )}
        </span>

        {/* Table columns (wide queues only) */}
        <span className="cell table-only"><SeverityBadge severity={hazard.severity} suffix={false} /></span>
        <span className="cell table-only"><StatusBadge status={hazard.status} /></span>
        <span className="cell table-only">{hazard.status !== 'DISPUTED' ? <ConfidenceBadge confidence={hazard.confidence} /> : <span className="muted">—</span>}</span>
        <span className="cell cell-area table-only">{place.barangay ?? '—'}</span>
        <span className="cell cell-num table-only" title={`${plural(hazard.confirmationCount, 'confirmation')}, ${plural(hazard.disputeCount, 'dispute')}`}>
          <span className="signal-yes">✓ {hazard.confirmationCount}</span> <span className="signal-no">✕ {hazard.disputeCount}</span>
        </span>
        <span className="cell table-only">
          {assignment ? <span className={`assign-chip${department ? '' : ' unassigned'}`}>{assignment}</span> : <span className="muted">—</span>}
          {hazard.municipalPriority && <span className={`priority prio-${hazard.municipalPriority.toLowerCase()}`}>{PRIORITY_LABEL[hazard.municipalPriority]}</span>}
        </span>
        <span className={`cell cell-num table-only${stale ? ' stale' : ''}`} title={`${ageText} · reported ${shortDate(hazard.createdAt)}${stale ? ` (over ${STALE_DAYS} days)` : ''}`}>
          {stale && <span aria-hidden="true">⚠ </span>}{shortAge(hazard, now)}
        </span>
        <span className="row-chevron" aria-hidden="true">›</span>
      </button>
      {!checkable && (onResolve || onShowOnMap) && (
        <span className="row-actions">
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => onSelect(hazard)}>View</button>
          {onResolve && active && (
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onResolve(hazard)}>✓ Resolve</button>
          )}
          {onShowOnMap && (
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onShowOnMap(hazard)} aria-label={`Show ${TYPE_LABEL[hazard.type]} on the map`}>Map</button>
          )}
        </span>
      )}
    </li>
  );
});
