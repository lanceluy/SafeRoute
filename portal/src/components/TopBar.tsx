import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Bell, BellOff, FileSearch, LogOut, MapPin, Menu as MenuIcon, Search, Settings } from 'lucide-react';
import { logout } from '../api/client';
import type { Session } from '../api/types';
import { ago } from '../lib/format';
import { TYPE_LABEL } from '../lib/hazards';
import { markNoticesRead, useNotices } from '../state/notices';
import { useBarangays } from '../state/places';
import { TypeIcon } from './Badges';
import { Chevron } from './Chevron';

const ROLE_LABEL = { MUNICIPAL_OFFICIAL: 'Municipal Official', MODERATOR: 'Moderator', USER: 'Commuter' } as const;

/** The utility bar over every page: search, notifications, municipality and account. */
export function TopBar({ session, onMenu }: { session: Session; onMenu: () => void }) {
  // Map and Moderation have their own queue search, so the global one shrinks to a compact ⌘K control there.
  const { pathname } = useLocation();
  const compact = pathname.startsWith('/moderation') || pathname.startsWith('/map');
  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation">
        <MenuIcon aria-hidden="true" size={20} />
      </button>
      <GlobalSearch compact={compact} />
      <div className="topbar-right">
        <span className="city-chip" title="Your municipality"><MapPin aria-hidden="true" />Makati City</span>
        <NotificationBell />
        <AccountMenu session={session} />
      </div>
    </header>
  );
}

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close, ref]);
}

interface Option { key: string; icon: ReactNode; label: string; hint: string; to: string }

/**
 * One box for places and reports. A barangay opens the map on that area; anything else searches
 * the active reports on Moderation (type, street, barangay, description or reference).
 */
function GlobalSearch({ compact }: { compact: boolean }) {
  const navigate = useNavigate();
  const barangays = useBarangays();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  // ⌘K / Ctrl+K anywhere; "/" too, unless the page has its own search (Map and Moderation do).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      } else if (e.key === '/' && !typing && !document.querySelector('.queue .search input') && !document.querySelector('.dialog')) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const term = q.trim();
  const options = useMemo<Option[]>(() => {
    if (!term) return [];
    const lower = term.toLowerCase();
    const places = barangays.filter((b) => b.name.toLowerCase().includes(lower)).slice(0, 5).map((b) => ({
      key: `area-${b.name}`, icon: <MapPin aria-hidden="true" />, label: b.name, hint: 'Barangay · show on map',
      to: `/map?tab=active&area=${encodeURIComponent(b.name)}`,
    }));
    return [
      ...places,
      {
        key: 'reports', icon: <FileSearch aria-hidden="true" />, label: `Search reports for “${term}”`, hint: 'Moderation',
        to: `/moderation?tab=open&q=${encodeURIComponent(term)}`,
      },
    ];
  }, [term, barangays]);

  const go = (o: Option) => { navigate(o.to); setQ(''); setOpen(false); input.current?.blur(); };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && options[active]) { e.preventDefault(); go(options[active]); }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  const showList = open && options.length > 0;
  return (
    <div className={`global-search${compact ? ' compact' : ''}`} ref={ref} role="search">
      <Search aria-hidden="true" />
      <input ref={input} type="search" value={q} placeholder={compact ? 'Search…' : 'Search hazards, places or reports…'} aria-label="Search hazards, places or reports"
        role="combobox" aria-expanded={showList} aria-controls="global-search-list" aria-autocomplete="list"
        aria-activedescendant={showList ? `gs-${options[active]?.key}` : undefined}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
      {!q && <kbd aria-hidden="true">⌘K</kbd>}
      {showList && (
        <div className="search-suggest" id="global-search-list" role="listbox" aria-label="Suggestions">
          {options.map((o, i) => (
            <button key={o.key} id={`gs-${o.key}`} type="button" role="option" aria-selected={i === active} tabIndex={-1}
              className={`search-option${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(o)}>
              {o.icon}<span>{o.label}</span><em>{o.hint}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** High-severity reports that arrived live this session. */
function NotificationBell() {
  const navigate = useNavigate();
  const { notices, unread } = useNotices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const toggle = () => { setOpen((o) => !o); markNoticesRead(); };

  return (
    <div className="bell" ref={ref}>
      <button type="button" className="icon-btn bell-btn" aria-haspopup="true" aria-expanded={open} onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
        <Bell aria-hidden="true" size={18} />
        {unread > 0 && <span className="bell-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="popover-head">
            <strong>New high-severity reports</strong>
            <Link to="/moderation?tab=new" className="btn-link" onClick={() => setOpen(false)}>View all</Link>
          </div>
          {notices.length === 0 ? (
            <div className="popover-empty">
              <BellOff aria-hidden="true" size={22} />
              Nothing new since you signed in. High-severity reports will appear here as they arrive.
            </div>
          ) : (
            <ul className="notice-list">
              {notices.map((n) => (
                <li key={n.hazardId}>
                  <button type="button" className="notice-item"
                    onClick={() => { setOpen(false); navigate(`/map?tab=active&hazard=${n.hazardId}`); }}>
                    <span className="row-icon sev-bg-high"><TypeIcon type={n.hazardType} size={15} /></span>
                    <span>
                      <strong>{TYPE_LABEL[n.hazardType]}</strong>
                      <small>High severity · {ago(n.occurredAt)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AccountMenu({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const initials = (session.displayName || session.email).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="account" ref={ref}>
      <button type="button" className="account-trigger" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="account-text">
          <span className="account-role">{session.displayName || ROLE_LABEL[session.role]}</span>
          <span className="account-city">{ROLE_LABEL[session.role]}</span>
        </span>
        <span aria-hidden="true" className="caret"><Chevron up={open} /></span>
      </button>
      {open && (
        <div className="popover account-menu">
          <div className="account-menu-head">
            <strong>{session.displayName}</strong>
            <span>{session.email}</span>
            <span className="muted">{ROLE_LABEL[session.role]} · Makati City</span>
          </div>
          <Link to="/account" className="menu-item" onClick={() => setOpen(false)}><Settings aria-hidden="true" />Settings</Link>
          <button type="button" className="menu-item" onClick={logout}><LogOut aria-hidden="true" />Sign out</button>
        </div>
      )}
    </div>
  );
}
