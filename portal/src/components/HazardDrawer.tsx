import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, photoSrc } from '../api/client';
import type { Department, HazardDetail, TimelineEntry } from '../api/types';
import { ago, coords, fullDate, googleMapsUrl, shortDate } from '../lib/format';
import type { Barangay } from '../lib/geo';
import {
  ACTION_LABEL, CONFIDENCE_HINT, DEFAULT_NOTES, HIDDEN_FIELDS, STATUS_LABEL, TRUST_LABEL, TYPE_LABEL,
  fieldLabel, isActive, shortId, valueLabel,
} from '../lib/hazards';
import { useHazardFrames } from '../state/live';
import { usePlace } from '../state/places';
import { useToast } from '../state/toast';
import { departmentName, useDepartments } from '../state/departments';
import { ActionDialog, type HazardAction } from './ActionDialog';
import { CityResponse } from './CityResponse';
import { ConfidenceBadge, InfoTip, SeverityBadge, StatusBadge, TypeIcon } from './Badges';
import { Menu } from './Menu';
import { ErrorState } from './States';
import { Chevron } from './Chevron';

/** Everything about one hazard, and the municipal actions on it. Render with key={hazardId}. */
export function HazardDrawer({ hazardId, barangays, onClose, onChanged, onShowOnMap }: {
  hazardId: string; barangays: Barangay[]; onClose: () => void; onChanged: () => void; onShowOnMap?: () => void;
}) {
  const [detail, setDetail] = useState<HazardDetail | null>(null);
  const [history, setHistory] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HazardAction | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.hazard(hazardId, controller.signal), api.history(hazardId, controller.signal)])
      .then(([d, h]) => { setDetail(d); setHistory(h); setError(''); })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
    return () => controller.abort();
  }, [hazardId, reloads]);

  // Keep it current while open: another official, or the community, may act on it.
  useHazardFrames((frame) => { if (frame.hazardId === hazardId) load(); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !action && !(e.target as HTMLElement).closest('.menu')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [action, onClose]);

  return (
    <aside className="drawer" aria-label="Hazard details">
      <div className="drawer-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">×</button>
        {detail && <span className="drawer-ref">{shortId(detail.hazard.id)}</span>}
      </div>
      {error && <ErrorState title="We couldn’t load this hazard." message={error} onRetry={() => load()} />}
      {!error && !detail && <DrawerSkeleton />}
      {detail && history && (
        <DrawerBody detail={detail} history={history} barangays={barangays} showAllHistory={showAllHistory}
          onShowAllHistory={() => setShowAllHistory(true)} onAction={setAction} onShowOnMap={onShowOnMap}
          onChanged={() => { onChanged(); load(); }} />
      )}
      {action && detail && (
        <ActionDialog action={action} hazard={detail.hazard} onClose={() => setAction(null)}
          onDone={() => { onChanged(); window.setTimeout(() => load(), 900); }} />
      )}
    </aside>
  );
}

