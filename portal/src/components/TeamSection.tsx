import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { StaffMember } from '../api/types';
import { ago, shortDate } from '../lib/format';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { Dialog } from './Dialog';

const ROLE_LABEL = { MUNICIPAL_OFFICIAL: 'Municipal official', MODERATOR: 'Moderator', USER: 'Commuter' } as const;

/**
 * More LGU accounts for Makati (Task 2, revision 5). Officials add colleagues here; nobody can
 * sign up as staff on their own, so every account with portal access was given it by someone.
 */
export function TeamSection() {
  const session = useSession();
  const toast = useToast();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const isOfficial = session?.role === 'MUNICIPAL_OFFICIAL';

  const load = useCallback(() => {
    api.staff().then(setStaff).catch((err) => setError(err instanceof ApiError ? err.message : 'Couldn’t load the team.'));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="card">
      <div className="card-head">
        <div className="freq-head">
          <h2>Team</h2>
          <span className="muted">Makati City staff who can sign in to the portal and review reports</span>
        </div>
        {isOfficial && <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Add staff account</button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!staff && !error && <div className="skeleton" style={{ height: 80 }} />}
      {staff && (
        <table className="team-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th>{isOfficial && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {staff.map((m) => {
              const you = m.email === session?.email;
              return (
                <tr key={m.id}>
                  <td><strong>{m.displayName}</strong>{you && <span className="info-pill team-you">You</span>}</td>
                  <td>{m.email}</td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td className="muted" title={shortDate(m.addedAt ?? m.createdAt)}>
                    {m.addedBy ? `By ${m.addedBy}, ${ago(m.addedAt)}` : `Set up ${ago(m.createdAt)}`}
                  </td>
                  {isOfficial && (
                    <td className="team-actions">
                      {!you && m.role === 'MUNICIPAL_OFFICIAL' && (
                        <button type="button" className="btn-link danger" onClick={() => setRemoving(m)}>Remove access</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!isOfficial && <p className="muted small account-note">Only municipal officials can add or remove staff accounts.</p>}
      {adding && <AddStaffDialog onClose={() => setAdding(false)} onAdded={(m) => {
        setAdding(false);
        toast({ kind: 'success', message: `${m.displayName} can now sign in to the portal` });
        load();
      }} />}
      {removing && (
        <Dialog title={`Remove ${removing.displayName}’s access?`} tone="danger" onClose={() => setRemoving(null)} footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setRemoving(null)}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={async () => {
            try {
              await api.revokeStaff(removing.id);
              toast({ kind: 'success', message: `Removed ${removing.displayName}’s portal access` });
              load();
            } catch (err) {
              toast({ kind: 'error', message: err instanceof ApiError ? err.message : 'Couldn’t remove access. Try again.' });
            }
            setRemoving(null);
          }}>Remove access</button>
        </>}>
          <p className="dialog-muted">
            {removing.email} becomes a normal SafeRoute account and can no longer review reports. Their past actions stay in the history.
          </p>
        </Dialog>
      )}
    </section>
  );
}

function AddStaffDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (m: StaffMember) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = name.trim() && /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= 8;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      onAdded(await api.createStaff(name.trim(), email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t create the account. Try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a staff account" onClose={onClose} footer={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={save}>Create account</button>
    </>}>
      <label className="field">
        <span>Full name</span>
        <input data-autofocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Juan dela Cruz" />
      </label>
      <label className="field">
        <span>Work email</span>
        <input type="email" maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@makati.gov.ph" />
      </label>
      <label className="field">
        <span>Temporary password</span>
        <input type="text" autoComplete="off" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      </label>
      <p className="field-hint">At least 8 characters. Give it to them in person or by phone, not by email.</p>
      <p className="dialog-muted">They’ll be a municipal official for Makati City and can review, assign and resolve reports.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
