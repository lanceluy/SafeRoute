import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { BarList, TrendChart } from '../components/Charts';
import { LiveStatus } from '../components/LiveStatus';
import { ErrorState } from '../components/States';
import { areaStats } from '../lib/areas';
import { duration, greeting, timeOfDay } from '../lib/format';
import { TYPE_LABEL } from '../lib/hazards';
import { useSession } from '../state/session';
import { useBarangays } from '../state/places';
import { useQueue } from '../state/useQueue';
import { useStats } from '../state/useStats';

const ACTIVE = { view: 'active' as const };
const RESOLVED = { statuses: ['RESOLVED' as const], sort: 'newest' as const };

export function OverviewPage() {
  const session = useSession();
  const navigate = useNavigate();
  const barangays = useBarangays();
  const { stats, error, reload } = useStats();
  const active = useQueue(ACTIVE);
  const resolved = useQueue(RESOLVED);

  const areas = useMemo(() => {
    if (!stats) return [];
    return areaStats(barangays, active.hazards, resolved.hazards, Date.parse(stats.from), Date.parse(stats.to))
      .filter((a) => a.active > 0).slice(0, 5);
  }, [barangays, active.hazards, resolved.hazards, stats]);

  const first = session?.displayName?.split(/\s+/)[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{greeting()}{first ? `, ${first}` : ''}</p>
          <h1>Makati Hazard Overview</h1>
          <p className="muted">
            {stats ? <>Last updated {timeOfDay(stats.generatedAt)} · </> : null}
            <LiveStatus />
          </p>
        </div>
        <Link className="btn btn-primary" to="/moderation">Review reports</Link>
      </div>

      {error && !stats && <ErrorState title="We couldn’t load the overview." message={error} onRetry={reload} />}

      <div className="kpis">
        <Kpi loading={!stats} value={stats?.totals.active} label="Active hazards" to="/map?tab=active" />
        <Kpi loading={!stats} value={stats?.totals.highSeverity} label="High severity" tone="critical" to="/map?tab=high" />
        <Kpi loading={!stats} value={stats?.totals.needsReview} label="Need review" tone="warning" to="/moderation?tab=attention" />
        <Kpi loading={!stats} value={stats?.totals.resolvedInRange} label="Resolved this week" tone="good" to="/analytics" />
        <ResolutionKpi stats={stats} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Reported and resolved</h2>
            <span className="muted">Last 7 days</span>
          </div>
          {stats ? <TrendChart daily={stats.daily} /> : <div className="skeleton" style={{ height: 240 }} />}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Active hazards by type</h2>
            <Link to="/analytics" className="btn-link">Analytics ›</Link>
          </div>
          {stats
            ? <BarList rows={stats.activeByType.map((t) => ({ key: t.key, label: TYPE_LABEL[t.key], value: t.count }))}
                empty="No active hazards" />
            : <div className="skeleton" style={{ height: 220 }} />}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Barangays with the most active hazards</h2>
          <span className="muted">Click one to see it on the map</span>
        </div>
        {active.loading
          ? <div className="skeleton" style={{ height: 160 }} />
          : <BarList rows={areas.map((a) => ({
              key: a.name, label: a.name, value: a.active,
              hint: `${a.name}: ${a.active} active, ${a.high} high severity`,
            }))}
            onSelect={(name) => navigate(`/map?tab=active&area=${encodeURIComponent(name)}`)}
            empty="No active hazards in Makati barangays" />}
      </section>
    </div>
  );
}

function Kpi({ value, label, to, tone, loading }: { value?: number; label: string; to: string; tone?: string; loading: boolean }) {
  return (
    <Link to={to} className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <span className="kpi-value">{loading ? <span className="skeleton" style={{ width: 48, height: 32, display: 'inline-block' }} /> : value?.toLocaleString()}</span>
      <span className="kpi-label">{label}</span>
    </Link>
  );
}

function ResolutionKpi({ stats }: { stats: ReturnType<typeof useStats>['stats'] }) {
  const avg = stats?.resolution.averageHours ?? null;
  const prev = stats?.resolution.previousAverageHours ?? null;
  const change = avg != null && prev ? Math.round(((avg - prev) / prev) * 100) : null;
  return (
    <Link to="/analytics" className="kpi">
      <span className="kpi-value">{stats ? duration(avg) : <span className="skeleton" style={{ width: 64, height: 32, display: 'inline-block' }} />}</span>
      <span className="kpi-label">Avg. time to resolve</span>
      {change !== null && change !== 0 && (
        // Faster is better: a drop is good news.
        <span className={`kpi-delta ${change < 0 ? 'good' : 'bad'}`}>
          {change < 0 ? '↓' : '↑'} {Math.abs(change)}% vs previous week
        </span>
      )}
    </Link>
  );
}
