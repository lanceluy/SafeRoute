import { NavLink } from 'react-router';
import {
  ChartNoAxesCombined, CircleHelp, CloudSun, History, LayoutDashboard, Map, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { LiveStatus } from './LiveStatus';

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; count?: number }

/** Fixed left navigation: Main sections, then Management, with the live status at the foot. */
export function Sidebar({ rail, canToggle, onToggle, onNavigate, needsReview }: {
  rail: boolean; canToggle: boolean; onToggle: () => void; onNavigate: () => void; needsReview?: number;
}) {
  const main: NavItem[] = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/map', label: 'Hazard Map', icon: Map },
    { to: '/moderation', label: 'Moderation', icon: ShieldCheck, count: needsReview },
    { to: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
    { to: '/weather', label: 'Weather', icon: CloudSun },
    { to: '/activity', label: 'Activity', icon: History },
  ];
  const management: NavItem[] = [
    { to: '/account', label: 'Settings', icon: Settings },
    { to: '/help', label: 'Help', icon: CircleHelp },
  ];

  const link = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate} title={rail ? n.label : undefined}
      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      <n.icon aria-hidden="true" />
      <span className="nav-label">{n.label}</span>
      {!!n.count && <span className="nav-count" aria-label={`${n.count} need review`}>{n.count > 99 ? '99+' : n.count}</span>}
    </NavLink>
  );

  return (
    <aside className="sidebar" aria-label="Portal sections">
      <NavLink to="/" className="sidebar-brand" onClick={onNavigate} aria-label="SafeRoute overview">
        <img src="/logo-mark.png" alt="" width={30} height={35} />
        <div>
          <strong>SafeRoute</strong>
          <span>Municipal Portal</span>
        </div>
      </NavLink>
      <nav className="sidebar-nav">
        <p className="nav-group-label"><span>Main</span></p>
        {main.map(link)}
        <p className="nav-group-label"><span>Management</span></p>
        {management.map(link)}
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-status"><LiveStatus compact={rail} label="System live" /></div>
        {canToggle && (
          <button type="button" className="sidebar-toggle" onClick={onToggle} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}>
            {rail ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            <span>Collapse</span>
          </button>
        )}
      </div>
    </aside>
  );
}
