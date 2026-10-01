import type { Department, Hazard, Stats } from '../api/types';
import type { Barangay } from '../lib/geo';
import type { ViewConfig } from '../lib/views';
import { useExport } from './ExportMenu';
import { Menu } from './Menu';
import { useSavedViews } from './SavedViews';

/**
 * The queue's one "•••" menu: saved views, export and bulk select. They are less frequent than
 * search, sort and filters, so they share one quiet button instead of three. Export is on the
 * Moderation page only: reports are a moderation task, the map is for looking.
 */
export function QueueMoreMenu({ page, current, onApply, hazards, title, filters, barangays, departments, stats, onSelectMode }: {
  page: ViewConfig['page']; current: () => ViewConfig; onApply: (v: ViewConfig) => void;
  hazards: Hazard[]; title: string; filters: string[]; barangays: Barangay[]; departments: Department[]; stats: Stats | null;
  onSelectMode: () => void;
}) {
  const views = useSavedViews({ page, current, onApply });
  const exporting = useExport({ hazards, title, filters, barangays, departments, stats });
  const canExport = page === 'moderation';
  return (
    <>
      <Menu label={canExport ? 'More actions: views, export and select' : 'More actions: views and select'} align="right"
        trigger={<span className="btn btn-secondary btn-sm toolbar-more"><span aria-hidden="true">•••</span></span>}
        items={[
          { heading: 'Select' },
          { label: 'Select several…', hint: canExport ? 'Resolve, assign or export many at once' : 'Resolve or assign many at once',
            disabled: !hazards.length, onSelect: onSelectMode },
          ...views.items,
          ...(canExport ? [{ heading: 'Export report' }, ...exporting.items] : []),
        ]} />
      {views.dialogs}
      {canExport && exporting.element}
    </>
  );
}
