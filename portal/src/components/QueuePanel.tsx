import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'react-router';
import { MapPin } from 'lucide-react';
import { UNASSIGNED, type Hazard, type HazardType, type QueueSort, type Stats } from '../api/types';
import { plural } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { buildQuery, filterChips, refine, resolveTab, tabCount, type QueueChip, type QueueTab } from '../lib/queue';
import { useShortcuts } from '../lib/shortcuts';
import { ActionDialog } from './ActionDialog';
import type { ViewConfig } from '../lib/views';
import { useDepartments } from '../state/departments';
import { useQueue } from '../state/useQueue';
import { BulkBar } from './BulkBar';
import { FilterBar, NO_FILTERS, activeFilterCount, type Filters } from './FilterBar';
import { HazardRow } from './HazardRow';
import { Chevron } from './Chevron';
import { TabIndicator } from './Segmented';
import { Menu } from './Menu';
import { EmptyState, ErrorState, SkeletonRows } from './States';
import { QueueMoreMenu } from './QueueMoreMenu';

export interface QueueControls {
  tab: QueueTab; setTab: (key: string) => void;
  /** The page's "Filter by" chips, and which are on. */
  chipDefs: QueueChip[]; chips: string[]; toggleChip: (key: string) => void; clearChips: () => void;
  /** How many of the tab's hazards (after search and filters) each chip would keep. */
  chipCounts: Record<string, number>;
  filters: Filters; setFilters: (f: Filters) => void;
  sort: QueueSort; setSort: (s: QueueSort) => void;
  search: string; setSearch: (s: string) => void;
  filtersOpen: boolean; toggleFilters: () => void;
  queue: ReturnType<typeof useQueue>;
  /** After search, the exact area shape and the chips. */
  shown: Hazard[];
  area: Barangay | undefined;
  /** Changes when the filters (not live data) change. */
  filterKey: string;
  /** Apply a saved view's tab, chips, filters, sort and search. */
  apply: (v: Omit<ViewConfig, 'page'>) => void;
}

export function useQueueControls(tabs: QueueTab[], chipDefs: QueueChip[], barangays: Barangay[], initialTab?: string,
  initialArea?: string, initialType?: HazardType): QueueControls {
  const [start] = useState(() => resolveTab(tabs, chipDefs, initialTab));
  const [tabKey, setTabKey] = useState(start.tab);
  const [chips, setChips] = useState<string[]>(start.chips);
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, area: initialArea ?? '', types: initialType ? [initialType] : [] });
  const [sort, setSort] = useState<QueueSort>(() => tabs.find((t) => t.key === start.tab)?.sort ?? 'review');
  const setTab = (key: string) => {
    setTabKey(key);
    const next = tabs.find((t) => t.key === key);
    if (next?.sort) setSort(next.sort);
    // Closed hazards have no severity/contest/expiry state worth narrowing by.
    if (next?.archive) setChips([]);
  };
  const [search, setSearch] = useState('');
  // Active filters show as pills under the dropdowns, so the More panel only opens when asked.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const tab = tabs.find((t) => t.key === tabKey) ?? tabs[0];
  const query = useMemo(() => buildQuery(tab, filters, sort, barangays), [tab, filters, sort, barangays]);
  const raw = useQueue(query);
  const queue = useMemo(() => (tab.hideArchived ? { ...raw, hazards: raw.hazards.filter((h) => !h.archivedAt) } : raw), [raw, tab.hideArchived]);
  const base = useMemo(() => refine(queue.hazards, search, filters, barangays), [queue.hazards, search, filters, barangays]);
  const active = useMemo(() => chipDefs.filter((c) => chips.includes(c.key)), [chipDefs, chips]);
  const shown = useMemo(() => (active.length ? base.filter((h) => active.every((c) => c.match(h, now))) : base), [base, active, now]);
  const chipCounts = useMemo(() => Object.fromEntries(chipDefs.map((c) => [c.key, base.filter((h) => c.match(h, now)).length])),
    [base, chipDefs, now]);
  const area = filters.area ? barangays.find((b) => b.name === filters.area) : undefined;
  return {
    tab, setTab, chipDefs, chips, chipCounts,
    toggleChip: (key) => setChips((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])),
    clearChips: () => setChips([]),
    filters, setFilters, sort, setSort, search, setSearch,
    filtersOpen, toggleFilters: () => setFiltersOpen((o) => !o),
    queue, shown, area, filterKey: JSON.stringify(query) + chips.join(','),
    apply: (v) => {
      // Older saved views may name a tab that is now a chip (e.g. "contested").
      const resolved = resolveTab(tabs, chipDefs, v.tab || tabKey);
      setTab(resolved.tab);
      setChips([...new Set([...resolved.chips, ...(v.chips ?? []).filter((k) => chipDefs.some((c) => c.key === k))])]);
      setFilters(v.filters);
      setSort(v.sort);
      setSearch(v.search);
    },
  };
}

