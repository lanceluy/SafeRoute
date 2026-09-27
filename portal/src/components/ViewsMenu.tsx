import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { SavedView } from '../api/types';
import { parseViewConfig, type ViewConfig } from '../lib/views';
import { useToast } from '../state/toast';
import { Dialog } from './Dialog';
import { Menu } from './Menu';

/** Named queue setups for this official, kept on the server so they follow them anywhere. */
export function ViewsMenu({ page, current, onApply }: {
  page: ViewConfig['page']; current: () => ViewConfig; onApply: (v: ViewConfig) => void;
}) {
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

  return (
    <>
      <Menu label="Saved views" align="left" trigger={<span className="btn btn-secondary btn-sm">Views ▾</span>}
        items={[
          ...mine.map((v) => ({ label: v.name, hint: 'Apply', onSelect: () => { const c = parseViewConfig(v.config); if (c) onApply(c); } })),
          { label: 'Save current view…', hint: 'Tab, filters, sort and search', onSelect: () => setNaming(true) },
          mine.length ? { label: 'Delete a view…', hint: `${mine.length} saved`, danger: true, onSelect: () => setConfirmDelete(mine[0]) } : null,
        ]}
        footer={!mine.length ? <p className="menu-empty">No saved views on this page yet.</p> : null} />
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
  );
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
