import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import type { ActivityEntry, Department } from '../api/types';
import { departmentName, useDepartments } from '../state/departments';
import { TypeIcon } from '../components/Badges';
import { EmptyState, ErrorState, SkeletonRows } from '../components/States';
import { ago, coords, dayLabel, fullDate, timeOfDay } from '../lib/format';
import { DEFAULT_NOTES, HIDDEN_FIELDS, TYPE_LABEL, fieldLabel, shortId, valueLabel } from '../lib/hazards';
import { useLiveTick } from '../state/useQueue';

type Scope = 'staff' | 'status' | 'all';
const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: 'staff', label: 'Municipal actions', hint: 'Resolves, reopens and removals by staff' },
  { value: 'status', label: 'Status changes', hint: 'Every change of hazard status' },
  { value: 'all', label: 'Everything', hint: 'Including community confirmations and edits' },
];
const STAFF_ACTIONS = ['MODERATOR_RESOLVED', 'MODERATOR_REOPENED', 'MODERATOR_REMOVED', 'MUNICIPAL_ASSIGNED', 'MUNICIPAL_PRIORITY'];

function who(e: ActivityEntry) {
  if (e.actor.kind === 'STAFF') return e.actor.name || 'Municipal staff';
  if (e.actor.kind === 'REPORTER') return 'The reporter';
  if (e.actor.kind === 'COMMUNITY') return 'A community member';
  return 'SafeRoute';
}

/** A sentence for one audit entry, in operational language. */
function sentence(e: ActivityEntry, departments: Department[]) {
  const hazard = `${TYPE_LABEL[e.hazardType]} ${shortId(e.hazardId)}`;
  switch (e.action) {
    case 'MODERATOR_RESOLVED': return `${who(e)} resolved ${hazard}`;
    case 'MODERATOR_REOPENED': return `${who(e)} reopened ${hazard}`;
    case 'MODERATOR_REMOVED': return `${who(e)} removed report ${hazard}`;
    case 'CREATED': return `${hazard} was reported`;
    case 'DUPLICATE_MERGED': return `A duplicate report was merged into ${hazard}`;
    case 'STATUS_CHANGED': return `${hazard} became ${valueLabel(e.newValue)}`;
    case 'CONFIRMATION_CHANGED': return `${who(e)} ${e.newValue === 'DISPUTE' ? 'disputed' : 'confirmed'} ${hazard}`;
    case 'RESOLUTION_VOTE': return `${who(e)} said ${hazard} is ${e.newValue === 'NO_LONGER_PRESENT' ? 'gone' : 'still there'}`;
    case 'FIELD_EDITED': return `${who(e)} changed the ${fieldLabel(e.field)} of ${hazard}`;
    case 'MUNICIPAL_ASSIGNED': return e.newValue
      ? `${who(e)} assigned ${hazard} to ${departmentName(departments, e.newValue)}`
      : `${who(e)} unassigned ${hazard}`;
    case 'MUNICIPAL_PRIORITY': return e.newValue
      ? `${who(e)} set ${hazard} to ${valueLabel(e.newValue).toLowerCase()} city priority`
      : `${who(e)} cleared the city priority of ${hazard}`;
  }
}

/** Notes worth showing: staff reasons, not system bookkeeping ("Submission <id>", "Severity HIGH"). */
function visibleNote(e: ActivityEntry) {
  if (!e.note || DEFAULT_NOTES.has(e.note) || e.action === 'CREATED' || e.action === 'DUPLICATE_MERGED' || e.action === 'FIELD_EDITED') return null;
  return e.note;
}

