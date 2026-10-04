import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Keyboard, TriangleAlert, X } from 'lucide-react';
import type { Hazard } from '../api/types';
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

const OPEN = { view: 'active' as const };
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
  const overdue = useOverdue();

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
        actions={<>
          <QuickFilters c={c} needsReview={stats?.totals.needsReview} high={stats?.queueCounts.high} overdue={overdue} />
          <Link to="/help" className="icon-btn ghost-icon" title="Keyboard shortcuts" aria-label="Keyboard shortcuts and help">
            <Keyboard size={18} aria-hidden="true" />
          </Link>
        </>} />
      <OverdueBanner c={c} count={overdue?.high ?? 0} />
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

/** Open reports older than 7 days (archived or not), and how many of them are high severity. */
function useOverdue() {
  const open = useQueue(OPEN);
  const [now] = useState(() => Date.now());
  return useMemo(() => {
    if (open.loading && !open.hazards.length) return undefined;
    const stale = open.hazards.filter((h) => isStale(h, now));
    return { all: stale.length, high: stale.filter((h) => h.severity === 'HIGH').length };
  }, [open.hazards, open.loading, now]);
}

function show(c: QueueControls, tab: string, filters: Partial<Filters> = {}, sort = c.sort) {
  c.apply({ tab, chips: [], filters: { ...NO_FILTERS, ...filters }, sort, search: '' });
}

/** Three small shortcuts to the slices that need attention; the queue stays the main thing. */
function QuickFilters({ c, needsReview, high, overdue }: {
  c: QueueControls; needsReview?: number; high?: number; overdue?: { all: number };
}) {
  const quick = [
    { key: 'review', label: 'Needs review', value: needsReview, tone: 'review', title: 'Contested, unverified high severity, or waiting over a day',
      go: () => show(c, 'attention') },
    { key: 'high', label: 'High severity', value: high, tone: 'high', title: 'High-severity reports in the working queue',
      go: () => show(c, 'active', { severities: ['HIGH'] }) },
    // Overdue spans the working queue and Archived, so it opens All open.
    { key: 'overdue', label: 'Overdue', value: overdue?.all, tone: 'overdue', title: `Open more than ${STALE_DAYS} days, archived or not`,
      go: () => show(c, 'open', { date: 'older7' }, 'oldest') },
  ];
  return (
    <div className="quick-filters" role="group" aria-label="Quick filters">
      {quick.map((q) => (
        <button key={q.key} type="button" className={`quick-filter${q.value ? ` tone-${q.tone}` : ''}`} onClick={q.go} title={q.title}>
          {q.label}<strong>{q.value ?? '–'}</strong>
        </button>
      ))}
    </div>
  );
}

/** Shown only when high-severity reports are overdue; dismissable for the session. */
function OverdueBanner({ c, count }: { c: QueueControls; count: number }) {
  const [dismissed, setDismissed] = useState(bannerDismissed);
  if (!count || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(BANNER_KEY, '1'); } catch { /* shows again next time */ }
  };
  return (
    <div className="alert-banner" role="status">
      <TriangleAlert size={17} aria-hidden="true" />
      <span><strong>{plural(count, 'high-severity report')} {count === 1 ? 'is' : 'are'} overdue.</strong></span>
      <button type="button" className="btn btn-sm btn-ghost alert-action"
        onClick={() => show(c, 'open', { severities: ['HIGH'], date: 'older7' }, 'oldest')}>
        Review<ArrowRight size={15} aria-hidden="true" />
      </button>
      <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss for this session"><X size={16} aria-hidden="true" /></button>
    </div>
  );
}
