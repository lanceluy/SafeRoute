import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Hazard } from '../api/types';
import { REMOVAL_REASONS, TYPE_LABEL, shortId } from '../lib/hazards';
import { useToast } from '../state/toast';
import { Check, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog } from './Dialog';

export type HazardAction = 'resolve' | 'reopen' | 'remove';

/**
 * Resolve = the hazard is really gone. Remove = the report was never valid. They are worded,
 * colored and confirmed differently so one can't be mistaken for the other.
 */
export function ActionDialog({ action, hazard, onClose, onDone }: {
  action: HazardAction; hazard: Hazard; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = `${TYPE_LABEL[hazard.type]} ${shortId(hazard.id)}`;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (action === 'resolve') {
        await api.resolve(hazard.id, note.trim());
        toast({
          kind: 'success', message: `${name} marked as resolved`,
          action: { label: 'Undo', run: () => undoResolve(hazard.id, toast, onDone) },
        });
      } else if (action === 'reopen') {
        await api.reopen(hazard.id, note.trim());
        toast({ kind: 'success', message: `${name} reopened` });
      } else {
        const text = note.trim() ? `${reason}: ${note.trim()}` : reason;
        await api.remove(hazard.id, text);
        toast({ kind: 'success', message: `${name} removed` });
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (action === 'remove') {
    return (
      <Dialog title="Remove this report?" tone="danger" icon={<Trash2 size={18} />} onClose={onClose} footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={!reason || (reason === 'Other' && !note.trim()) || busy} onClick={submit}>
          {busy ? 'Removing…' : 'Remove report'}
        </button>
      </>}>
        <p className="dialog-lead">
          Use this only for <strong>false, spam, duplicate or inappropriate</strong> reports. If the hazard was real
          and has been fixed, mark it as resolved instead.
        </p>
        <p className="dialog-muted">
          {name} disappears for commuters, the reporter’s reputation goes down, and the removal is recorded in the
          audit log with your name.
        </p>
        <fieldset className="reason-group">
          <legend>Reason for removal <span className="required">*</span></legend>
          {REMOVAL_REASONS.map((r) => (
            <label key={r} className="radio">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Additional notes {reason === 'Other' ? <span className="required">*</span> : '(optional)'}</span>
          <textarea rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Same hazard as the report at the corner, submitted twice" />
        </label>
        {reason === 'Other' && !note.trim() && <p className="field-hint">Say what’s wrong with the report.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </Dialog>
    );
  }

  const resolving = action === 'resolve';
  return (
    <Dialog title={resolving ? 'Mark this hazard as resolved?' : 'Reopen this hazard?'}
      icon={resolving ? <Check size={18} /> : <RotateCcw size={18} />} onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
        {busy ? 'Saving…' : resolving ? 'Mark as resolved' : 'Reopen hazard'}
      </button>
    </>}>
      <p className="dialog-lead">
        {resolving
          ? <>{name} will no longer appear as an active hazard to commuters. Use this when the hazard has been fixed or is gone.</>
          : <>{name} will show on commuters’ maps again as a fresh report, and will need new confirmations.</>}
      </p>
      <label className="field">
        <span>{resolving ? 'Resolution note' : 'Note'} (optional)</span>
        {/* Focus the note, not the confirm button, so typing never confirms by accident. */}
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus
          placeholder={resolving ? 'e.g. Sidewalk repaired by the engineering team' : 'e.g. Crew reports it’s back'} />
      </label>
      <p className="dialog-muted">Recorded in the audit log with your name.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}

// Resolve is processed asynchronously: wait until it lands before reopening.
async function undoResolve(id: string, toast: ReturnType<typeof useToast>, onDone: () => void) {
  try {
    for (let i = 0; i < 10; i++) {
      const detail = await api.hazard(id);
      if (detail.hazard.status === 'RESOLVED') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await api.reopen(id, 'Undo: resolved by mistake');
    toast({ kind: 'info', message: 'Resolve undone. The hazard is active again.' });
    onDone();
  } catch (err) {
    toast({ kind: 'error', message: err instanceof ApiError ? err.message : 'Couldn’t undo. Reopen it from the hazard’s menu.' });
  }
}
