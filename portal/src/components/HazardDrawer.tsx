import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive, Check, CheckCircle2, Clock, Copy, ExternalLink, Hourglass, ImageOff, Map as MapIcon, MapPin, MoreHorizontal, RotateCcw, UserPlus, X,
} from 'lucide-react';
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
import { ConfidenceBadge, InfoTip, SeverityDot, StatusBadge, TypeIcon } from './Badges';
import { Menu } from './Menu';
import { ErrorState } from './States';

/**
 * Everything about one hazard, and the municipal actions on it. Render with key={hazardId}.
 * A sticky header (reference, map, close) and a sticky footer (Resolve, Assign, more) frame a
 * scrolling body that reads: what and where → how bad and how sure → evidence → city response → history.
 */
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
        <span className="drawer-ref">{detail ? shortId(detail.hazard.id) : 'Hazard'}</span>
        <div className="drawer-header-actions">
          {onShowOnMap && (
            <button type="button" className="icon-btn" onClick={onShowOnMap} aria-label="Show on map" title="Show on map">
              <MapIcon size={17} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
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
  const department = departmentName(departments, h.assignedDepartment);
  const events = history.filter((e) => !(e.action === 'FIELD_EDITED' && HIDDEN_FIELDS.has(e.field ?? '')))
    // The status change and the moderator action are recorded as a pair; show the action once.
    .filter((e, _i, all) => !(e.action === 'STATUS_CHANGED'
      && all.some((o) => o.action.startsWith('MODERATOR_') && Math.abs(Date.parse(o.at) - Date.parse(e.at)) < 2000)))
    .reverse();
  const shown = showAllHistory ? events : events.slice(0, 5);
  const street = place.street || (place.street === '' ? 'Unnamed street' : 'Locating street…');
  const bodyRef = useRef<HTMLDivElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${h.latitude.toFixed(6)}, ${h.longitude.toFixed(6)}`);
      toast({ kind: 'success', message: 'Coordinates copied' });
    } catch {
      toast({ kind: 'error', message: 'Couldn’t copy. Select the coordinates and copy them instead.' });
    }
  };

  // Assign = jump to the city response and open the department picker.
  const assign = () => {
    const body = bodyRef.current;
    const select = body?.querySelector<HTMLSelectElement>('.city-response select');
    const section = select?.closest('.drawer-section');
    if (!body || !select || !section) return;
    body.scrollTo({ top: section.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 16, behavior: 'smooth' });
    select.focus({ preventScroll: true });
  };

  const [reviewing, setReviewing] = useState(false);
  const review = async () => {
    setReviewing(true);
    try {
      await api.review(h.id);
      toast({ kind: 'success', message: h.archivedAt ? 'Back in the queue' : 'Marked reviewed' });
      onChanged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof ApiError ? err.message : 'Couldn’t mark it reviewed. Try again.' });
    } finally {
      setReviewing(false);
    }
  };
  const [openedAt] = useState(() => Date.now());
  const archiveDays = Math.max(0, Math.ceil(7 - (openedAt - Date.parse(h.createdAt)) / 86_400_000));

  return (
    <>
      <div className="drawer-body" ref={bodyRef}>
        {/* What and where */}
        <div className="drawer-title">
          <span className="row-icon type-tile lg"><TypeIcon type={h.type} size={22} /></span>
          <div>
            <h2>{TYPE_LABEL[h.type]}</h2>
            <p className="drawer-place">{street}{place.barangay ? ` · ${place.barangay}` : ''}</p>
            <p className="muted small" title={fullDate(h.createdAt)}>Reported {ago(h.createdAt)} · {shortDate(h.createdAt)}</p>
          </div>
        </div>

        {/* How bad, and how sure */}
        <dl className="facts">
          <div><dt>Severity</dt><dd><SeverityDot severity={h.severity} /></dd></div>
          <div><dt>Status</dt><dd><StatusBadge status={h.status} plain /></dd></div>
          <div>
            <dt>Confidence <InfoTip text={h.confidence ? CONFIDENCE_HINT[h.confidence] : 'How much the community backs the report.'} /></dt>
            <dd>{h.confidence && h.status !== 'DISPUTED' ? <ConfidenceBadge confidence={h.confidence} plain /> : <span className="muted">—</span>}</dd>
          </div>
          <div><dt>Assigned</dt><dd className={department ? undefined : 'muted'}>{department ?? 'Unassigned'}</dd></div>
        </dl>

        {h.archivedAt && active && (
          <div className="notice notice-warning">
            <Archive size={16} aria-hidden="true" />
            <p>Archived {ago(h.archivedAt)}: nobody on staff acted on it within 7 days. Commuters still see it on the map.</p>
            <button type="button" className="btn btn-secondary btn-sm" disabled={reviewing} onClick={review}>Restore</button>
          </div>
        )}
        {detail.expiringSoon && (
          <div className="notice notice-warning">
            <Hourglass size={16} aria-hidden="true" />
            <p>Expiring soon: nobody has confirmed it lately, so it will drop off the map unless someone does.</p>
          </div>
        )}

        {/* Evidence */}
        <section className="drawer-section">
          {h.photoUrl
            ? (
              <figure className="photo">
                <a href={photoSrc(h.photoUrl)} target="_blank" rel="noreferrer">
                  <img src={photoSrc(h.photoUrl)} alt={`Photo of the ${TYPE_LABEL[h.type].toLowerCase()} taken with the report`} />
                </a>
              </figure>
            )
            : <div className="photo photo-none"><ImageOff size={20} aria-hidden="true" />No photo with this report</div>}
          {h.description && <blockquote className="description">{h.description}</blockquote>}
        </section>

        <section className="drawer-section">
          <h3>Location</h3>
          <div className="location-card">
            <MapPin size={16} aria-hidden="true" />
            <div>
              <p className="place">{street}</p>
              <p className="muted small">{place.barangay ? `Barangay ${place.barangay}, Makati City` : 'Outside Makati barangay boundaries'}</p>
              <p className="coords">{coords(h.latitude, h.longitude)}</p>
            </div>
          </div>
          <div className="button-row">
            {onShowOnMap && <button type="button" className="btn btn-secondary btn-sm" onClick={onShowOnMap}><MapIcon size={14} aria-hidden="true" />Show on map</button>}
            <a className="btn btn-secondary btn-sm" href={googleMapsUrl(h.latitude, h.longitude)} target="_blank" rel="noreferrer">
              Google Maps<ExternalLink size={13} aria-hidden="true" />
            </a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}><Copy size={14} aria-hidden="true" />Copy</button>
          </div>
        </section>

        <section className="drawer-section">
          <h3>Community evidence</h3>
          <div className="community">
            <div><strong className="signal-yes"><Check size={16} strokeWidth={2.5} aria-hidden="true" />{detail.community.confirmations}</strong>
              <span>{detail.community.confirmations === 1 ? 'confirmation' : 'confirmations'}</span></div>
            <div><strong className="signal-no"><X size={16} strokeWidth={2.5} aria-hidden="true" />{detail.community.disputes}</strong>
              <span>{detail.community.disputes === 1 ? 'dispute' : 'disputes'}</span></div>
            <div>
              <strong>{detail.community.noLongerPresentVotes}<small>/{detail.community.resolutionThreshold}</small></strong>
              <span>say it’s gone</span>
            </div>
          </div>
          {h.mergedReportCount > 0 && (
            <p className="muted small">
              {h.mergedReportCount + 1} people reported this. Matching reports within 30 m are combined into this one.
            </p>
          )}
          <p className="muted small">
            Reporter: {TRUST_LABEL[detail.reporterTrustLevel]}
            {h.lastConfirmedAt && <> · Last confirmed {ago(h.lastConfirmedAt)}</>}
          </p>
        </section>

        <section className="drawer-section">
          <h3>City response</h3>
          <CityResponse key={`${h.assignedDepartment}-${h.municipalPriority}`} hazard={h} departments={departments} onSaved={onChanged} />
        </section>

        <section className="drawer-section">
          <div className="section-head">
            <h3>Timeline</h3>
            {!showAllHistory && events.length > shown.length && (
              <button type="button" className="btn-link" onClick={onShowAllHistory}>Show all {events.length}</button>
            )}
          </div>
          <ol className="timeline">
            {shown.map((e) => <TimelineItem key={e.id} entry={e} departments={departments} />)}
          </ol>
        </section>
      </div>

      {/* Sticky actions: the decision is always one click away, wherever you've scrolled. */}
      <div className="drawer-footer">
        {active && (
          <p className="review-line">
            {h.reviewedAt
              ? <><CheckCircle2 size={14} aria-hidden="true" />Reviewed by staff {ago(h.reviewedAt)}</>
              : h.archivedAt
                ? <><Archive size={14} aria-hidden="true" />Archived: not reviewed within 7 days</>
                : <>
                  <Clock size={14} aria-hidden="true" />
                  Not reviewed · archives {archiveDays ? `in ${archiveDays} ${archiveDays === 1 ? 'day' : 'days'}` : 'today'}
                  <button type="button" className="btn-link" disabled={reviewing} onClick={review}>Mark reviewed</button>
                </>}
          </p>
        )}
        {!active && h.resolvedAt && (
          <p className="review-line"><CheckCircle2 size={14} aria-hidden="true" />{STATUS_LABEL[h.status]} {ago(h.resolvedAt)} · {fullDate(h.resolvedAt)}</p>
        )}
        <div className="drawer-footer-actions">
          {active
            ? <button type="button" className="btn btn-primary" onClick={() => onAction('resolve')}><Check size={16} aria-hidden="true" />Resolve</button>
            : <button type="button" className="btn btn-primary" onClick={() => onAction('reopen')}><RotateCcw size={16} aria-hidden="true" />Reopen</button>}
          {active && <button type="button" className="btn btn-secondary" onClick={assign}><UserPlus size={16} aria-hidden="true" />Assign</button>}
          <Menu label="More actions" align="right" direction="up"
            trigger={<span className="btn btn-secondary btn-icon-only"><MoreHorizontal size={17} aria-hidden="true" /></span>} items={[
              active ? { label: h.archivedAt ? 'Restore to queue' : 'Mark reviewed', hint: 'Stops the 7-day archive clock', onSelect: review } : null,
              { label: 'View full history', hint: `${events.length} events`, onSelect: () => {
                onShowAllHistory();
                window.setTimeout(() => {
                  const body = bodyRef.current;
                  const timeline = body?.querySelector('.timeline');
                  if (body && timeline) body.scrollTo({ top: timeline.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 48, behavior: 'smooth' });
                }, 50);
              } },
              { label: 'Copy coordinates', onSelect: copy },
              h.status !== 'REMOVED'
                ? { label: 'Remove report…', hint: 'Only for false, spam or invalid reports', danger: true, onSelect: () => onAction('remove') }
                : null,
            ]} />
        </div>
      </div>
    </>
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
        <p className="timeline-text"><strong>{text}</strong> <span className="muted">· {who[e.actor] ?? e.actor}</span></p>
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

