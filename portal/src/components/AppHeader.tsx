import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { logout } from '../api/client';
import type { Session } from '../api/types';
import { LiveStatus } from './LiveStatus';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/map', label: 'Hazard Map' },
  { to: '/moderation', label: 'Moderation' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/activity', label: 'Activity' },
];

const ROLE_LABEL = { MUNICIPAL_OFFICIAL: 'Municipal Official', MODERATOR: 'Moderator', USER: 'Commuter' } as const;

export function AppHeader({ session }: { session: Session }) {
  return (
    <header className="app-header">
      <div className="brand">
        <img src="/logo-mark.png" alt="" width={30} height={35} />
        <div>
          <span className="brand-name">SafeRoute</span>
          <span className="brand-sub">Municipal Hazard Portal</span>
        </div>
      </div>
      <nav className="main-nav" aria-label="Portal sections">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="header-right">
        <LiveStatus />
        <span className="city-chip" title="Your municipality">Makati City</span>
        <AccountMenu session={session} />
      </div>
    </header>
  );
}

function AccountMenu({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const initials = (session.displayName || session.email).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="account" ref={ref}>
      <button type="button" className="account-trigger" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="account-text">
          <span className="account-role">{ROLE_LABEL[session.role]}</span>
          <span className="account-city">Makati City</span>
        </span>
        <span aria-hidden="true" className="caret">▾</span>
      </button>
      {open && (
        <div className="account-menu">
          <div className="account-menu-head">
            <strong>{session.displayName}</strong>
            <span>{session.email}</span>
            <span className="muted">{ROLE_LABEL[session.role]} · Makati City</span>
          </div>
          <button type="button" className="menu-item" onClick={logout}>Sign out</button>
        </div>
      )}
    </div>
  );
}
