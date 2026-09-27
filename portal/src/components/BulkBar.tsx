import { useState } from 'react';
import { api } from '../api/client';
import { PRIORITIES, type Department, type Hazard, type MunicipalPriority, type Stats } from '../api/types';
import { plural } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { PRIORITY_HINT, PRIORITY_LABEL, isActive } from '../lib/hazards';
import { useToast } from '../state/toast';
import { Dialog } from './Dialog';
import { ExportMenu } from './ExportMenu';

/** Runs `fn` over every item, a few at a time; returns how many failed. */
async function runAll<T>(items: T[], fn: (item: T) => Promise<unknown>, concurrency = 4) {
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return failed;
}

/**
 * Actions on the selected hazards. Deliberately no bulk Remove: removing is a judgement about
 * one report and penalises its reporter, so it stays one at a time.
 */
export function BulkBar({ selected, departments, barangays, stats, onClear, onDone }: {
  selected: Hazard[]; departments: Department[]; barangays: Barangay[]; stats: Stats | null;
  onClear: () => void; onDone: () => void;
}) {
  const [dialog, setDialog] = useState<'resolve' | 'response' | null>(null);
  const activeOnes = selected.filter((h) => isActive(h.status));

  return (
    <div className="bulk-bar" role="region" aria-label="Selected hazards">
      <strong>{plural(selected.length, 'selected', 'selected')}</strong>
      <button type="button" className="btn btn-primary btn-sm" disabled={!activeOnes.length} onClick={() => setDialog('resolve')}>
        ✓ Resolve
      </button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.length} onClick={() => setDialog('response')}>
        Assign / priority
      </button>
      <ExportMenu hazards={selected} title="Selected hazards" barangays={barangays} departments={departments} stats={stats} />
      <button type="button" className="btn-link" onClick={onClear}>Clear</button>
      {dialog === 'resolve' && (
        <BulkResolve hazards={activeOnes} skipped={selected.length - activeOnes.length}
          onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog === 'response' && (
        <BulkResponse hazards={selected} departments={departments} onClose={() => setDialog(null)} onDone={onDone} />
      )}
    </div>
  );
}

function BulkResolve({ hazards, skipped, onClose, onDone }: {
  hazards: Hazard[]; skipped: number; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const failed = await runAll(hazards, (h) => api.resolve(h.id, note.trim()));
    const done = hazards.length - failed;
    toast(failed
      ? { kind: 'error', message: `Resolved ${done} of ${hazards.length}. ${plural(failed, 'hazard')} couldn’t be resolved; try those again.` }
      : { kind: 'success', message: `${plural(done, 'hazard')} marked as resolved` });
    onDone();
    onClose();
  };
  return (
    <Dialog title={`Mark ${plural(hazards.length, 'hazard')} as resolved?`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
        {busy ? 'Resolving…' : `✓ Resolve ${hazards.length}`}
      </button>
    </>}>
      <p className="dialog-lead">They’ll no longer appear as active hazards to commuters. Use this when they’ve all been fixed or are gone.</p>
      {skipped > 0 && <p className="dialog-muted">{plural(skipped, 'selected hazard is', 'selected hazards are')} already closed and will be skipped.</p>}
      <label className="field">
        <span>Resolution note for all of them (optional)</span>
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus
          placeholder="e.g. Cleared during the Sept 27 road works" />
      </label>
      <p className="dialog-muted">Each one is recorded in the audit log with your name.</p>
    </Dialog>
  );
}

const KEEP = '__keep';

function BulkResponse({ hazards, departments, onClose, onDone }: {
  hazards: Hazard[]; departments: Department[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [department, setDepartment] = useState(KEEP);
  const [priority, setPriority] = useState(KEEP);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const unchanged = department === KEEP && priority === KEEP;
  const submit = async () => {
    setBusy(true);
    const failed = await runAll(hazards, (h) => api.setResponse(
      h.id,
      department === KEEP ? h.assignedDepartment : department || null,
      priority === KEEP ? h.municipalPriority : (priority || null) as MunicipalPriority | null,
      note.trim(),
    ));
    toast(failed
      ? { kind: 'error', message: `Updated ${hazards.length - failed} of ${hazards.length}. Try the rest again.` }
      : { kind: 'success', message: `Updated the city response for ${plural(hazards.length, 'hazard')}` });
    onDone();
    onClose();
  };
  return (
    <Dialog title={`City response for ${plural(hazards.length, 'hazard')}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy || unchanged} onClick={submit}>{busy ? 'Saving…' : 'Apply'}</button>
    </>}>
      <label className="field">
        <span>Department</span>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} data-autofocus>
          <option value={KEEP}>Keep as is</option>
          <option value="">Unassigned</option>
          {departments.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span title={PRIORITY_HINT}>City priority</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value={KEEP}>Keep as is</option>
          <option value="">Not set</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Note (optional)</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="dialog-muted">Commuters see the department on the hazard in the SafeRoute app.</p>
    </Dialog>
  );
}
