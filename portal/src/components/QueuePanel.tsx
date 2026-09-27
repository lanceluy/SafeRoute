import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Hazard, QueueSort, Stats } from '../api/types';
import { plural } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { buildQuery, refine, type QueueTab } from '../lib/queue';
import { useQueue } from '../state/useQueue';
import { FilterBar, NO_FILTERS, activeFilterCount, type Filters } from './FilterBar';
import { HazardRow } from './HazardRow';
import { EmptyState, ErrorState, SkeletonRows } from './States';

export interface QueueControls {
  tab: QueueTab; setTab: (key: string) => void;
  filters: Filters; setFilters: (f: Filters) => void;
  sort: QueueSort; setSort: (s: QueueSort) => void;
  search: string; setSearch: (s: string) => void;
  filtersOpen: boolean; toggleFilters: () => void;
  queue: ReturnType<typeof useQueue>;
  /** After search and the exact area shape. */
  shown: Hazard[];
  area: Barangay | undefined;
  /** Changes when the filters (not live data) change. */
  filterKey: string;
}

export function useQueueControls(tabs: QueueTab[], barangays: Barangay[], initialTab?: string, initialArea?: string): QueueControls {
  const [tabKey, setTab] = useState(initialTab && tabs.some((t) => t.key === initialTab) ? initialTab : tabs[0].key);
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, area: initialArea ?? '' });
  const [sort, setSort] = useState<QueueSort>('review');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(!!initialArea);
  const tab = tabs.find((t) => t.key === tabKey) ?? tabs[0];
  const query = useMemo(() => buildQuery(tab, filters, sort, barangays), [tab, filters, sort, barangays]);
  const queue = useQueue(query);
  const shown = useMemo(() => refine(queue.hazards, search, filters, barangays), [queue.hazards, search, filters, barangays]);
  const area = filters.area ? barangays.find((b) => b.name === filters.area) : undefined;
  return {
    tab, setTab, filters, setFilters, sort, setSort, search, setSearch,
    filtersOpen, toggleFilters: () => setFiltersOpen((o) => !o),
    queue, shown, area, filterKey: JSON.stringify(query),
  };
}

/** Tabs, search/sort/filters and the compact hazard list. */
export function QueuePanel({ c, tabs, stats, barangays, selectedId, onSelect, searchRef, title }: {
  c: QueueControls; tabs: QueueTab[]; stats: Stats | null; barangays: Barangay[];
  selectedId: string | null; onSelect: (h: Hazard) => void; searchRef: RefObject<HTMLInputElement | null>; title?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const { queue, shown } = c;
  const newShown = shown.filter((h) => queue.newIds.has(h.id));

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

  return (
    <div className="queue">
      {title && <h2 className="queue-title">{title}</h2>}
      <div className="tabs" role="tablist" aria-label="Queue">
        {tabs.map((t) => {
          const count = t.view ? stats?.queueCounts[t.view] : undefined;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={c.tab.key === t.key}
              className={c.tab.key === t.key ? 'tab active' : 'tab'} onClick={() => c.setTab(t.key)}>
              {t.label}
              {count !== undefined && <span className={`tab-count${t.key === 'attention' && count > 0 ? ' urgent' : ''}`}>{count}</span>}
            </button>
          );
        })}
      </div>
      <FilterBar ref={searchRef} search={c.search} onSearch={c.setSearch} sort={c.sort} onSort={c.setSort}
        filters={c.filters} onFilters={c.setFilters} barangays={barangays} open={c.filtersOpen} onToggle={c.toggleFilters} />
      <p className="queue-summary" aria-live="polite">
        {!queue.loading && !queue.error && (
          <>
            {plural(shown.length, 'hazard')}
            {c.search || c.filters.area ? ` of ${queue.hazards.length}` : ''}
            {queue.truncated && ` (first ${queue.hazards.length} of ${queue.total})`}
            {activeFilterCount(c.filters) > 0 && ' · filtered'}
          </>
        )}
      </p>
      <div className="queue-scroll" ref={listRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 80)}>
        {scrolled && newShown.length > 0 && (
          <button type="button" className="new-reports-pill" onClick={jumpToNew}>↑ {plural(newShown.length, 'new report')}</button>
        )}
        {queue.loading && <SkeletonRows />}
        {!queue.loading && queue.error && (
          <ErrorState title="We couldn’t load hazard reports." message={queue.error} onRetry={queue.reload} />
        )}
        {!queue.loading && !queue.error && shown.length === 0 && (
          c.search || activeFilterCount(c.filters)
            ? <EmptyState icon="⌕" title="No hazards match">Try a different search, or clear the filters.</EmptyState>
            : <EmptyState title={c.tab.empty.title}>{c.tab.empty.body}</EmptyState>
        )}
        {!queue.loading && !queue.error && shown.length > 0 && (
          <ul className="hazard-list">
            {ordered.map((h) => (
              <HazardRow key={h.id} hazard={h} selected={h.id === selectedId} isNew={queue.newIds.has(h.id)}
                barangays={barangays} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
