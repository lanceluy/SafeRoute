import { Bell, Keyboard, LogOut, Palette } from 'lucide-react';
import { logout } from '../api/client';
import { useThemeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme';
import { setHighSeverityNotices, useHighSeverityNotices } from '../lib/prefs';
import { SHORTCUTS } from '../lib/shortcutList';
import { useSession } from '../state/session';
import { TeamSection } from '../components/TeamSection';
import { Segmented } from '../components/Segmented';
import { Card, PageHeader } from '../components/ui';

const ROLE_LABEL = { MUNICIPAL_OFFICIAL: 'Municipal official', MODERATOR: 'Moderator', USER: 'Commuter' } as const;
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
];

/** The sidebar calls this page Settings; the route stays /account so existing links keep working. */
export function AccountPage() {
  const session = useSession();
  const theme = useThemeChoice();
  const notices = useHighSeverityNotices();
  if (!session) return null;
  const initials = (session.displayName || session.email).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="page account-page">
      <PageHeader title="Settings" subtitle="Your profile, your team, and how the portal behaves in this browser." />

      <section className="card account-card" aria-label="Your profile">
        <span className="avatar lg" aria-hidden="true">{initials}</span>
        <div>
          <h2>{session.displayName}</h2>
          <p>{session.email}</p>
          <p className="muted">{ROLE_LABEL[session.role]} · Makati City</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={logout}>
          <LogOut size={16} aria-hidden="true" />Sign out
        </button>
      </section>

      <div className="grid-2">
        <Card title={<span className="title-icon"><Palette aria-hidden="true" />Appearance</span>}
          subtitle="Saved in this browser only.">
          <Segmented label="Theme" options={THEMES} value={theme} onChange={setThemeChoice} />
          <p className="muted small account-note">Dark mode also dims the map. Printed reports are always light.</p>
        </Card>

        <Card title={<span className="title-icon"><Bell aria-hidden="true" />Notices</span>}
          subtitle="Saved in this browser only.">
          <label className="switch-row">
            <input type="checkbox" checked={notices} onChange={(e) => setHighSeverityNotices(e.target.checked)} />
            <span>
              <strong>New high-severity reports</strong>
              <span className="muted small">A quiet notice with a link, while the portal is open. Several at once are grouped.</span>
            </span>
          </label>
        </Card>
      </div>

      <TeamSection />

      <Card title={<span className="title-icon"><Keyboard aria-hidden="true" />Keyboard shortcuts</span>}
        subtitle="Anywhere except while typing.">
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
        </dl>
      </Card>
    </div>
  );
}
