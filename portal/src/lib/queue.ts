import type { Hazard, HazardStatus, QueueQuery, QueueSort, QueueView } from '../api/types';
import { dateFrom, type Filters } from '../components/FilterBar';
import { barangayAt, cachedStreet, contains, type Barangay } from './geo';
import { TYPE_LABEL, shortId } from './hazards';

export interface QueueTab {
  key: string;
  label: string;
  view?: QueueView;
  statuses?: HazardStatus[];
  /** The order the tab opens in; otherwise the current sort is kept. */
  sort?: QueueSort;
  /** Explains the tab when it's empty. */
  empty: { title: string; body: string };
}

/** First on both pages, so a report shows up the moment it arrives. */
const NEW_TAB: QueueTab = {
  key: 'new', label: 'New', view: 'recent', sort: 'newest',
  empty: { title: 'No new reports', body: 'Reports from the last 24 hours appear here as they arrive.' },
};

export const MAP_TABS: QueueTab[] = [
  NEW_TAB,
  { key: 'attention', label: 'Needs attention', view: 'attention',
    empty: { title: 'Nothing needs attention', body: 'No contested reports, unverified high-severity hazards, or reports waiting over a day.' } },
  { key: 'high', label: 'High severity', view: 'high',
    empty: { title: 'No high-severity hazards', body: 'There are no active high-severity hazards in the selected area.' } },
  { key: 'contested', label: 'Contested', view: 'contested',
    empty: { title: 'No contested reports', body: 'The community agrees on every active report.' } },
  { key: 'expiring', label: 'Expiring soon', view: 'expiring',
    empty: { title: 'Nothing expiring soon', body: 'Every active hazard was confirmed recently.' } },
  { key: 'active', label: 'All active', view: 'active',
    empty: { title: 'No active hazards', body: 'Nothing is reported in the selected area right now.' } },
  { key: 'closed', label: 'Closed', statuses: ['RESOLVED', 'EXPIRED', 'REMOVED'],
    empty: { title: 'No closed hazards', body: 'Resolved, expired and removed reports appear here.' } },
];

export const MODERATION_TABS: QueueTab[] = [
  NEW_TAB,
  { key: 'attention', label: 'Needs review', view: 'attention', empty: MAP_TABS[1].empty },
  { key: 'contested', label: 'Contested', view: 'contested', empty: MAP_TABS[3].empty },
  { key: 'unconfirmed', label: 'Unconfirmed', view: 'unconfirmed',
    empty: { title: 'No unconfirmed reports', body: 'Every active report has at least one community response.' } },
  { key: 'expiring', label: 'Expiring soon', view: 'expiring', empty: MAP_TABS[4].empty },
  { key: 'unassigned', label: 'Unassigned', view: 'unassigned',
    empty: { title: 'Everything is assigned', body: 'Every active hazard has a department handling it.' } },
  { key: 'removed', label: 'Removed reports', view: 'removed',
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
