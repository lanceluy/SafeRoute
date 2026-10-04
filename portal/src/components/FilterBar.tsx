import { forwardRef } from 'react';
import {
  CONFIDENCES, HAZARD_TYPES, PRIORITIES, SEVERITIES, UNASSIGNED, type Confidence, type Department, type HazardType,
  type MunicipalPriority, type QueueSort, type Severity,
} from '../api/types';
import type { Barangay } from '../lib/geo';
import { CONFIDENCE_HINT, CONFIDENCE_LABEL, PRIORITY_HINT, PRIORITY_LABEL, SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { filterChips, type QueueChip } from '../lib/queue';

/** Reported within a period, or `older7`: reported more than a week ago. */
export type DateRange = 'any' | 'today' | '7d' | '30d' | 'older7';

export interface Filters {
  types: HazardType[];
  severities: Severity[];
  confidences: Confidence[];
  date: DateRange;
  area: string;
  /** Department codes, or UNASSIGNED. */
  departments: string[];
  priorities: MunicipalPriority[];
  /** A box drawn on the map: [minLat, minLon, maxLat, maxLon]. */
  region: [number, number, number, number] | null;
}

export const NO_FILTERS: Filters = {
  types: [], severities: [], confidences: [], date: 'any', area: '', departments: [], priorities: [], region: null,
};

export function activeFilterCount(f: Filters) {
  return f.types.length + f.severities.length + f.confidences.length + (f.date !== 'any' ? 1 : 0) + (f.area ? 1 : 0)
    + f.departments.length + f.priorities.length + (f.region ? 1 : 0);
}

export function dateFrom(range: DateRange): string | undefined {
  if (range === 'any' || range === 'older7') return undefined;
  const d = new Date();
  if (range === 'today') d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (range === '7d' ? 7 : 30));
  return d.toISOString();
}

export function dateTo(range: DateRange): string | undefined {
  return range === 'older7' ? new Date(Date.now() - 7 * 86_400_000).toISOString() : undefined;
}

export const SORTS: { value: QueueSort; label: string }[] = [
  { value: 'review', label: 'Review order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest unresolved' },
  { value: 'severity', label: 'Highest severity' },
  { value: 'confidence', label: 'Lowest confidence' },
  { value: 'disputed', label: 'Most disputed' },
  { value: 'confirmed', label: 'Most confirmed' },
  { value: 'expiring', label: 'Expiring soonest' },
  { value: 'priority', label: 'City priority' },
  { value: 'updated', label: 'Recently updated' },
];

const DATES: { value: DateRange; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'older7', label: 'Older than 7 days' },
];

function toggle<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Chips with their own section in the panel (Severity, Assignment) stay out of Status. */
const NOT_STATUS = new Set(['high', 'unassigned']);

/** A checkbox chip in the Filters panel. */
function Toggle({ on, onChange, children, title }: { on: boolean; onChange: () => void; children: React.ReactNode; title?: string }) {
  return (
    <label className={`chip${on ? ' on' : ''}`} title={title}>
      <input type="checkbox" checked={on} onChange={onChange} />
      {children}
    </label>
  );
}

/**
 * One row: search, one Filters button, sort and the ••• menu. Every filter lives in the panel the
 * button opens; what's applied shows as removable pills only once something is chosen. Status
 * toggles the page's queue chips (client-side); the rest set server-side query filters.
 */
