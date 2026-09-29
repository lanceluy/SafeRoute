import type { Hazard, HazardStatus, QueueQuery, QueueSort, QueueView } from '../api/types';
import { dateFrom, dateTo, type Filters } from '../components/FilterBar';
import { barangayAt, cachedStreet, contains, type Barangay } from './geo';
import { CONFIDENCE_LABEL, PRIORITY_LABEL, SEVERITY_LABEL, TYPE_LABEL, isActive, shortId } from './hazards';

/** What a tab is for; tabs are drawn in these groups, with a divider between groups. */
export type TabGroup = 'inbox' | 'risk' | 'workflow' | 'archive';
export const TAB_GROUP_LABEL: Record<TabGroup, string> = { inbox: 'Inbox', risk: 'Risk', workflow: 'Workflow', archive: 'Archive' };

export interface QueueTab {
  key: string;
  label: string;
  group: TabGroup;
  view?: QueueView;
  statuses?: HazardStatus[];
  /** The order the tab opens in; otherwise the current sort is kept. */
  sort?: QueueSort;
  /** Explains the tab when it's empty. */
  empty: { title: string; body: string };
}

/** First on both pages, so a report shows up the moment it arrives. */
const NEW_TAB: QueueTab = {
  key: 'new', label: 'New', group: 'inbox', view: 'recent', sort: 'newest',
  empty: { title: 'No new reports', body: 'Reports from the last 24 hours appear here as they arrive.' },
};

export const MAP_TABS: QueueTab[] = [
  NEW_TAB,
  { key: 'attention', label: 'Needs attention', group: 'inbox', view: 'attention',
    empty: { title: 'Nothing needs attention', body: 'No contested reports, unverified high-severity hazards, or reports waiting over a day.' } },
  { key: 'high', label: 'High severity', group: 'risk', view: 'high',
    empty: { title: 'No high-severity hazards', body: 'There are no active high-severity hazards in the selected area.' } },
  { key: 'contested', label: 'Contested', group: 'risk', view: 'contested',
    empty: { title: 'No contested reports', body: 'The community agrees on every active report.' } },
  { key: 'expiring', label: 'Expiring soon', group: 'risk', view: 'expiring',
    empty: { title: 'Nothing expiring soon', body: 'Every active hazard was confirmed recently.' } },
  { key: 'active', label: 'All active', group: 'workflow', view: 'active',
    empty: { title: 'No active hazards', body: 'Nothing is reported in the selected area right now.' } },
  { key: 'closed', label: 'Closed', group: 'archive', statuses: ['RESOLVED', 'EXPIRED', 'REMOVED'],
    empty: { title: 'No closed hazards', body: 'Resolved, expired and removed reports appear here.' } },
];

export const MODERATION_TABS: QueueTab[] = [
  NEW_TAB,
  { key: 'attention', label: 'Needs review', group: 'inbox', view: 'attention', empty: MAP_TABS[1].empty },
  { key: 'contested', label: 'Contested', group: 'risk', view: 'contested', empty: MAP_TABS[3].empty },
  { key: 'unconfirmed', label: 'Unconfirmed', group: 'risk', view: 'unconfirmed',
    empty: { title: 'No unconfirmed reports', body: 'Every active report has at least one community response.' } },
  { key: 'expiring', label: 'Expiring soon', group: 'risk', view: 'expiring', empty: MAP_TABS[4].empty },
  { key: 'unassigned', label: 'Unassigned', group: 'workflow', view: 'unassigned',
    empty: { title: 'Everything is assigned', body: 'Every active hazard has a department handling it.' } },
  { key: 'removed', label: 'Removed reports', group: 'archive', view: 'removed',
    empty: { title: 'No removed reports', body: 'Reports removed as false, spam or invalid appear here.' } },
];

export function buildQuery(tab: QueueTab, filters: Filters, sort: QueueSort, barangays: Barangay[]): QueueQuery {
  const area = filters.area ? barangays.find((b) => b.name === filters.area) : undefined;
  return {
    departments: filters.departments,
    priorities: filters.priorities,
    view: tab.view,
    statuses: tab.statuses,
    types: filters.types,
    severities: filters.severities,
    confidences: filters.confidences,
    from: dateFrom(filters.date),
    to: dateTo(filters.date),
    // A drawn region is usually the tighter box; the exact barangay shape is checked in refine().
    bbox: filters.region ?? area?.bbox,
    sort,
  };
}

