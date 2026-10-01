import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import type { Session } from './api/types';
import { LiveNotices } from './components/LiveNotices';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LoginPage } from './pages/LoginPage';
import { LiveProvider } from './state/live';
import { useSession } from './state/session';
import { ToastProvider } from './state/toast';
import { useStats } from './state/useStats';

// Pages load on demand: the map (Leaflet) and charts (Recharts) are the heavy parts.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const ModerationPage = lazy(() => import('./pages/ModerationPage').then((m) => ({ default: m.ModerationPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const WeatherPage = lazy(() => import('./pages/WeatherPage').then((m) => ({ default: m.WeatherPage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));

export function App() {
  const session = useSession();
  return (
    <ToastProvider>
      {!session ? <LoginPage /> : (
        <LiveProvider>
          <BrowserRouter>
            <Shell session={session} />
          </BrowserRouter>
        </LiveProvider>
      )}
    </ToastProvider>
  );
}

const RAIL_KEY = 'saferoute.sidebar.rail';

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * Sidebar + top bar around the routed page. The sidebar is a full column from 1280 px (collapsible
 * to icons), an icon rail from 768 px, and an off-canvas drawer on phones.
 */
function Shell({ session }: { session: Session }) {
  const wide = useMedia('(min-width: 1280px)');
  const phone = useMedia('(max-width: 767px)');
  const [pinnedRail, setPinnedRail] = useState(() => {
    try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
  });
  const [navOpen, setNavOpen] = useState(false);
  const { stats } = useStats();

  const rail = !phone && (!wide || pinnedRail);
  const toggleRail = () => setPinnedRail((r) => {
    try { localStorage.setItem(RAIL_KEY, r ? '0' : '1'); } catch { /* not remembered */ }
    return !r;
  });

  return (
    <div className={`app${rail ? ' rail' : ''}${navOpen ? ' nav-open' : ''}`}>
      <Sidebar rail={rail} canToggle={wide} onToggle={toggleRail} onNavigate={() => setNavOpen(false)}
        needsReview={stats?.totals.needsReview} />
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div className="app-column">
        <TopBar session={session} onMenu={() => setNavOpen(true)} />
        <LiveNotices />
        <main className="app-main">
          <Suspense fallback={<div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading…</div>}>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/moderation" element={<ModerationPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/weather" element={<WeatherPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
