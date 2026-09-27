import { logout } from '../api/client';
import { useThemeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme';
import { setHighSeverityNotices, useHighSeverityNotices } from '../lib/prefs';
import { useSession } from '../state/session';

const ROLE_LABEL = { MUNICIPAL_OFFICIAL: 'Municipal official', MODERATOR: 'Moderator', USER: 'Commuter' } as const;
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
];
const SHORTCUTS: [string, string][] = [
  ['/', 'Search the hazard queue'], ['F', 'Show or hide filters'], ['M', 'Go to the map'],
  ['Enter', 'Open the focused hazard'], ['Esc', 'Close a drawer, dialog or menu'],
];

export function AccountPage() {
  const session = useSession();
  const theme = useThemeChoice();
  const notices = useHighSeverityNotices();
  if (!session) return null;
  const initials = (session.displayName || session.email).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="page account-page">
      <div className="page-head"><div><h1>Account</h1><p className="muted">Your details and how the portal behaves in this browser.</p></div></div>

      <section className="card account-card">
        <span className="avatar lg" aria-hidden="true">{initials}</span>
        <div>
          <h2>{session.displayName}</h2>
          <p>{session.email}</p>
          <p className="muted">{ROLE_LABEL[session.role]} · Makati City</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={logout}>Sign out</button>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Appearance</h2></div>
          <div className="segmented" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.value} type="button" aria-pressed={theme === t.value} onClick={() => setThemeChoice(t.value)}>{t.label}</button>
            ))}
          </div>
          <p className="muted small account-note">Dark mode also dims the map. Printed reports are always light.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Notices</h2></div>
          <label className="switch-row">
            <input type="checkbox" checked={notices} onChange={(e) => setHighSeverityNotices(e.target.checked)} />
            <span>
              <strong>New high-severity reports</strong>
              <span className="muted small">A quiet notice with a link, while the portal is open. Several at once are grouped.</span>
            </span>
          </label>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Keyboard shortcuts</h2><span className="muted">Anywhere except while typing</span></div>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