/**
 * Applies a search from the top bar (?q=, with an optional ?tab=), then drops it from the URL so the
 * same search can be run again and a reload doesn't repeat it.
 */
export function useSearchLink(c: QueueControls) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q');
  const { setSearch, setTab } = c;
  useEffect(() => {
    if (q == null) return;
    const tab = params.get('tab');
    if (tab) setTab(tab);
    setSearch(q);
    setParams((p) => { const next = new URLSearchParams(p); next.delete('q'); return next; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
}

/** Tabs, search/sort/filters and the compact hazard list. */
export function QueuePanel({ c, tabs, stats, barangays, selectedId, onSelect, searchRef, title, page, onShowOnMap }: {
  c: QueueControls; tabs: QueueTab[]; stats: Stats | null; barangays: Barangay[];
  selectedId: string | null; onSelect: (h: Hazard) => void; searchRef: RefObject<HTMLInputElement | null>; title?: string;
  page: ViewConfig['page'];
  /** A "Map" quick action on each row (not needed on the map page itself). */
  onShowOnMap?: (h: Hazard) => void;
}) {
  const departments = useDepartments();
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggleChecked = useCallback((h: Hazard) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(h.id)) next.delete(h.id); else next.add(h.id);
    return next;
  }), []);
  const endSelect = () => { setSelectMode(false); setChecked(new Set()); };
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const { queue, shown } = c;
  const selectedHazards = shown.filter((h) => checked.has(h.id));
  const allChecked = shown.length > 0 && selectedHazards.length === shown.length;
  const newShown = shown.filter((h) => queue.newIds.has(h.id));
  const [resolving, setResolving] = useState<Hazard | null>(null);
  // Ages, reasons and "expires in" are relative to this; it moves forward every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Bring the selected row into view (e.g. after clicking its marker).
  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`row-${selectedId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const jumpToNew = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => queue.clearNew(), 4000);
  };

  // New reports go to the top; mark them, and if the official is reading further down, offer a jump.
  const ordered = useMemo(() => {
    if (!newShown.length) return shown;
    const fresh = new Set(newShown.map((h) => h.id));
    return [...shown.filter((h) => fresh.has(h.id)), ...shown.filter((h) => !fresh.has(h.id))];
  }, [shown, newShown]);

  // ↑/↓ (or k/j) walk the queue; the detail drawer follows the selection.
  const step = (by: number) => {
    // Arrow keys pan a focused map; leave them to it.
    if ((document.activeElement as HTMLElement | null)?.closest('.leaflet-container')) return false;
    if (!ordered.length) return;
    const i = ordered.findIndex((h) => h.id === selectedId);
    const next = ordered[i < 0 ? (by > 0 ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, i + by))];
    onSelect(next);
    document.getElementById(`row-${next.id}`)?.focus({ preventScroll: true });
  };
  useShortcuts({ arrowdown: () => step(1), arrowup: () => step(-1), j: () => step(1), k: () => step(-1) });

  // An empty tab points at another one that still has work, inbox first.
  const counts = (t: QueueTab) => tabCount(t, stats?.queueCounts) ?? 0;
  const primaryTabs = tabs.filter((t) => !t.more);
  const tabsId = useId();
  // A new key each time a (re)load finishes, so results fade in after a tab or filter change.
  const [loads, setLoads] = useState(0);
  const [wasLoading, setWasLoading] = useState(queue.loading);
  if (wasLoading !== queue.loading) {
    setWasLoading(queue.loading);
    if (!queue.loading) setLoads((n) => n + 1);
  }
  const phaseKey = queue.loading ? 'loading' : queue.error ? 'error' : `results-${loads}`;
  const noun = page === 'moderation' ? 'report' : 'hazard';
  const term = c.search.trim().toLowerCase();
  const places = page === 'map' && term.length >= 2
    ? barangays.filter((b) => b.name.toLowerCase().includes(term) && b.name !== c.filters.area).slice(0, 3) : [];
  const moreTabs = tabs.filter((t) => t.more);
  const elsewhere = tabs.filter((t) => t.key !== c.tab.key && !t.archive && counts(t) > 0)
    .sort((a, b) => (a.key === 'attention' ? -1 : b.key === 'attention' ? 1 : 0))[0];
  const activeChips = c.chipDefs.filter((ch) => c.chips.includes(ch.key));
  const listTitle = [c.tab.label, ...activeChips.map((ch) => ch.label)].join(' · ');
  // Printed under "Scope" on exports.
  const exportFilters = [
    ...filterChips(c.filters, (code) => (code === UNASSIGNED ? 'Unassigned' : departments.find((d) => d.code === code)?.name ?? code)).map((f) => f.label),
    ...(c.search ? [`Search “${c.search}”`] : []),
  ];

  return (
    <div className="queue">
      {title && <h2 className="queue-title">{title}</h2>}
      {/* 1. Where am I? Primary tabs, with the rarer ones under More. Only a waiting review count is red. */}
      <div className="tabs" role="tablist" aria-label="Queue">
        {primaryTabs.map((t) => {
          const count = tabCount(t, stats?.queueCounts);
          const urgent = t.key === 'attention' && !!count;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={c.tab.key === t.key}
              className={`tab${c.tab.key === t.key ? ' active' : ''}`} onClick={() => c.setTab(t.key)}>
              {t.label}
              {/* Keyed on the value: a new count fades in rather than the label jumping. */}
              {count !== undefined && <span key={count} className={`tab-count${urgent ? ' urgent' : ''}${count === 0 ? ' zero' : ''}`}>{count}</span>}
              {c.tab.key === t.key && <TabIndicator id={tabsId} />}
            </button>
          );
        })}
        {moreTabs.length > 0 && (
          <Menu label="More queues" align="left"
            trigger={<span className={`tab tab-more${c.tab.more ? ' active' : ''}`}>{c.tab.more ? c.tab.label : 'More'}<Chevron />{c.tab.more && <TabIndicator id={tabsId} />}</span>}
            items={moreTabs.map((t) => ({
              label: t.label, checked: c.tab.key === t.key, radio: true,
              meta: tabCount(t, stats?.queueCounts), onSelect: () => c.setTab(t.key),
            }))} />
        )}
      </div>
      {/* 2. Search, then the filters as dropdowns; active ones show as removable pills. */}
      <FilterBar ref={searchRef} search={c.search} onSearch={c.setSearch} sort={c.sort} onSort={c.setSort}
        placeholder={page === 'map' ? 'Search hazards or places…' : undefined}
        filters={c.filters} onFilters={c.setFilters} barangays={barangays} departments={departments}
        chipDefs={c.chipDefs} chips={c.chips} onToggleChip={c.toggleChip} onClearChips={c.clearChips} showStatus={!c.tab.archive}
        open={c.filtersOpen} onToggle={c.toggleFilters} extra={
          // Views, export and select share one menu.
          <QueueMoreMenu page={page} onApply={c.apply}
            current={() => ({ page, tab: c.tab.key, chips: c.chips, filters: c.filters, sort: c.sort, search: c.search })}
            hazards={shown} title={listTitle} filters={exportFilters} barangays={barangays} departments={departments} stats={stats}
            onSelectMode={() => setSelectMode(true)} />
        } />
      <AnimatePresence initial={false}>
        {selectMode && (
          <motion.div key="bulk" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.14 } }}>
            <BulkBar selected={selectedHazards} total={shown.length} allChecked={allChecked}
              onToggleAll={() => setChecked(allChecked ? new Set() : new Set(shown.map((h) => h.id)))}
              departments={departments} barangays={barangays} stats={stats} exportable={page === 'moderation'}
              onCancel={endSelect} onDone={() => { setChecked(new Set()); window.setTimeout(queue.reload, 900); }} />
          </motion.div>
        )}
      </AnimatePresence>
      {/* On the map, a search that names a barangay offers to show that place. */}
      {places.length > 0 && (
        <div className="place-results" aria-label="Places">
          <span className="place-results-label">Places</span>
          {places.map((b) => (
            <button key={b.name} type="button" className="place-result"
              onClick={() => { c.setFilters({ ...c.filters, area: b.name }); c.setSearch(''); }}>
              <MapPin size={14} aria-hidden="true" />{b.name}<span>Show area</span>
            </button>
          ))}
        </div>
      )}
      {/* 3. How many. */}
      <p className="queue-summary" aria-live="polite">
        {!queue.loading && !queue.error && (
          <>
            <strong>{plural(shown.length, noun)}</strong>
            {shown.length !== queue.hazards.length || c.search ? <span> of {queue.hazards.length}</span> : null}
            {queue.truncated && <span> (first {queue.hazards.length} of {queue.total})</span>}
          </>
        )}
      </p>
      {!queue.loading && !queue.error && shown.length > 0 && !selectMode && (
        <div className="queue-head table-only" aria-hidden="true">
          <span>Hazard</span><span>Location</span><span>Priority</span><span>Status</span><span className="num">Age</span><span />
        </div>
      )}
      <div className="queue-scroll" ref={listRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 80)}>
        {scrolled && newShown.length > 0 && (
          <button type="button" className="new-reports-pill" onClick={jumpToNew}>↑ {plural(newShown.length, 'new report')}</button>
        )}
        {/* Tab and filter changes: the old results fade out, then the skeleton or the new results
            rise in. Live reloads keep the same key, so they never fade the whole list. */}
        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={phaseKey} className="queue-phase"
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}>
        {queue.loading && <SkeletonRows />}
        {!queue.loading && queue.error && (
          <ErrorState title="We couldn’t load hazard reports." message={queue.error} onRetry={queue.reload} />
        )}
        {!queue.loading && !queue.error && shown.length === 0 && (
          activeChips.length && !c.search && !activeFilterCount(c.filters)
            ? <EmptyState icon="search" title={activeChips.length === 1 ? activeChips[0].empty.title : 'Nothing matches these filters'}
                action={{ text: `${plural(queue.hazards.length, 'hazard')} in ${c.tab.label} without ${activeChips.length === 1 ? 'this filter' : 'these filters'}.`,
                  label: activeChips.length === 1 ? 'Clear filter' : 'Clear filters', onClick: c.clearChips }}>
                {activeChips.length === 1 ? activeChips[0].empty.body : 'No hazard in this tab matches all of them.'}
              </EmptyState>
            : c.search || activeFilterCount(c.filters) || activeChips.length
            ? <EmptyState icon="search" title="No hazards match">Try a different search, or clear the filters.</EmptyState>
            : <EmptyState title={c.tab.empty.title} action={elsewhere ? {
                text: `You still have ${plural(counts(elsewhere), 'report')} in ${elsewhere.label}.`,
                label: `Go to ${elsewhere.label}`, onClick: () => c.setTab(elsewhere.key),
              } : null}>{c.tab.empty.body}</EmptyState>
        )}
        {!queue.loading && !queue.error && shown.length > 0 && (
          <ul className="hazard-list">
            {/* Rows that leave the queue (resolved, reassigned) collapse; re-sorted rows slide. */}
            <AnimatePresence initial={false}>
            {ordered.map((h) => (
              <HazardRow key={h.id} hazard={h} selected={h.id === selectedId} isNew={queue.newIds.has(h.id)}
                barangays={barangays} onSelect={onSelect}
                checkable={selectMode} checked={checked.has(h.id)} onCheck={toggleChecked}
                tabKey={c.tab.key} chipKeys={c.chips} now={now} onResolve={setResolving} onShowOnMap={onShowOnMap} />
            ))}
            </AnimatePresence>
          </ul>
        )}
        </motion.div>
        </AnimatePresence>
      </div>
      {resolving && (
        <ActionDialog action="resolve" hazard={resolving} onClose={() => setResolving(null)}
          onDone={() => { setResolving(null); window.setTimeout(queue.reload, 900); }} />
      )}
    </div>
  );
}