function DrawerBody({ detail, history, barangays, showAllHistory, onShowAllHistory, onAction, onShowOnMap, onChanged }: {
  detail: HazardDetail; history: TimelineEntry[]; barangays: Barangay[]; showAllHistory: boolean;
  onShowAllHistory: () => void; onAction: (a: HazardAction) => void; onShowOnMap?: () => void; onChanged: () => void;
}) {
  const departments = useDepartments();
  const toast = useToast();
  const h = detail.hazard;
  const place = usePlace(h.latitude, h.longitude, barangays);
  const active = isActive(h.status);
  const events = history.filter((e) => !(e.action === 'FIELD_EDITED' && HIDDEN_FIELDS.has(e.field ?? '')))
    // The status change and the moderator action are recorded as a pair; show the action once.
    .filter((e, _i, all) => !(e.action === 'STATUS_CHANGED'
      && all.some((o) => o.action.startsWith('MODERATOR_') && Math.abs(Date.parse(o.at) - Date.parse(e.at)) < 2000)))
    .reverse();
  const shown = showAllHistory ? events : events.slice(0, 6);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${h.latitude.toFixed(6)}, ${h.longitude.toFixed(6)}`);
      toast({ kind: 'success', message: 'Coordinates copied' });
    } catch {
      toast({ kind: 'error', message: 'Couldn’t copy. Select the coordinates and copy them instead.' });
    }
  };

  return (
    <div className="drawer-body">
      <div className="drawer-title">
        <span className={`row-icon sev-bg-${h.severity.toLowerCase()} lg`}><TypeIcon type={h.type} size={22} /></span>
        <div>
          <h2>{TYPE_LABEL[h.type]}</h2>
          <p className="muted">Reported {ago(h.createdAt)} · {shortDate(h.createdAt)}</p>
        </div>
      </div>

      <div className="drawer-badges">
        <SeverityBadge severity={h.severity} />
        <StatusBadge status={h.status} />
        {h.confidence && h.status !== 'DISPUTED' && (
          <span className="badge-with-tip">
            <ConfidenceBadge confidence={h.confidence} long />
            <InfoTip text={CONFIDENCE_HINT[h.confidence]} />
          </span>
        )}
      </div>
      <p className="explain">
        Severity is how dangerous the hazard is. Confidence is how much the community backs the report.
      </p>

      {detail.expiringSoon && (
        <p className="notice notice-warning">Expiring soon: nobody has confirmed it lately, so it will drop off the map unless someone does.</p>
      )}

      <section className="drawer-section">
        {h.photoUrl
          ? (
            <figure className="photo">
              <a href={photoSrc(h.photoUrl)} target="_blank" rel="noreferrer">
                <img src={photoSrc(h.photoUrl)} alt={`Photo of the ${TYPE_LABEL[h.type].toLowerCase()} taken with the report`} />
              </a>
              <figcaption>Taken with the report</figcaption>
            </figure>
          )
          : <div className="photo photo-none">No photo with this report</div>}
        {h.description && <p className="description">“{h.description}”</p>}
      </section>

      <section className="drawer-section">
        <h3>Location</h3>
        <p className="place">{place.street || (place.street === '' ? 'Unnamed street' : 'Locating street…')}</p>
        <p className="muted">{place.barangay ? `Barangay ${place.barangay}, Makati City` : 'Outside Makati barangay boundaries'}</p>
        <p className="coords">{coords(h.latitude, h.longitude)}</p>
        <div className="button-row">
          {onShowOnMap && <button type="button" className="btn btn-secondary btn-sm" onClick={onShowOnMap}>Show on map</button>}
          <a className="btn btn-secondary btn-sm" href={googleMapsUrl(h.latitude, h.longitude)} target="_blank" rel="noreferrer">
            Open in Google Maps ↗
          </a>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copy coordinates</button>
        </div>
      </section>

      <section className="drawer-section">
        <h3>Community</h3>
        <div className="community">
          <div><strong>✓ {detail.community.confirmations}</strong><span>{detail.community.confirmations === 1 ? 'confirmation' : 'confirmations'}</span></div>
          <div><strong>✕ {detail.community.disputes}</strong><span>{detail.community.disputes === 1 ? 'dispute' : 'disputes'}</span></div>
          <div>
            <strong>{detail.community.noLongerPresentVotes}/{detail.community.resolutionThreshold}</strong>
            <span>say it’s gone</span>
          </div>
        </div>
        <p className="muted">
          Reporter: {TRUST_LABEL[detail.reporterTrustLevel]}
          {h.lastConfirmedAt && <> · Last confirmed {ago(h.lastConfirmedAt)}</>}
        </p>
      </section>

      <section className="drawer-section">
        <h3>City response</h3>
        <CityResponse key={`${h.assignedDepartment}-${h.municipalPriority}`} hazard={h} departments={departments} onSaved={onChanged} />
      </section>

      <section className="drawer-section">
        <h3>Timeline</h3>
        <ol className="timeline">
          {shown.map((e) => <TimelineItem key={e.id} entry={e} departments={departments} />)}
        </ol>
        {!showAllHistory && events.length > shown.length && (
          <button type="button" className="btn-link" onClick={onShowAllHistory}>Show all {events.length} events</button>
        )}
      </section>

      <section className="drawer-actions">
        <h3>Municipal actions</h3>
        <div className="button-row">
          {active
            ? <button type="button" className="btn btn-primary" onClick={() => onAction('resolve')}>✓ Mark as resolved</button>
            : <button type="button" className="btn btn-primary" onClick={() => onAction('reopen')}>Reopen hazard</button>}
          <Menu label="More actions" trigger={<span className="btn btn-secondary">More actions<Chevron /></span>} align="left" direction="up" items={[
            active ? { label: 'Mark as resolved', hint: 'Fixed or no longer present', onSelect: () => onAction('resolve') } : null,
            !active ? { label: 'Reopen hazard', hint: 'It’s back, or was closed by mistake', onSelect: () => onAction('reopen') } : null,
            h.status !== 'REMOVED'
              ? { label: 'Remove report', hint: 'False, spam or invalid', danger: true, onSelect: () => onAction('remove') }
              : null,
            { label: 'View full history', hint: `${events.length} events`, onSelect: onShowAllHistory },
          ]} />
        </div>
        {active && <p className="muted">Resolve when the hazard is fixed or gone. Remove is only for reports that were never valid.</p>}
        {!active && h.resolvedAt && <p className="muted">{STATUS_LABEL[h.status]} {ago(h.resolvedAt)} · {fullDate(h.resolvedAt)}</p>}
      </section>
    </div>
  );
}

function TimelineItem({ entry: e, departments }: { entry: TimelineEntry; departments: Department[] }) {
  const who: Record<string, string> = { REPORTER: 'Reporter', COMMUNITY: 'Community member', MODERATOR: 'Municipal staff', SYSTEM: 'SafeRoute' };
  let text: string = ACTION_LABEL[e.action];
  if (e.action === 'STATUS_CHANGED') text = `Became ${valueLabel(e.newValue)}`;
  if (e.action === 'CONFIRMATION_CHANGED') text = e.newValue === 'DISPUTE' ? 'Disputed' : 'Confirmed';
  if (e.action === 'RESOLUTION_VOTE') text = e.newValue === 'NO_LONGER_PRESENT' ? 'Voted it’s gone' : 'Voted it’s still there';
  if (e.action === 'MUNICIPAL_ASSIGNED') text = e.newValue ? `Assigned to ${departmentName(departments, e.newValue)}` : 'Unassigned';
  if (e.action === 'MUNICIPAL_PRIORITY') text = e.newValue ? `City priority: ${valueLabel(e.newValue)}` : 'City priority cleared';
  if (e.action === 'FIELD_EDITED') {
    text = e.field === 'severity' || e.field === 'type'
      ? `Changed ${fieldLabel(e.field)}: ${valueLabel(e.oldValue)} → ${valueLabel(e.newValue)}`
      : `Edited the ${fieldLabel(e.field)}`;
  }
  const note = e.action === 'CREATED' || e.action === 'DUPLICATE_MERGED' || DEFAULT_NOTES.has(e.note ?? '') ? null : e.note;
  return (
    <li className={`timeline-item t-${e.action.toLowerCase()}`}>
      <span className="timeline-dot" aria-hidden="true" />
      <div>
        <p><strong>{text}</strong> <span className="muted">· {who[e.actor] ?? e.actor}</span></p>
        {e.action === 'CREATED' && e.note?.startsWith('Severity ') && <p className="muted">{valueLabel(e.note.slice(9))} severity</p>}
        {note && <p className="timeline-note">“{note}”</p>}
        <p className="muted small" title={fullDate(e.at)}>{ago(e.at)} · {shortDate(e.at)}</p>
      </div>
    </li>
  );
}

function DrawerSkeleton() {
  return (
    <div className="drawer-body" aria-busy="true">
      <div className="skeleton" style={{ height: 28, width: '60%' }} />
      <div className="skeleton" style={{ height: 18, width: '40%', marginTop: 12 }} />
      <div className="skeleton" style={{ height: 180, marginTop: 24 }} />
      <div className="skeleton" style={{ height: 16, width: '80%', marginTop: 24 }} />
      <div className="skeleton" style={{ height: 16, width: '50%', marginTop: 8 }} />
    </div>
  );
}

