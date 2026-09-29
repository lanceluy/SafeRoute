import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { SavedView } from '../api/types';
import { parseViewConfig, type ViewConfig } from '../lib/views';
import { useToast } from '../state/toast';
import { Dialog } from './Dialog';
import { NO_FILTERS, type Filters } from './FilterBar';
import type { MenuHeading, MenuItem } from './Menu';

/** Ready-made setups for common workflows; they keep the current tab and replace filters and sort. */
const SUGGESTED: { name: string; hint: string; filters: Filters; sort: ViewConfig['sort'] }[] = [
  { name: 'High severity, well supported', hint: 'High severity with medium or high confidence',
    filters: { ...NO_FILTERS, severities: ['HIGH'], confidences: ['HIGH', 'MEDIUM'] }, sort: 'oldest' },
  { name: 'Older than 7 days', hint: 'Oldest first', filters: { ...NO_FILTERS, date: 'older7' }, sort: 'oldest' },
  { name: 'Accessibility issues', hint: 'Accessibility barriers', filters: { ...NO_FILTERS, types: ['ACCESSIBILITY_BARRIER'] }, sort: 'severity' },
  { name: 'Unassigned high severity', hint: 'No department yet', filters: { ...NO_FILTERS, severities: ['HIGH'], departments: ['UNASSIGNED'] }, sort: 'oldest' },
];

/**
 * Named queue setups for this official, kept on the server so they follow them anywhere, plus a few
 * suggested ones. Returns menu entries and the dialogs (naming, deleting) to render beside them.
 */
export function useSavedViews({ page, current, onApply }: {
  page: ViewConfig['page']; current: () => ViewConfig; onApply: (v: ViewConfig) => void;
}): { items: (MenuItem | MenuHeading)[]; dialogs: ReactNode } {
  const toast = useToast();
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SavedView | null>(null);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api.savedViews(controller.signal).then(setViews).catch(() => {});
    return () => controller.abort();
  }, [reloads]);

  const mine = views.filter((v) => parseViewConfig(v.config)?.page === page);

  return {
    items: [
      ...(mine.length ? [{ heading: 'Your views' }] : []),
      ...mine.map((v) => ({ label: v.name, hint: 'Apply', onSelect: () => { const c = parseViewConfig(v.config); if (c) onApply(c); } })),
      { heading: 'Suggested views' },
      ...SUGGESTED.map((s) => ({
        label: s.name, hint: s.hint,
        onSelect: () => onApply({ page, tab: current().tab, chips: current().chips, filters: s.filters, sort: s.sort, search: '' }),
      })),
      { label: 'Save current view…', hint: 'Tab, filters, sort and search', onSelect: () => setNaming(true) },
      ...(mine.length ? [{ label: 'Delete a view…', hint: `${mine.length} saved`, danger: true, onSelect: () => setConfirmDelete(mine[0]) }] : []),
    ],
    dialogs: (
      <>
        {naming && <NameDialog onClose={() => setNaming(false)} existing={mine.map((v) => v.name)} onSave={async (name) => {
          await api.saveView(name, JSON.stringify(current()));
          toast({ kind: 'success', message: `Saved view “${name}”` });
          reload();
        }} />}
        {confirmDelete && (
          <DeleteDialog views={mine} initial={confirmDelete} onClose={() => setConfirmDelete(null)} onDelete={async (v) => {
            await api.deleteView(v.id);
            toast({ kind: 'success', message: `Deleted view “${v.name}”` });
            reload();
          }} />
        )}
      </>
    ),
  };
}

function NameDialog({ onClose, onSave, existing }: { onClose: () => void; onSave: (name: string) => Promise<void>; existing: string[] }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const replaces = existing.some((e) => e.toLowerCase() === name.trim().toLowerCase());
  const save = async () => {
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save the view.');
      setBusy(false);
    }
  };
  return (
    <Dialog title="Save this view" onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={!name.trim() || busy} onClick={save}>{replaces ? 'Replace view' : 'Save view'}</button>
    </>}>
      <label className="field">
        <span>Name</span>
        <input data-autofocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Unresolved > 7 days" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }} />
      </label>
      {replaces && <p className="field-hint">A view with this name exists; saving replaces it.</p>}
      <p className="dialog-muted">Saves the current tab, filters, sort and search. Only you see your views.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}

function DeleteDialog({ views, initial, onClose, onDelete }: {
  views: SavedView[]; initial: SavedView; onClose: () => void; onDelete: (v: SavedView) => Promise<void>;
}) {
  const [id, setId] = useState(initial.id);
  const [busy, setBusy] = useState(false);
  const view = views.find((v) => v.id === id) ?? initial;
  return (
    <Dialog title="Delete a saved view" tone="danger" onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-danger" disabled={busy}
        onClick={async () => { setBusy(true); try { await onDelete(view); onClose(); } catch { setBusy(false); } }}>Delete view</button>
    </>}>
      <label className="field">
        <span>View</span>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <p className="dialog-muted">Only the saved setup is deleted; no hazards change.</p>
    </Dialog>
  );
}
