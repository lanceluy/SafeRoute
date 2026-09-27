import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppHeader } from './components/AppHeader';
import { LiveNotices } from './components/LiveNotices';
import { LoginPage } from './pages/LoginPage';
import { LiveProvider } from './state/live';
import { useSession } from './state/session';
import { ToastProvider } from './state/toast';

// Pages load on demand: the map (Leaflet) and charts (Recharts) are the heavy parts.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const ModerationPage = lazy(() => import('./pages/ModerationPage').then((m) => ({ default: m.ModerationPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));

export function App() {
  const session = useSession();
  return (
    <ToastProvider>
      {!session ? <LoginPage /> : (
        <LiveProvider>
          <BrowserRouter>
            <div className="app">
              <AppHeader session={session} />
              <LiveNotices />
              <main className="app-main">
                <Suspense fallback={<div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading…</div>}>
                  <Routes>
                    <Route path="/" element={<OverviewPage />} />
                    <Route path="/map" element={<MapPage />} />
                    <Route path="/moderation" element={<ModerationPage />} />
                    <Route path="/analytics" element={<AnalyticsPage />} />
                    <Route path="/activity" element={<ActivityPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </main>
            </div>
          </BrowserRouter>
        </LiveProvider>
      )}
    </ToastProvider>
  );
}
