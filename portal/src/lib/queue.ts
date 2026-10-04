import type { Hazard, HazardStatus, QueueQuery, QueueSort, QueueView } from '../api/types';
import { dateFrom, dateTo, type Filters } from '../components/FilterBar';
import { barangayAt, cachedStreet, contains, type Barangay } from './geo';
import { CONFIDENCE_LABEL, PRIORITY_LABEL, SEVERITY_LABEL, TYPE_LABEL, isActive, shortId } from './hazards';

export interface QueueTab {
  key: string;
  label: string;
  view?: QueueView;
  statuses?: HazardStatus[];
  /** The order the tab opens in; otherwise the current sort is kept. */
  sort?: QueueSort;
  /** Closed hazards: the "Filter by" chips don't apply. */
  archive?: boolean;
  /** Explains the tab when it's empty. */
  empty: { title: string; body: string };
  /** Listed under "More" instead of as a tab. */
  more?: boolean;
  /** Leave out archived hazards (the working queue); they have their own tab. */
  hideArchived?: boolean;
  /** The tab's count when it isn't simply its view's count. */
  count?: (counts: Record<QueueView, number>) => number;
}

/**
 * A "Filter by" chip: narrows whichever tab is open, in the browser. Several chips combine (and).
 * `count` in the tab bar is how many of the current tab's hazards match.
 */
export interface QueueChip {
  key: string;
  label: string;
  match: (h: Hazard, now: number) => boolean;
  empty: { title: string; body: string };
}

/** First on both pages, so a report shows up the moment it arrives. */
const NEW_TAB: QueueTab = {
  key: 'new', label: 'New', view: 'recent', sort: 'newest',
  empty: { title: 'No new reports', body: 'Reports from the last 24 hours appear here as they arrive.' },
};
const ACTIVE_TAB: QueueTab = {
  key: 'active', label: 'All active', view: 'active',
  empty: { title: 'No active hazards', body: 'Nothing is reported in the selected area right now.' },
};
const ATTENTION_EMPTY = { title: 'Nothing needs attention', body: 'No contested reports, unverified high-severity hazards, or reports waiting over a day.' };

/** Primary tabs: where am I? Moderation adds Duplicates and Archived (Task 2 revisions). */
export const MAP_TABS: QueueTab[] = [
  ACTIVE_TAB, // first, so it's the tab the map opens on
  NEW_TAB,
  { key: 'attention', label: 'Needs attention', view: 'attention', empty: ATTENTION_EMPTY },
  { key: 'closed', label: 'Closed', statuses: ['RESOLVED', 'EXPIRED', 'REMOVED'], archive: true,
    empty: { title: 'No closed hazards', body: 'Resolved, expired and removed reports appear here.' } },
];

/**
 * Moderation keeps three tabs in view (the working queue, what needs a decision, what slipped);
 * the rarer destinations sit under More. Active here is the working queue: archived reports
 * (no staff action in 7 days) leave it for Archived, and All open shows both.
 */
export const MODERATION_TABS: QueueTab[] = [
  { ...ACTIVE_TAB, label: 'Active', hideArchived: true, count: (c) => Math.max(0, c.active - c.archived),
    empty: { title: 'The queue is clear', body: 'Every open report has been handled or archived.' } },
  { key: 'attention', label: 'Needs review', view: 'attention', empty: ATTENTION_EMPTY },
  { key: 'archived', label: 'Archived', view: 'archived', sort: 'oldest',
    empty: { title: 'Nothing archived', body: 'Reports nobody on staff acts on within 7 days move here. They stay on the commuter map until resolved or expired.' } },
  { ...NEW_TAB, more: true },
  { key: 'open', label: 'All open', view: 'active', more: true,
    empty: { title: 'No open reports', body: 'Nothing is reported in the selected area right now.' } },
  { key: 'duplicates', label: 'Duplicates', view: 'duplicates', sort: 'updated', more: true,
    empty: { title: 'No collated reports', body: 'When two people report the same hazard, the reports are combined into one and listed here.' } },
  { key: 'removed', label: 'Removed', view: 'removed', archive: true, more: true,
    empty: { title: 'No removed reports', body: 'Reports removed as false, spam or invalid appear here.' } },
];

