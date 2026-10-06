import { useState } from 'react';
import { Construction } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { ClosureCategory } from '../api/types';
import { useToast } from '../state/toast';
import { Dialog } from './Dialog';

export const CLOSURE_LABEL: Record<ClosureCategory, string> = {
  CONSTRUCTION: 'Construction', FLOODING: 'Flooding', EVENT: 'Event', OTHER: 'Other',
};

/** Name the road, say why it is closed, and optionally when it reopens. */
export function ClosureDialog({ points, onClose, onDone }: {
  points: [number, number][]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ClosureCategory>('CONSTRUCTION');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Compared when the time is picked, not on every render.
  const [endsInPast, setEndsInPast] = useState(false);
  const ready = !!name.trim() && !!reason.trim() && !endsInPast;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.createClosure({
        name: name.trim(), reason: reason.trim(), category, coordinates: points,
        endsAt: until ? new Date(until).toISOString() : null,
      });
      toast({ kind: 'success', message: `${name.trim()} is now closed to routing` });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Block this road?" tone="danger" icon={<Construction size={18} />} onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-danger" disabled={!ready || busy} onClick={submit}>
        {busy ? 'Blocking…' : 'Block road'}
      </button>
    </>}>
      <p className="dialog-lead">
        The drawn road appears on commuters’ maps and the app’s walking routes will avoid it until it is lifted.
      </p>
      <label className="field">
        <span>Road or path <span className="required">*</span></span>
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus
          placeholder="e.g. Pasong Tamo Ext., near Gil Puyat" />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as ClosureCategory)}>
          {Object.entries(CLOSURE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Reason <span className="required">*</span></span>
        <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Road widening; sidewalk fenced off" />
      </label>
      <label className="field">
        <span>Reopens (optional)</span>
        <input type="datetime-local" value={until} onChange={(e) => { setUntil(e.target.value); setEndsInPast(!!e.target.value && new Date(e.target.value).getTime() <= Date.now()); }} />
      </label>
      {endsInPast && <p className="field-hint">Pick a time in the future, or leave it blank to lift it by hand.</p>}
      <p className="dialog-muted">Recorded in the audit log with your name. {points.length} points drawn.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}

/** Confirm lifting a closure, with an optional note. */
export function LiftClosureDialog({ id, name, onClose, onDone }: {
  id: string; name: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.liftClosure(id, note.trim());
      toast({ kind: 'success', message: `${name} reopened` });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Reopen this road?" icon={<Construction size={18} />} onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Reopening…' : 'Reopen road'}</button>
    </>}>
      <p className="dialog-lead"><strong>{name}</strong> will disappear from commuters’ maps and routes may use it again.</p>
      <label className="field">
        <span>Note (optional)</span>
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus
          placeholder="e.g. Works finished" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
