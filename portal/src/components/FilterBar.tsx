import { forwardRef } from 'react';
import {
  CONFIDENCES, HAZARD_TYPES, PRIORITIES, SEVERITIES, UNASSIGNED, type Confidence, type Department, type HazardType,
  type MunicipalPriority, type QueueSort, type Severity,
} from '../api/types';
import type { Barangay } from '../lib/geo';
import { CONFIDENCE_HINT, CONFIDENCE_LABEL, PRIORITY_HINT, PRIORITY_LABEL, SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { filterChips, type QueueChip } from '../lib/queue';
import { Chevron } from './Chevron';
import { Menu, type MenuHeading, type MenuItem } from './Menu';

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

/** Chips with their own dropdown elsewhere (Severity, Assignment) stay out of the Status menu. */
const NOT_STATUS = new Set(['high', 'unassigned']);

/** A dropdown filter button: "Severity", or "Severity · 2" while it narrows the list. */
function Dropdown({ label, count, items, wide }: { label: string; count: number; items: (MenuItem | MenuHeading | null)[]; wide?: boolean }) {
  return (
    <Menu label={`Filter by ${label.toLowerCase()}`} align="left"
      trigger={<span className={`filter-drop${count ? ' on' : ''}${wide ? ' wide' : ''}`}>{label}{count ? <span className="filter-drop-count">{count}</span> : null}<Chevron /></span>}
      items={items} />
  );
}

/**
 * Search, then one row of dropdown filters (Severity, Status, Barangay, Assignment, More), then the
 * active filters as removable pills. Status toggles the page's queue chips (client-side); the
 * others set server-side query filters.
 */
export const FilterBar = forwardRef<HTMLInputElement, {
  search: string; onSearch: (s: string) => void;
  filters: Filters; onFilters: (f: Filters) => void;
  barangays: Barangay[];
  departments: Department[];
  chipDefs: QueueChip[]; chips: string[]; onToggleChip: (key: string) => void; onClearChips: () => void;
  /** Hidden for closed tabs, where queue chips don't apply. */
  showStatus: boolean;
  open: boolean; onToggle: () => void;
  /** The ••• menu, pushed to the right of the filter row. */
  extra?: React.ReactNode;
}>(function FilterBar({
  search, onSearch, filters, onFilters, barangays, departments, chipDefs, chips: activeChips, onToggleChip, onClearChips, showStatus, open, onToggle, extra,
}, searchRef) {
  const deptName = (code: string) => (code === UNASSIGNED ? 'Unassigned' : departments.find((d) => d.code === code)?.name ?? code);
  const filterPills = filterChips(filters, deptName);
  const statusChips = chipDefs.filter((c) => activeChips.includes(c.key));
  const more = filters.types.length + filters.confidences.length + filters.priorities.length + (filters.date !== 'any' ? 1 : 0);
  const statusDefs = chipDefs.filter((c) => !NOT_STATUS.has(c.key));
  const anyActive = filterPills.length + statusChips.length > 0;

  return (
    <div className="filter-bar">
      <label className="search">
        <span className="sr-only">Search hazards</span>
        <Search aria-hidden="true" className="search-icon" size={16} />
        <input ref={searchRef} type="search" placeholder="Search hazards, streets, barangays or report IDs…"
          title="Search by hazard type, description, street, barangay or reference" value={search}
          onChange={(e) => onSearch(e.target.value)} />
        <kbd aria-hidden="true">/</kbd>
      </label>

      <div className="filter-row" role="toolbar" aria-label="Filters">
        <Dropdown label="Severity" count={filters.severities.length} items={SEVERITIES.map((s) => ({
          label: SEVERITY_LABEL[s], checked: filters.severities.includes(s),
          icon: <span className={`sev-dot sev-bg-${s.toLowerCase()}`} aria-hidden="true" />,
          onSelect: () => onFilters({ ...filters, severities: toggle(filters.severities, s) }),
        }))} />
        {showStatus && statusDefs.length > 0 && (
          <Dropdown label="Status" count={statusChips.filter((c) => !NOT_STATUS.has(c.key)).length} items={statusDefs.map((c) => ({
            label: c.label, checked: activeChips.includes(c.key), onSelect: () => onToggleChip(c.key),
          }))} />
        )}
        <Dropdown label={filters.area || 'Barangay'} count={filters.area ? 1 : 0} wide items={[
          { label: 'All of Makati', checked: !filters.area, radio: true, onSelect: () => onFilters({ ...filters, area: '' }) },
          ...barangays.map((b) => ({ label: b.name, checked: filters.area === b.name, radio: true, onSelect: () => onFilters({ ...filters, area: b.name }) })),
        ]} />
        <Dropdown label="Assignment" count={filters.departments.length} items={[
          ...[{ code: UNASSIGNED, name: 'Unassigned' }, ...departments].map((d) => ({
            label: d.name, checked: filters.departments.includes(d.code),
            onSelect: () => onFilters({ ...filters, departments: toggle(filters.departments, d.code) }),
          })),
        ]} />
        <button type="button" className={`filter-drop${more ? ' on' : ''}`} aria-expanded={open} onClick={onToggle}>
          <SlidersHorizontal size={15} aria-hidden="true" />More filters{more ? <span className="filter-drop-count">{more}</span> : null}
        </button>
        {extra && <span className="toolbar-end">{extra}</span>}
      </div>

      {anyActive && (
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
