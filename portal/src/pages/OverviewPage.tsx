import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, CheckCircle2, CircleAlert, FilePlus2, Map as MapIcon, MessageSquareWarning, ScanSearch, Timer, TriangleAlert } from 'lucide-react';
import { ActivityWave, BarList } from '../components/Charts';
import { LiveStatus } from '../components/LiveStatus';
import { ErrorState } from '../components/States';
import { Card, StatCard, percentChange } from '../components/ui';
import { areaStats } from '../lib/areas';
import { duration, greeting, timeOfDay } from '../lib/format';
import { TYPE_LABEL } from '../lib/hazards';
import { useSession } from '../state/session';
import { useBarangays } from '../state/places';
import { useQueue } from '../state/useQueue';
import { useStats } from '../state/useStats';

const ACTIVE = { view: 'active' as const };
const RESOLVED = { statuses: ['RESOLVED' as const], sort: 'newest' as const };

/** "2.4 days" → ["2.4", "days"], so the number can be large and the unit quiet. */
function splitUnit(text: string): [string, string | undefined] {
  const [value, ...rest] = text.split(' ');
  return [value, rest.join(' ') || undefined];
}

/**
 * Reads top to bottom as: current status → what needs action → how the week is going → where.
 * The hero carries the one number that matters most (active hazards); everything else is quieter.
 */
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
      .filter((a) => a.active > 0).slice(0, 6);
  }, [barangays, active.hazards, resolved.hazards, stats]);

  const first = session?.displayName?.split(/\s+/)[0];
  const daily = stats?.daily ?? [];
  const today = daily.at(-1)?.reported ?? 0;
  const yesterday = daily.at(-2)?.reported;
  const avg = stats?.resolution.averageHours ?? null;
  const [avgValue, avgUnit] = splitUnit(duration(avg));
  const loading = !stats;
  const n = (v: number | undefined) => (v == null ? '—' : v.toLocaleString());

  return (
    <div className="page overview">
      {error && !stats && <ErrorState title="We couldn’t load the overview." message={error} onRetry={reload} />}

      <section className="hero" aria-labelledby="status-title">
        <div className="hero-head">
          <div>
            <p className="hero-kicker">
              {greeting()}{first ? `, ${first}` : ''}
              <span aria-hidden="true">·</span>
              <LiveStatus />
            </p>
            <h1 id="status-title" className="hero-title">Makati hazard status</h1>
          </div>
          <div className="button-row">
            <Link className="btn btn-secondary" to="/map"><MapIcon size={16} aria-hidden="true" />Open map</Link>
            <Link className="btn btn-primary" to="/moderation?tab=attention">Review reports<ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
        <div className="hero-body">
          <Link to="/map?tab=active" className="hero-big">
            <span className="hero-big-value">
              {loading ? <span className="skeleton" style={{ width: 96, height: 56, display: 'inline-block' }} /> : n(stats.totals.active)}
            </span>
            <span className="hero-big-label">Active hazards on the map<ArrowRight size={15} aria-hidden="true" /></span>
          </Link>
          <div className="hero-tiles">
            <HeroTile to="/map?tab=high" tone="high" icon={<TriangleAlert aria-hidden="true" />} label="High severity"
              value={stats?.totals.highSeverity} loading={loading} foot="Handle first" />
            <HeroTile to="/moderation?tab=attention" tone="review" icon={<ScanSearch aria-hidden="true" />} label="Needs review"
              value={stats?.totals.needsReview} loading={loading} foot="Waiting on staff" />
            <HeroTile to="/moderation?tab=contested" tone="contested" icon={<MessageSquareWarning aria-hidden="true" />} label="Contested"
              value={stats?.queueCounts.contested} loading={loading} foot="Community disagrees" />
          </div>
        </div>
      </section>

      <div className="stat-row">
        <StatCard label="Resolved this week" icon={<CheckCircle2 aria-hidden="true" />} to="/map?tab=closed"
          value={n(stats?.totals.resolvedInRange)} loading={loading} spark={daily.map((d) => d.resolved)}
          foot={stats ? <>of {n(stats.totals.reportedInRange)} reported</> : null} />
        <StatCard label="Average time to resolve" icon={<Timer aria-hidden="true" />} to="/analytics"
          value={avgValue} unit={avgUnit} loading={loading}
          delta={percentChange(avg, stats?.resolution.previousAverageHours)} goodWhen="down" deltaNote="vs previous week"
          foot={!stats ? null : avg == null ? 'Nothing resolved this week'
            : stats.resolution.previousAverageHours == null ? 'No earlier week to compare' : null} />
        <StatCard label="Reports today" icon={<FilePlus2 aria-hidden="true" />} to="/moderation?tab=new"
          value={n(today)} loading={loading} spark={daily.map((d) => d.reported)}
          delta={percentChange(today, yesterday)} goodWhen="down" deltaNote="vs yesterday" />
      </div>

      <div className="grid-main-side">
        <ReportsOverTime />
        <Card title="Hazards by type" subtitle="Active right now">
          {stats
            ? <BarList rows={stats.activeByType.map((t) => ({ key: t.key, label: TYPE_LABEL[t.key], value: t.count }))}
                onSelect={(type) => navigate(`/map?tab=active&type=${type}`)} empty="No active hazards" />
            : <div className="skeleton" style={{ height: 220 }} />}
        </Card>
      </div>

      <Card title="Barangays needing attention" subtitle="Most active hazards first. Select one to see it on the map."
        action={stats ? <span className="muted small">Updated {timeOfDay(stats.generatedAt)}</span> : null}>
        {active.loading
          ? <div className="skeleton" style={{ height: 180 }} />
          : areas.length === 0
            ? <p className="muted empty-line"><CircleAlert size={16} aria-hidden="true" />No active hazards in Makati barangays.</p>
            : <AreaList areas={areas} onSelect={(name) => navigate(`/map?tab=active&area=${encodeURIComponent(name)}`)} />}
      </Card>
    </div>
  );
}