export function ActivityPage() {
  const [scope, setScope] = useState<Scope>('staff');
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ActivityEntry | null>(null);
  const tick = useLiveTick();
  const departments = useDepartments();

  // Which page to fetch next; a new object on every request so asking again refetches.
  const [request, setRequest] = useState({ page: 0 });
  const lastTick = useRef(tick);
  const load = useCallback((p: number) => { setLoading(true); setRequest({ page: p }); }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A live change starts over from the newest page rather than refetching an older one.
    const live = tick !== lastTick.current;
    lastTick.current = tick;
    const p = live ? 0 : request.page;
    api.activity({
      page: p, size: 50,
      staffOnly: scope === 'staff',
      actions: scope === 'staff' ? STAFF_ACTIONS : scope === 'status' ? ['STATUS_CHANGED'] : undefined,
    }, controller.signal)
      .then((res) => {
        setItems((prev) => (p === 0 ? res.items : [...prev, ...res.items]));
        setHasMore(res.hasMore);
        setPage(p);
        setError('');
        setLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [scope, request, tick]);


  const shown = useMemo(() => items.filter((e) => !(e.action === 'FIELD_EDITED' && HIDDEN_FIELDS.has(e.field ?? ''))), [items]);
  const groups = useMemo(() => {
    const byDay = new Map<string, ActivityEntry[]>();
    for (const e of shown) {
      const day = new Date(e.at).toDateString();
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    return [...byDay.entries()];
  }, [shown]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted">Municipal actions, status changes and the audit trail. Newest first.</p>
        </div>
        <div className="segmented" role="group" aria-label="Show">
          {SCOPES.map((s) => (
            <button key={s.value} type="button" title={s.hint} aria-pressed={scope === s.value} onClick={() => {
              if (s.value === scope) return;
              setScope(s.value); setSelected(null); setItems([]); load(0);
            }}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className={`activity-layout${selected ? ' has-detail' : ''}`}>
        <section className="card activity-feed">
          {loading && page === 0 && !items.length && <SkeletonRows count={8} />}
          {error && !items.length && <ErrorState title="We couldn’t load the activity log." message={error} onRetry={() => load(0)} />}
          {!loading && !error && !shown.length && (
            <EmptyState title="No activity yet">
              {scope === 'staff' ? 'When staff resolve, reopen or remove hazards, it shows up here.' : 'Nothing has happened in this view yet.'}
            </EmptyState>
          )}
          {groups.map(([day, entries]) => (
            <div key={day} className="activity-day">
              <h2 className="activity-day-label">{new Date(day).toDateString() === new Date().toDateString() ? 'Today' : dayLabel(new Date(day))}</h2>
              <ul className="activity-list">
                {entries.map((e) => (
                  <li key={e.id}>
                    <button type="button" className={`activity-item a-${e.action.toLowerCase()}${selected?.id === e.id ? ' selected' : ''}`}
                      onClick={() => setSelected(e)} aria-current={selected?.id === e.id ? 'true' : undefined}>
                      <span className="activity-time" title={fullDate(e.at)}>{timeOfDay(e.at)}</span>
                      <span className={`row-icon sev-bg-${e.hazardSeverity.toLowerCase()} sm`}><TypeIcon type={e.hazardType} size={14} /></span>
                      <span className="activity-text">
                        <span>{sentence(e, departments)}</span>
                        {visibleNote(e) && <span className="activity-note">{e.action === 'MODERATOR_REMOVED' ? 'Reason: ' : ''}{visibleNote(e)}</span>}
                      </span>
                      <span className="row-chevron" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hasMore && (
            <button type="button" className="btn btn-secondary load-more" disabled={loading} onClick={() => load(page + 1)}>
              {loading ? 'Loading…' : 'Load older activity'}
            </button>
          )}
        </section>

        {selected && <AuditDetail entry={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function AuditDetail({ entry: e, onClose }: { entry: ActivityEntry; onClose: () => void }) {
  const departments = useDepartments();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const statusChange = e.action === 'STATUS_CHANGED' || (e.action === 'FIELD_EDITED' && (e.field === 'severity' || e.field === 'type'))
    || e.action === 'MUNICIPAL_ASSIGNED' || e.action === 'MUNICIPAL_PRIORITY';
  const show = (v: string | null) => (e.action === 'MUNICIPAL_ASSIGNED' ? departmentName(departments, v) ?? 'Unassigned' : valueLabel(v) || '—');
  return (
    <aside className="card audit-detail" aria-label="Audit entry">
      <div className="drawer-header">
        <h2>Audit entry</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <dl className="audit-fields">
        <dt>Action</dt><dd>{sentence(e, departments)}</dd>
        <dt>Performed by</dt>
        <dd>
          {who(e)}
          {e.actor.kind === 'STAFF' && <><br /><span className="muted">{e.actor.email} · {e.actor.role === 'MUNICIPAL_OFFICIAL' ? 'Municipal official' : 'Moderator'}</span></>}
        </dd>
        <dt>Date</dt><dd>{fullDate(e.at)} <span className="muted">({ago(e.at)})</span></dd>
        {statusChange && <>
          <dt>Previous {e.action === 'STATUS_CHANGED' ? 'state' : fieldLabel(e.field)}</dt><dd>{show(e.oldValue)}</dd>
          <dt>New {e.action === 'STATUS_CHANGED' ? 'state' : fieldLabel(e.field)}</dt><dd>{show(e.newValue)}</dd>
        </>}
        {visibleNote(e) && <><dt>{e.action === 'MODERATOR_REMOVED' ? 'Reason' : 'Note'}</dt><dd>{visibleNote(e)}</dd></>}
        <dt>Hazard</dt>
        <dd>{TYPE_LABEL[e.hazardType]} {shortId(e.hazardId)}<br /><span className="muted">{coords(e.latitude, e.longitude)}</span></dd>
      </dl>
      <Link className="btn btn-secondary" to={`/map?hazard=${e.hazardId}`}>Open hazard</Link>
    </aside>
  );
}
