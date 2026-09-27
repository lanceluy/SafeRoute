import type { QueueSort } from '../api/types';
import { NO_FILTERS, type Filters } from '../components/FilterBar';

/** What a saved view stores: the queue setup on one page. */
export interface ViewConfig {
  page: 'map' | 'moderation';
  tab: string;
  filters: Filters;
  sort: QueueSort;
  search: string;
}

export function parseViewConfig(raw: string): ViewConfig | null {
  try {
    const v = JSON.parse(raw) as Partial<ViewConfig>;
    if (v.page !== 'map' && v.page !== 'moderation') return null;
    return {
      page: v.page, tab: v.tab ?? '', sort: v.sort ?? 'review', search: v.search ?? '',
      filters: { ...NO_FILTERS, ...(v.filters ?? {}) },
    };
  } catch {
    return null;
  }
}
