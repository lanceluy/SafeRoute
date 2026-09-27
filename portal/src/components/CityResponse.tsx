import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { PRIORITIES, type Department, type Hazard, type MunicipalPriority } from '../api/types';
import { ago } from '../lib/format';
import { PRIORITY_HINT, PRIORITY_LABEL } from '../lib/hazards';
import { departmentName } from '../state/departments';
import { useToast } from '../state/toast';
import { InfoTip } from './Badges';

/** Department and city priority for one hazard. Commuters see the department in the app. */
export function CityResponse({ hazard, departments, onSaved }: {
  hazard: Hazard; departments: Department[]; onSaved: () => void;
}) {
  const toast = useToast();
  const [department, setDepartment] = useState(hazard.assignedDepartment ?? '');
  const [priority, setPriority] = useState<string>(hazard.municipalPriority ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = department !== (hazard.assignedDepartment ?? '') || priority !== (hazard.municipalPriority ?? '');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.setResponse(hazard.id, department || null, (priority || null) as MunicipalPriority | null, note.trim());
      const name = departmentName(departments, department || null);
      toast({ kind: 'success', message: name ? `Assigned to ${name}` : 'City response updated' });
      setNote('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="city-response">
      <div className="city-fields">
        <label className="field">
          <span>Department</span>
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Unassigned</option>
            {departments.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>City priority <InfoTip text={PRIORITY_HINT} /></span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Not set</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
      </div>
      {changed && (
        <>
          <label className="field">
            <span>Note (optional)</span>
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Crew scheduled for Monday" />
          </label>
          <div className="button-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save response'}</button>
            <button type="button" className="btn-link" onClick={() => {
              setDepartment(hazard.assignedDepartment ?? ''); setPriority(hazard.municipalPriority ?? ''); setNote('');
            }}>Cancel</button>
          </div>
        </>
      )}
      {!changed && hazard.assignedAt && (
        <p className="muted small">Assigned {ago(hazard.assignedAt)}. Commuters see the department on this hazard in the app.</p>
      )}
      {!changed && !hazard.assignedAt && <p className="muted small">Commuters see the department on this hazard in the app.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
