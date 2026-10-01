import { memo } from 'react';
import { Check, ChevronRight, MapPin, MoreHorizontal, TriangleAlert, X } from 'lucide-react';
import type { Department, Hazard } from '../api/types';
import { ago, plural, shortDate } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { PRIORITY_LABEL, TYPE_LABEL, isActive, shortId } from '../lib/hazards';
import { STALE_DAYS, ageDays, isStale, needsAction, queueReason, shortAge } from '../lib/queue';
import { departmentName } from '../state/departments';
import { usePlace } from '../state/places';
import { useToast } from '../state/toast';
import { ConfidenceBadge, SeverityDot, StatusBadge, TypeIcon } from './Badges';
import { Menu } from './Menu';

/**
 * One hazard in a queue: no inputs, no destructive buttons (Remove stays in the detail drawer).
 * The same markup reads as a stacked card in a narrow rail and as a table row when the queue is
 * wide; CSS container queries on `.queue` choose which parts show.
 *
 * Badge rules, so a row never shouts: pills only for exceptional states (Needs action, Urgent,
 * New, Archived, merged reports); a dot for severity; icon + text for verification; plain text for
 * place, department and age. A row needing action gets a red left bar and nothing else red.
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
  const toast = useToast();
  const place = usePlace(hazard.latitude, hazard.longitude, barangays);
  const department = departmentName(departments, hazard.assignedDepartment);
  const active = isActive(hazard.status);
  const reason = queueReason(tabKey, chipKeys, hazard, now);
  const action = needsAction(hazard, now);
  const urgent = hazard.municipalPriority === 'URGENT';
  const stale = isStale(hazard, now);
  const days = Math.floor(ageDays(hazard, now));
  const ageText = stale ? `${days} days unresolved` : `Reported ${ago(hazard.createdAt)}`;
  const title = TYPE_LABEL[hazard.type];
  const community = `${plural(hazard.confirmationCount, 'confirmation')}, ${plural(hazard.disputeCount, 'dispute')}`;
  const street = place.street || place.label || 'Locating street…';

  // Urgent (set by the city) already says "act now"; Needs action only when it adds something.
  const flag = urgent
    ? <span className="pill pill-urgent" title={action ?? 'The city marked it urgent'}>Urgent</span>
    : action ? <span className="pill pill-action" title={action}>Needs action</span> : null;
  const signals = (
    <span className="signals" title={community}>
      <span className="signal-yes"><Check size={13} strokeWidth={2.5} aria-hidden="true" />{hazard.confirmationCount}</span>
      <span className="signal-no"><X size={13} strokeWidth={2.5} aria-hidden="true" />{hazard.disputeCount}</span>
      <span className="sr-only">{community}</span>
    </span>
  );
  const age = (
    <span className={`age${stale ? ' stale' : ''}`} title={`${ageText} · reported ${shortDate(hazard.createdAt)}${stale ? ` (over ${STALE_DAYS} days)` : ''}`}>
      {stale && <TriangleAlert size={13} aria-hidden="true" />}{shortAge(hazard, now)}
    </span>
  );
  const assignment = active
    ? <span className={department ? 'assign' : 'assign none'}>{department ?? 'Unassigned'}</span>
    : <span className="muted">—</span>;

  const copyRef = () => {
    navigator.clipboard?.writeText(shortId(hazard.id))
      .then(() => toast({ kind: 'success', message: `Copied ${shortId(hazard.id)}` }))
      .catch(() => toast({ kind: 'error', message: 'Couldn’t copy the reference.' }));
  };

  return (
    <li className={`hazard-item${checkable ? ' checkable' : ''}`}>
      {checkable && (
        <input type="checkbox" className="row-check" checked={!!checked} onChange={() => onCheck?.(hazard)}
          aria-label={`Select ${title} ${shortId(hazard.id)}`} />
      )}
      <button type="button" id={`row-${hazard.id}`}
        className={`hazard-row${selected ? ' selected' : ''}${action || urgent ? ' needs-action' : ''}${isNew ? ' is-new' : ''}`}
        aria-current={selected ? 'true' : undefined} onClick={() => onSelect(hazard)}>
        <span className={`row-icon sev-tint-${hazard.severity.toLowerCase()}`}><TypeIcon type={hazard.type} size={17} /></span>

        {/* Primary: what and where. */}
        <span className="row-body">
          <span className="row-title">
            <span className="row-title-text">{title}</span>
            {isNew && <span className="pill pill-new">New</span>}
            <span className="stacked-only">{flag}</span>
            {hazard.status === 'DISPUTED' && <span className="pill pill-contested stacked-only">Contested</span>}
            {hazard.archivedAt && active && <span className="pill pill-muted" title="No staff review within 7 days. Still on the commuter map.">Archived</span>}
            {hazard.mergedReportCount > 0 && (
              <span className="pill pill-muted" title={`${plural(hazard.mergedReportCount, 'matching report')} from other people combined into this one`}>
                {hazard.mergedReportCount + 1} reports
              </span>
            )}
          </span>
          <span className="row-place">
            {street}
            {place.street && place.barangay && <span className="stacked-only"> · {place.barangay}</span>}
          </span>
          {reason && <span className="row-reason">{reason}</span>}
          {/* Secondary, stacked only: the facts the table spreads over columns. */}
          <span className="row-meta stacked-only">
            <SeverityDot severity={hazard.severity} />
            {hazard.status !== 'DISPUTED' && <StatusBadge status={hazard.status} plain />}
            {signals}
            {active && <span className={department ? 'assign' : 'assign none'}>{department ?? 'Unassigned'}</span>}
            {age}
          </span>
        </span>

        {/* Table columns (wide queues only) */}
        <span className="cell cell-stack table-only">
          <SeverityDot severity={hazard.severity} />
          {flag}
        </span>
        <span className="cell cell-stack table-only">
          <StatusBadge status={hazard.status} plain />
          {hazard.status !== 'DISPUTED' && <ConfidenceBadge confidence={hazard.confidence} plain />}
        </span>
        <span className="cell cell-area table-only">{place.barangay ?? '—'}</span>
        <span className="cell cell-num table-only">{signals}</span>
        <span className="cell cell-stack table-only">
          {assignment}
          {hazard.municipalPriority && !urgent && <span className="prio-text">{PRIORITY_LABEL[hazard.municipalPriority]} priority</span>}
        </span>
        <span className="cell cell-num table-only">{age}</span>
        <ChevronRight className="row-chevron" size={16} aria-hidden="true" />
      </button>
      {!checkable && (
        <span className="row-actions">
          <button type="button" className="row-action" onClick={() => onSelect(hazard)}>View</button>
          {onShowOnMap && (
            <button type="button" className="row-action" onClick={() => onShowOnMap(hazard)} aria-label={`Show ${title} on the map`}>
              <MapPin size={14} aria-hidden="true" />Map
            </button>
          )}
          <Menu label={`More actions for ${title} ${shortId(hazard.id)}`} align="right"
            trigger={<span className="row-action icon"><MoreHorizontal size={16} aria-hidden="true" /></span>}
            items={[
              onResolve && active ? { label: 'Resolve…', hint: 'Mark it fixed or no longer there', onSelect: () => onResolve(hazard) } : null,
              { label: `Copy reference (${shortId(hazard.id)})`, onSelect: copyRef },
            ]} />
        </span>
      )}
    </li>
  );
});
