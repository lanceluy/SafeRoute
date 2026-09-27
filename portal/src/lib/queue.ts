import type { Hazard, HazardStatus, QueueQuery, QueueSort, QueueView } from '../api/types';
import { dateFrom, type Filters } from '../components/FilterBar';
import { barangayAt, cachedStreet, contains, type Barangay } from './geo';
import { TYPE_LABEL, shortId } from './hazards';

export interface QueueTab {
  key: string;
  label: string;
  view?: QueueView;
  statuses?: HazardStatus[];
  /** Explains the tab when it's empty. */
  empty: { title: string; body: string };
}

export const MAP_TABS: QueueTab[] = [
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
  { key: 'attention', label: 'Needs review', view: 'attention', empty: MAP_TABS[0].empty },
  { key: 'contested', label: 'Contested', view: 'contested', empty: MAP_TABS[2].empty },
  { key: 'unconfirmed', label: 'Unconfirmed', view: 'unconfirmed',
    empty: { title: 'No unconfirmed reports', body: 'Every active report has at least one community response.' } },
  { key: 'expiring', label: 'Expiring soon', view: 'expiring', empty: MAP_TABS[3].empty },
  { key: 'removed', label: 'Removed reports', view: 'removed',
    empty: { title: 'No removed reports', body: 'Reports removed as false, spam or invalid appear here.' } },
];

export function buildQuery(tab: QueueTab, filters: Filters, sort: QueueSort, barangays: Barangay[]): QueueQuery {
  const area = filters.area ? barangays.find((b) => b.name === filters.area) : undefined;
  return {
    view: tab.view,
    statuses: tab.statuses,
    types: filters.types,
    severities: filters.severities,
    confidences: filters.confidences,
    from: dateFrom(filters.date),
    bbox: area?.bbox,
    sort,
  };
}

/** Search and the exact barangay shape run in the browser (the server filters by its bounding box). */
export function refine(hazards: Hazard[], search: string, filters: Filters, barangays: Barangay[]) {
  const area = filters.area ? barangays.find((b) => b.name === filters.area) : undefined;
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return hazards.filter((h) => {
    if (area && !contains(area, h.latitude, h.longitude)) return false;
    if (!words.length) return true;
    const text = [
      TYPE_LABEL[h.type], h.description, cachedStreet(h.latitude, h.longitude),
      barangayAt(barangays, h.latitude, h.longitude)?.name, shortId(h.id),
    ].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