export const FilterBar = forwardRef<HTMLInputElement, {
  search: string; onSearch: (s: string) => void;
  sort: QueueSort; onSort: (s: QueueSort) => void;
  filters: Filters; onFilters: (f: Filters) => void;
  barangays: Barangay[];
  departments: Department[];
  chipDefs: QueueChip[]; chips: string[]; onToggleChip: (key: string) => void; onClearChips: () => void;
  /** Hidden for closed tabs, where queue chips don't apply. */
  showStatus: boolean;
  open: boolean; onToggle: () => void;
  /** The ••• menu, at the end of the row. */
  extra?: React.ReactNode;
  placeholder?: string;
}>(function FilterBar({
  search, onSearch, sort, onSort, filters, onFilters, barangays, departments, chipDefs, chips: activeChips, onToggleChip, onClearChips,
  showStatus, open, onToggle, extra, placeholder = 'Search reports…',
}, searchRef) {
  const deptName = (code: string) => (code === UNASSIGNED ? 'Unassigned' : departments.find((d) => d.code === code)?.name ?? code);
  const filterPills = filterChips(filters, deptName);
  const statusChips = chipDefs.filter((c) => activeChips.includes(c.key));
  const statusDefs = chipDefs.filter((c) => !NOT_STATUS.has(c.key));
  const count = filterPills.length + statusChips.length;

  return (
    <div className="filter-bar">
      <div className="filter-row" role="toolbar" aria-label="Search, filter and sort">
        <label className="search">
          <span className="sr-only">Search reports</span>
          <Search aria-hidden="true" className="search-icon" size={16} />
          <input ref={searchRef} type="search" placeholder={placeholder}
            title="Search by hazard type, description, street, barangay or reference" value={search}
            onChange={(e) => onSearch(e.target.value)} />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <button type="button" className={`filter-drop${count ? ' on' : ''}`} aria-expanded={open} onClick={onToggle}>
          <SlidersHorizontal size={15} aria-hidden="true" />Filters{count ? <span className="filter-drop-count">{count}</span> : null}
        </button>
        <label className="sort-control">
          <span className="sr-only">Sort</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as QueueSort)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {extra}
      </div>

      {count > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {statusChips.map((c) => (
            <button key={c.key} type="button" className="filter-chip" onClick={() => onToggleChip(c.key)} aria-label={`Remove filter: ${c.label}`}>
              {c.label}<X size={13} aria-hidden="true" />
            </button>
          ))}
          {filterPills.map((c) => (
            <button key={c.key} type="button" className="filter-chip" onClick={() => onFilters(c.remove(filters))} aria-label={`Remove filter: ${c.label}`}>
              {c.label}<X size={13} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="btn-link" onClick={() => { onFilters(NO_FILTERS); onClearChips(); }}>Clear all</button>
        </div>
      )}

      {open && (
        <div className="filter-panel">
          <fieldset>
            <legend>Severity</legend>
            <div className="chips">
              {SEVERITIES.map((s) => (
                <Toggle key={s} on={filters.severities.includes(s)} onChange={() => onFilters({ ...filters, severities: toggle(filters.severities, s) })}>
                  <span className={`sev-dot sev-bg-${s.toLowerCase()}`} aria-hidden="true" />{SEVERITY_LABEL[s]}
                </Toggle>
              ))}
            </div>
          </fieldset>
          {showStatus && statusDefs.length > 0 && (
            <fieldset>
              <legend>Status</legend>
              <div className="chips">
                {statusDefs.map((c) => (
                  <Toggle key={c.key} on={activeChips.includes(c.key)} onChange={() => onToggleChip(c.key)}>{c.label}</Toggle>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend>Barangay</legend>
            <select value={filters.area} onChange={(e) => onFilters({ ...filters, area: e.target.value })} aria-label="Barangay">
              <option value="">All of Makati</option>
              {barangays.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </fieldset>
          <fieldset>
            <legend>Assignment</legend>
            <div className="chips">
              {[{ code: UNASSIGNED, name: 'Unassigned' }, ...departments].map((d) => (
                <Toggle key={d.code} on={filters.departments.includes(d.code)}
                  onChange={() => onFilters({ ...filters, departments: toggle(filters.departments, d.code) })}>{d.name}</Toggle>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Type</legend>
            <div className="chips">
              {HAZARD_TYPES.map((t) => (
                <Toggle key={t} on={filters.types.includes(t)} onChange={() => onFilters({ ...filters, types: toggle(filters.types, t) })}>{TYPE_LABEL[t]}</Toggle>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Confidence</legend>
            <div className="chips">
              {CONFIDENCES.map((c) => (
                <Toggle key={c} on={filters.confidences.includes(c)} title={CONFIDENCE_HINT[c]}
                  onChange={() => onFilters({ ...filters, confidences: toggle(filters.confidences, c) })}>{CONFIDENCE_LABEL[c]}</Toggle>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend title={PRIORITY_HINT}>City priority</legend>
            <div className="chips">
              {PRIORITIES.map((p) => (
                <Toggle key={p} on={filters.priorities.includes(p)}
                  onChange={() => onFilters({ ...filters, priorities: toggle(filters.priorities, p) })}>{PRIORITY_LABEL[p]}</Toggle>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Reported</legend>
            <div className="chips">
              {DATES.map((d) => (
                <label key={d.value} className={`chip${filters.date === d.value ? ' on' : ''}`}>
                  <input type="radio" name="date" checked={filters.date === d.value}
                    onChange={() => onFilters({ ...filters, date: d.value })} />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="filter-panel-foot">
            <button type="button" className="btn-link" disabled={!count} onClick={() => { onFilters(NO_FILTERS); onClearChips(); }}>Clear all</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onToggle}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
});