/** Mirrors ExpiryPolicy.java's default time to live per type (hours). */
const TTL_HOURS: Record<Hazard['type'], number> = {
  FLOODING: 12, PATH_OBSTRUCTION: 24, CONSTRUCTION: 72, OPEN_MANHOLE: 168, POOR_LIGHTING: 720, BROKEN_SIDEWALK: 1080, ACCESSIBILITY_BARRIER: 2160,
  VEHICLE_BLOCKING_SIDEWALK: 6, TRAFFIC_SIGNAL_OUTAGE: 12, ROAD_DEBRIS: 12, SAFETY_CONCERN: 12, FALLEN_TREE: 48, CROSSWALK_ISSUE: 720,
};

/** In the last fifth of its time to live, like ExpiryPolicy.isExpiringSoon. */
export function isExpiringSoon(h: Hazard, now = Date.now()) {
  if (!isActive(h.status) || !h.expiresAt) return false;
  const remaining = Date.parse(h.expiresAt) - now;
  return remaining >= 0 && remaining <= (TTL_HOURS[h.type] * 3_600_000) / 5;
}

const CHIP_HIGH: QueueChip = { key: 'high', label: 'High severity', match: (h) => h.severity === 'HIGH',
  empty: { title: 'No high-severity hazards here', body: 'None of the hazards in this tab are high severity.' } };
const CHIP_CONTESTED: QueueChip = { key: 'contested', label: 'Contested', match: (h) => h.status === 'DISPUTED',
  empty: { title: 'No contested reports here', body: 'The community agrees on every report in this tab.' } };
const CHIP_EXPIRING: QueueChip = { key: 'expiring', label: 'Expiring soon', match: (h, now) => isExpiringSoon(h, now),
  empty: { title: 'Nothing expiring soon here', body: 'Every hazard in this tab was confirmed recently.' } };
const CHIP_UNCONFIRMED: QueueChip = { key: 'unconfirmed', label: 'Unconfirmed', match: (h) => h.confidence === 'UNCONFIRMED',
  empty: { title: 'No unconfirmed reports here', body: 'Every report in this tab has at least one community response.' } };
const CHIP_UNASSIGNED: QueueChip = { key: 'unassigned', label: 'Unassigned', match: (h) => isActive(h.status) && !h.assignedDepartment,
  empty: { title: 'Everything here is assigned', body: 'Every hazard in this tab has a department handling it.' } };

/** Secondary "Filter by" chips: how do I narrow this down? */
export const MAP_CHIPS: QueueChip[] = [CHIP_HIGH, CHIP_CONTESTED, CHIP_EXPIRING];
export const MODERATION_CHIPS: QueueChip[] = [CHIP_CONTESTED, CHIP_UNCONFIRMED, CHIP_EXPIRING, CHIP_UNASSIGNED];

/**
 * A tab key from a link or an older saved view. Keys that are now chips (tab=high, tab=contested…)
 * open All active with that chip on, so existing links keep working.
 */
/** A tab's count from the stats endpoint's queue counts. */
export function tabCount(t: QueueTab, counts: Record<QueueView, number> | undefined): number | undefined {
  if (!counts) return undefined;
  if (t.count) return t.count(counts);
  return t.view ? counts[t.view] : undefined;
}

export function resolveTab(tabs: QueueTab[], chips: QueueChip[], key?: string): { tab: string; chips: string[] } {
  if (key && tabs.some((t) => t.key === key)) return { tab: key, chips: [] };
  if (key && chips.some((c) => c.key === key)) return { tab: ACTIVE_TAB.key, chips: [key] };
  return { tab: tabs[0].key, chips: [] };
}

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

/**
 * Why this hazard is in the selected queue, in a few words: from the tab (Needs review) or, when
 * chips narrow the list, the first chip's reason; null where the tab says it all.
 */
export function queueReason(tabKey: string, chipKeys: string[], h: Hazard, now = Date.now()): string | null {
  const key = tabKey === 'attention' ? tabKey : chipKeys[0] ?? tabKey;
  const days = ageDays(h, now);
  switch (key) {
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
    case 'duplicates':
      return `${h.mergedReportCount + 1} people reported this · combined into one report`;
    case 'archived':
      return h.archivedAt ? `No staff review in ${Math.floor(days)} days · archived ${new Date(h.archivedAt).toLocaleDateString()}` : null;
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
