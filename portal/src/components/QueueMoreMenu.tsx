import type { Department, Hazard, Stats } from '../api/types';
import type { Barangay } from '../lib/geo';
import type { ViewConfig } from '../lib/views';
import { useExport } from './ExportMenu';
import { Menu } from './Menu';
import { useSavedViews } from './SavedViews';

/**
 * The queue's one "•••" menu: saved views, export and bulk select. They are less frequent than
 * search, sort and filters, so they share one quiet button instead of three.
 */
export function QueueMoreMenu({ page, current, onApply, hazards, title, barangays, departments, stats, onSelectMode }: {
  page: ViewConfig['page']; current: () => ViewConfig; onApply: (v: ViewConfig) => void;
  hazards: Hazard[]; title: string; barangays: Barangay[]; departments: Department[]; stats: Stats | null;
  onSelectMode: () => void;
}) {
  const views = useSavedViews({ page, current, onApply });
  const exporting = useExport({ hazards, title, barangays, departments, stats });
  return (
    <>
      <Menu label="More actions: views, export and select" align="right"
        trigger={<span className="btn btn-secondary btn-sm toolbar-more"><span aria-hidden="true">•••</span></span>}
        items={[
          { heading: 'Select' },
          { label: 'Select several…', hint: 'Resolve, assign or export many at once', disabled: !hazards.length, onSelect: onSelectMode },
          ...views.items,
          { heading: 'Export' },
          ...exporting.items,
        ]} />
      {views.dialogs}
      {exporting.element}
    </>
  );
}