/** Search and the exact barangay shape run in the browser (the server filters by its bounding box). */
export function refine(hazards: Hazard[], search: string, filters: Filters, barangays: Barangay[]) {
  const area = filters.area ? barangays.find((b) => b.name === filters.area) : undefined;
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const r = filters.region;
  return hazards.filter((h) => {
    if (area && !contains(area, h.latitude, h.longitude)) return false;
    if (r && (h.latitude < r[0] || h.latitude > r[2] || h.longitude < r[1] || h.longitude > r[3])) return false;
    if (!words.length) return true;
    const text = [
      TYPE_LABEL[h.type], h.description, cachedStreet(h.latitude, h.longitude),
      barangayAt(barangays, h.latitude, h.longitude)?.name, shortId(h.id),
    ].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// ------------------------------------------------------------------ reading a row

const DAY = 86_400_000;
/** From this age an active hazard's age is shown as a warning. */
export const STALE_DAYS = 7;

export function ageDays(h: Hazard, now = Date.now()) {
  return (now - Date.parse(h.createdAt)) / DAY;
}

export function isStale(h: Hazard, now = Date.now()) {
  return isActive(h.status) && ageDays(h, now) >= STALE_DAYS;
}

/** "3h", "2d": the Age column. */
export function shortAge(h: Hazard, now = Date.now()) {
  const hours = (now - Date.parse(h.createdAt)) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Needs action now, beyond what severity alone says: the city marked it Urgent, or it is a
 * verified high-severity hazard nobody has picked up in three days. Shown as the row's left rail.
 */
export function needsAction(h: Hazard, now = Date.now()): string | null {
  if (!isActive(h.status)) return null;
  if (h.municipalPriority === 'URGENT') return 'The city marked it urgent';
  if (h.severity === 'HIGH' && h.status === 'VERIFIED' && !h.assignedDepartment && ageDays(h, now) >= 3) {
    return 'Verified high severity, unassigned for 3+ days';
  }
  return null;
}

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

function inHours(iso: string, now: number) {
  const hours = (Date.parse(iso) - now) / 3_600_000;
  if (hours <= 0) return 'Expiring now';
  if (hours < 1) return `Expires in ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `Expires in ${plural(Math.round(hours), 'hour')}`;
  return `Expires in ${plural(Math.round(hours / 24), 'day')}`;
}

/** Why this hazard is in the selected queue, in a few words; null where the tab says it all. */
export function queueReason(tabKey: string, h: Hazard, now = Date.now()): string | null {
  const days = ageDays(h, now);
  switch (tabKey) {
    case 'attention':
      if (h.status === 'DISPUTED') return `Contested: ${plural(h.confirmationCount, 'confirmation')} vs ${plural(h.disputeCount, 'dispute')}`;
      if (h.status === 'REPORTED' && h.severity === 'HIGH') return 'High severity, not yet verified';
      return `No community response in ${plural(Math.floor(days), 'day')}`;
    case 'contested':
      return `${plural(h.confirmationCount, 'confirmation')} · ${plural(h.disputeCount, 'dispute')}`;
    case 'unconfirmed':
      return days >= 1 ? `No responses in ${plural(Math.floor(days), 'day')}` : 'No responses yet';
    case 'expiring':
      return h.expiresAt ? inHours(h.expiresAt, now) : null;
    case 'unassigned':
      return h.municipalPriority ? `No department yet · ${h.municipalPriority.toLowerCase()} city priority` : 'No department assigned yet';
    default:
      return null;
  }
}

// ------------------------------------------------------------------ filter chips

export interface FilterChip { key: string; label: string; remove: (f: Filters) => Filters }

const DATE_CHIP: Record<string, string> = { today: 'Reported today', '7d': 'Last 7 days', '30d': 'Last 30 days', older7: 'Older than 7 days' };

/** The active filters as removable chips, in the order the filter panel lists them. */
export function filterChips(f: Filters, departmentName: (code: string) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.region) chips.push({ key: 'region', label: 'Map area', remove: (x) => ({ ...x, region: null }) });
  if (f.area) chips.push({ key: 'area', label: f.area, remove: (x) => ({ ...x, area: '' }) });
  for (const s of f.severities) chips.push({ key: `sev-${s}`, label: `${SEVERITY_LABEL[s]} severity`, remove: (x) => ({ ...x, severities: x.severities.filter((v) => v !== s) }) });
  for (const t of f.types) chips.push({ key: `type-${t}`, label: TYPE_LABEL[t], remove: (x) => ({ ...x, types: x.types.filter((v) => v !== t) }) });
  for (const c of f.confidences) chips.push({ key: `conf-${c}`, label: c === 'CONTESTED' || c === 'UNCONFIRMED' ? CONFIDENCE_LABEL[c] : `${CONFIDENCE_LABEL[c]} confidence`, remove: (x) => ({ ...x, confidences: x.confidences.filter((v) => v !== c) }) });
  for (const d of f.departments) chips.push({ key: `dept-${d}`, label: departmentName(d), remove: (x) => ({ ...x, departments: x.departments.filter((v) => v !== d) }) });
  for (const p of f.priorities) chips.push({ key: `prio-${p}`, label: `${PRIORITY_LABEL[p]} city priority`, remove: (x) => ({ ...x, priorities: x.priorities.filter((v) => v !== p) }) });
  if (f.date !== 'any') chips.push({ key: 'date', label: DATE_CHIP[f.date], remove: (x) => ({ ...x, date: 'any' }) });
  return chips;
}
