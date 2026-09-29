import { forwardRef } from 'react';
import {
  CONFIDENCES, HAZARD_TYPES, PRIORITIES, SEVERITIES, UNASSIGNED, type Confidence, type Department, type HazardType,
  type MunicipalPriority, type QueueSort, type Severity,
} from '../api/types';
import type { Barangay } from '../lib/geo';
import { CONFIDENCE_HINT, CONFIDENCE_LABEL, PRIORITY_HINT, PRIORITY_LABEL, SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { filterChips } from '../lib/queue';
import { Chevron } from './Chevron';

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

/** Search, sort and a collapsible set of filters above a hazard list. */
export const FilterBar = forwardRef<HTMLInputElement, {
  search: string; onSearch: (s: string) => void;
  sort: QueueSort; onSort: (s: QueueSort) => void;
  filters: Filters; onFilters: (f: Filters) => void;
  barangays: Barangay[];
  departments: Department[];
  open: boolean; onToggle: () => void;
  /** The ••• menu, pushed to the right of the toolbar. */
  extra?: React.ReactNode;
}>(function FilterBar({ search, onSearch, sort, onSort, filters, onFilters, barangays, departments, open, onToggle, extra }, searchRef) {
  const count = activeFilterCount(filters);
  const chips = filterChips(filters, (code) => (code === UNASSIGNED ? 'Unassigned' : departments.find((d) => d.code === code)?.name ?? code));
  return (
    <div className="filter-bar">
      {/* Search on its own row; then Sort and Filters on the left, the ••• menu on the right. */}
      <label className="search">
        <span className="sr-only">Search hazards</span>
        <span aria-hidden="true" className="search-icon">⌕</span>
        <input ref={searchRef} type="search" placeholder="Search hazards"
          title="Search by hazard type, description, street or barangay" value={search}
          onChange={(e) => onSearch(e.target.value)} />
        <kbd aria-hidden="true">/</kbd>
      </label>
      <div className="toolbar" role="toolbar" aria-label="Sort, filter and more">
        <label className="select-inline toolbar-sort">
          <span className="sr-only">Sort</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as QueueSort)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" className={`btn btn-secondary btn-sm${count ? ' has-count' : ''}`} aria-expanded={open} onClick={onToggle}>
          Filters{count ? ` · ${count}` : ''}<Chevron up={open} />
        </button>
        {extra && <span className="toolbar-end">{extra}</span>}
      </div>
      {chips.length > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.key} type="button" className="filter-chip" onClick={() => onFilters(c.remove(filters))} aria-label={`Remove filter: ${c.label}`}>
              {c.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="btn-link" onClick={() => onFilters(NO_FILTERS)}>Clear all</button>
        </div>
      )}
      {open && (
        <div className="filter-panel">
          <fieldset>
            <legend>Area</legend>
            <select value={filters.area} onChange={(e) => onFilters({ ...filters, area: e.target.value })} aria-label="Barangay">
              <option value="">All of Makati</option>
              {barangays.map((b) => <option key={b.name} value={b.name}>Barangay {b.name}</option>)}
            </select>
          </fieldset>
          <fieldset>
            <legend>Severity</legend>
            <div className="chips">
              {SEVERITIES.map((s) => (
                <label key={s} className={`chip${filters.severities.includes(s) ? ' on' : ''}`}>
                  <input type="checkbox" checked={filters.severities.includes(s)}
                    onChange={() => onFilters({ ...filters, severities: toggle(filters.severities, s) })} />
                  <span className={`sev-dot sev-bg-${s.toLowerCase()}`} aria-hidden="true" />{SEVERITY_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Type</legend>
            <div className="chips">
              {HAZARD_TYPES.map((t) => (
                <label key={t} className={`chip${filters.types.includes(t) ? ' on' : ''}`}>
                  <input type="checkbox" checked={filters.types.includes(t)}
                    onChange={() => onFilters({ ...filters, types: toggle(filters.types, t) })} />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Confidence</legend>
            <div className="chips">
              {CONFIDENCES.map((c) => (
                <label key={c} className={`chip${filters.confidences.includes(c) ? ' on' : ''}`} title={CONFIDENCE_HINT[c]}>
                  <input type="checkbox" checked={filters.confidences.includes(c)}
                    onChange={() => onFilters({ ...filters, confidences: toggle(filters.confidences, c) })} />
                  {CONFIDENCE_LABEL[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Department</legend>
            <div className="chips">
              {[...departments, { code: UNASSIGNED, name: 'Unassigned' }].map((d) => (
                <label key={d.code} className={`chip${filters.departments.includes(d.code) ? ' on' : ''}`}>
                  <input type="checkbox" checked={filters.departments.includes(d.code)}
                    onChange={() => onFilters({ ...filters, departments: toggle(filters.departments, d.code) })} />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend title={PRIORITY_HINT}>City priority</legend>
            <div className="chips">
              {PRIORITIES.map((p) => (
                <label key={p} className={`chip${filters.priorities.includes(p) ? ' on' : ''}`}>
                  <input type="checkbox" checked={filters.priorities.includes(p)}
                    onChange={() => onFilters({ ...filters, priorities: toggle(filters.priorities, p) })} />
                  {PRIORITY_LABEL[p]}
                </label>
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
        </div>
      )}
    </div>
  );
});