function HeroTile({ to, tone, icon, label, value, loading, foot }: {
  to: string; tone: string; icon: ReactNode; label: string; value?: number; loading: boolean; foot: string;
}) {
  return (
    <Link to={to} className="hero-tile">
      <span className="hero-tile-label"><span className={`hero-tile-icon ${tone}`}>{icon}</span>{label}</span>
      <span className="hero-tile-value">
        {loading ? <span className="skeleton" style={{ width: 40, height: 28, display: 'inline-block' }} /> : (value ?? 0).toLocaleString()}
      </span>
      <span className="hero-tile-foot">{foot}<ArrowRight size={14} aria-hidden="true" /></span>
    </Link>
  );
}

/** Barangays as quiet rows: name, a thin bar, and how many are high severity. */
function AreaList({ areas, onSelect }: { areas: ReturnType<typeof areaStats>; onSelect: (name: string) => void }) {
  const max = Math.max(...areas.map((a) => a.active), 1);
  return (
    <ol className="area-list">
      {areas.map((a, i) => (
        <li key={a.name}>
          <button type="button" className="area-row" onClick={() => onSelect(a.name)}
            aria-label={`${a.name}: ${a.active} active, ${a.high} high severity. Show on map`}>
            <span className="area-rank">{i + 1}</span>
            <span className="area-name">{a.name}</span>
            <span className="area-bar"><span style={{ width: `${(a.active / max) * 100}%` }} /></span>
            <span className="area-count"><strong>{a.active}</strong> active</span>
            <span className={`area-high${a.high ? '' : ' none'}`}>{a.high ? `${a.high} high` : 'No high'}</span>
            <ArrowRight size={15} aria-hidden="true" className="area-go" />
          </button>
        </li>
      ))}
    </ol>
  );
}

const PERIODS = [{ days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }];

/** Its own period, so changing it doesn't move the rest of the page (which stays on this week). */
function ReportsOverTime() {
  const [days, setDays] = useState(7);
  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d.toISOString();
  }, [days]);
  const { stats } = useStats(from);
  return (
    <Card title="Reports over time" subtitle="Reporting and resolution activity"
      action={
        <div className="card-head-tools">
          <span className="card-legend" aria-hidden="true">
            <span><i style={{ background: 'var(--wave-up)' }} />Reported</span>
            <span><i style={{ background: 'var(--wave-down)' }} />Resolved</span>
          </span>
          <label>
            <span className="sr-only">Period</span>
            <select className="period-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select>
          </label>
        </div>
      }>
      {stats ? <ActivityWave daily={stats.daily} height={240} /> : <div className="skeleton" style={{ height: 240 }} />}
    </Card>
  );
}
