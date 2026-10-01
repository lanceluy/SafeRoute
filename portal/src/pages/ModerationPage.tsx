import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Clock, Keyboard, ScanSearch, TriangleAlert, UserX, X } from 'lucide-react';
import { UNASSIGNED, type Hazard } from '../api/types';
import { NO_FILTERS, type Filters } from '../components/FilterBar';
import { HazardDrawer } from '../components/HazardDrawer';
import { QueuePanel, useQueueControls, useSearchLink, type QueueControls } from '../components/QueuePanel';
import { PageHeader } from '../components/ui';
import { plural } from '../lib/format';
import { MODERATION_CHIPS, MODERATION_TABS, STALE_DAYS, isStale } from '../lib/queue';
import { useShortcuts } from '../lib/shortcuts';
import { useBarangays } from '../state/places';
import { useQueue } from '../state/useQueue';
import { useStats } from '../state/useStats';

const ACTIVE = { view: 'active' as const };
const BANNER_KEY = 'saferoute.moderation.overdueBanner';

/**
 * The review queue, full width: page context → what needs attention (tiles, and a banner only when
 * something is genuinely overdue) → tabs, search and filters → the list.
 */
export function ModerationPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const barangays = useBarangays();
  const c = useQueueControls(MODERATION_TABS, MODERATION_CHIPS, barangays, params.get('tab') ?? undefined);
  useSearchLink(c);
  const { stats } = useStats();
  const selectedId = params.get('hazard');
  const searchRef = useRef<HTMLInputElement>(null);

  const select = useCallback((h: Hazard | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (h) next.set('hazard', h.id); else next.delete('hazard');
      return next;
    }, { replace: true });
  }, [setParams]);

  useShortcuts({
    '/': () => searchRef.current?.focus(),
    f: c.toggleFilters,
    m: () => { navigate(selectedId ? `/map?hazard=${selectedId}` : '/map'); },
  });

  return (
    <div className={`moderation-page${selectedId ? ' has-drawer' : ''}`}>
      <PageHeader title="Moderation" subtitle="Review and manage reported hazards."
        actions={<Link to="/help" className="icon-btn ghost-icon" title="Keyboard shortcuts" aria-label="Keyboard shortcuts and help">
          <Keyboard size={18} aria-hidden="true" />
        </Link>} />
      <ModerationSummary c={c} needsReview={stats?.totals.needsReview} />
      <div className="moderation-body">
        <section className="card moderation-queue">
          <QueuePanel c={c} tabs={MODERATION_TABS} stats={stats} barangays={barangays} selectedId={selectedId}
            onSelect={select} searchRef={searchRef} page="moderation"
            onShowOnMap={(h) => navigate(`/map?hazard=${h.id}&tab=active`)} />
        </section>
        {selectedId && (
          <HazardDrawer key={selectedId} hazardId={selectedId} barangays={barangays} onClose={() => select(null)} onChanged={c.queue.reload}
            onShowOnMap={() => navigate(`/map?hazard=${selectedId}&tab=active`)} />
        )}
      </div>
    </div>
  );
}

function bannerDismissed() {
  try { return sessionStorage.getItem(BANNER_KEY) === '1'; } catch { return false; }
}

/** Four numbers that answer "what needs me?", each one a shortcut to that slice of the queue. */
function ModerationSummary({ c, needsReview }: { c: QueueControls; needsReview?: number }) {
  const active = useQueue(ACTIVE);
  const [now] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(bannerDismissed);
  // Counted from the same All active list each tile opens, so the number always matches the rows.
  // (The stats endpoint's high/unassigned counts leave archived hazards out; All active doesn't.)
  const counts = useMemo(() => {
    const overdue = active.hazards.filter((h) => isStale(h, now));
    return {
      high: active.hazards.filter((h) => h.severity === 'HIGH').length,
      unassigned: active.hazards.filter((h) => !h.assignedDepartment).length,
      overdue: overdue.length,
      overdueHigh: overdue.filter((h) => h.severity === 'HIGH').length,
    };
  }, [active.hazards, now]);
  const overdueHigh = counts.overdueHigh;
  const loading = active.loading && !active.hazards.length;
  const n = (v: number) => (loading ? undefined : v);

  const show = (tab: string, filters: Partial<Filters> = {}) => {
    c.apply({ tab, chips: [], filters: { ...NO_FILTERS, ...filters }, sort: c.sort, search: '' });
  };
  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(BANNER_KEY, '1'); } catch { /* shows again next time */ }
  };

  const tiles = [
    { key: 'review', label: 'Needs review', value: needsReview, icon: <ScanSearch aria-hidden="true" />, tone: needsReview ? 'review' : '',
      hint: 'Contested, unverified high severity, or waiting over a day', go: () => show('attention') },
    { key: 'high', label: 'High severity', value: n(counts.high), icon: <TriangleAlert aria-hidden="true" />, tone: counts.high ? 'high' : '',
      hint: 'Active high-severity hazards', go: () => show('active', { severities: ['HIGH'] }) },
    { key: 'unassigned', label: 'Unassigned', value: n(counts.unassigned), icon: <UserX aria-hidden="true" />, tone: '',
      hint: 'Active hazards no department is handling', go: () => show('active', { departments: [UNASSIGNED] }) },
    { key: 'overdue', label: 'Overdue', value: n(counts.overdue), icon: <Clock aria-hidden="true" />, tone: '',
      hint: `Active and reported more than ${STALE_DAYS} days ago`, go: () => show('active', { date: 'older7' }) },
  ];

  return (
    <>
      <div className="summary-tiles">
        {tiles.map((t) => (
          <button key={t.key} type="button" className={`summary-tile${t.tone ? ` tone-${t.tone}` : ''}`} onClick={t.go} title={t.hint}>
            <span className="summary-label"><span className="summary-icon">{t.icon}</span>{t.label}</span>
            <span className="summary-value">
              {t.value === undefined ? <span className="skeleton" style={{ width: 36, height: 24, display: 'inline-block' }} /> : t.value.toLocaleString()}
            </span>
          </button>
        ))}
      </div>
      {overdueHigh > 0 && !dismissed && (
        <div className="alert-banner" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <span>
            <strong>{plural(overdueHigh, 'high-severity hazard')} {overdueHigh === 1 ? 'has' : 'have'} been open longer than {STALE_DAYS} days.</strong>
            {' '}Oldest first, so the longest waits get seen.
          </span>
          <button type="button" className="btn btn-sm btn-secondary"
            onClick={() => c.apply({ tab: 'active', chips: [], filters: { ...NO_FILTERS, severities: ['HIGH'], date: 'older7' }, sort: 'oldest', search: '' })}>
            Review<ArrowRight size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss for this session"><X size={16} aria-hidden="true" /></button>
        </div>
      )}
    </>
  );
}
