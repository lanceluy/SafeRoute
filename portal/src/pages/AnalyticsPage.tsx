import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { QueueQuery } from '../api/types';
import { BacklogChart, BarList, TrendChart } from '../components/Charts';
import { MapView, type MapLayer } from '../components/MapView';
import { ErrorState } from '../components/States';
import { areaStats } from '../lib/areas';
import { duration, shortDate } from '../lib/format';
import { SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { useBarangays } from '../state/places';
import { useQueue } from '../state/useQueue';
import { useStats } from '../state/useStats';

type Range = 'today' | '7d' | '30d' | 'quarter' | 'custom';
const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'custom', label: 'Custom' },
];

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeBounds(range: Range, customFrom: string, customTo: string): { from: string; to?: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'custom' && customFrom) {
    const to = customTo ? new Date(`${customTo}T00:00:00`) : new Date();
    if (customTo) to.setDate(to.getDate() + 1);
    return { from: new Date(`${customFrom}T00:00:00`).toISOString(), to: to.toISOString() };
  }
  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === '30d' ? 29 : 89;
  start.setDate(start.getDate() - days);
  return { from: start.toISOString() };
}

const ACTIVE: QueueQuery = { view: 'active' };
const RESOLVED: QueueQuery = { statuses: ['RESOLVED'], sort: 'newest' };

export function AnalyticsPage() {
  const navigate = useNavigate();
  const barangays = useBarangays();
  const [range, setRange] = useState<Range>('30d');
  const [today] = useState(() => isoDay(new Date()));
  const [customFrom, setCustomFrom] = useState(() => isoDay(new Date(Date.now() - 13 * 86_400_000)));
  const [customTo, setCustomTo] = useState(today);
  const { from, to } = useMemo(() => rangeBounds(range, customFrom, customTo), [range, customFrom, customTo]);
  const { stats, error, reload } = useStats(from, to);
  const active = useQueue(ACTIVE);
  const resolved = useQueue(RESOLVED);
  const [heatLayer, setHeatLayer] = useState<MapLayer>('severity');

  const areas = useMemo(() => (stats
    ? areaStats(barangays, active.hazards, resolved.hazards, Date.parse(stats.from), Date.parse(stats.to))
    : []), [barangays, active.hazards, resolved.hazards, stats]);

  const avg = stats?.resolution.averageHours ?? null;
  const prev = stats?.resolution.previousAverageHours ?? null;
  const change = avg != null && prev ? Math.round(((avg - prev) / prev) * 100) : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">
            {stats ? <>{shortDate(stats.from).replace(/,.*$/, '')} – {shortDate(stats.to).replace(/,.*$/, '')} · Active numbers are as of now</> : 'Loading…'}
          </p>
        </div>
        <div className="range-picker" role="group" aria-label="Date range">
          <div className="segmented">
            {RANGES.map((r) => (
              <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)}>{r.label}</button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="custom-range">
              <label><span className="sr-only">From</span>
                <input type="date" value={customFrom} max={customTo || today} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <span aria-hidden="true">–</span>
              <label><span className="sr-only">To</span>
                <input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      </div>

      {error && <ErrorState title="We couldn’t load analytics." message={error} onRetry={reload} />}

      <div className="kpis">
        <Stat label="Reported" value={stats?.totals.reportedInRange.toLocaleString()} />
        <Stat label="Resolved" value={stats?.totals.resolvedInRange.toLocaleString()} />
        <Stat label="Resolution rate" value={stats && stats.totals.reportedInRange
          ? `${Math.round((stats.totals.resolvedInRange / stats.totals.reportedInRange) * 100)}%` : stats ? '—' : undefined}
          hint="Resolved in the range as a share of hazards reported in it" />
        <Stat label="Avg. time to resolve" value={stats ? duration(avg) : undefined}
          delta={change ? { text: `${change < 0 ? '↓' : '↑'} ${Math.abs(change)}% vs previous period`, good: change < 0 } : undefined} />
        <Stat label="Active now" value={stats?.totals.active.toLocaleString()} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Reports over time</h2><span className="muted">Is the situation improving?</span></div>
          {stats ? <TrendChart daily={stats.daily} /> : <div className="skeleton" style={{ height: 240 }} />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Unresolved backlog</h2><span className="muted">Open at the end of each day</span></div>
          {stats ? <BacklogChart daily={stats.daily} height={240} /> : <div className="skeleton" style={{ height: 240 }} />}
        </section>
      </div>

      <div className="grid-3">
        <section className="card">
          <div className="card-head"><h2>Active by type</h2></div>
          {stats && <BarList rows={stats.activeByType.map((t) => ({ key: t.key, label: TYPE_LABEL[t.key], value: t.count }))}
            onSelect={() => navigate('/map?tab=active')} empty="No active hazards" />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Active by severity</h2></div>
          {stats && <BarList rows={['HIGH', 'MEDIUM', 'LOW'].map((s) => ({
            key: s, label: SEVERITY_LABEL[s as 'HIGH'],
            value: stats.activeBySeverity.find((x) => x.key === s)?.count ?? 0,
          }))} empty="No active hazards" />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Time to resolve by type</h2></div>
          {stats && <BarList rows={stats.resolution.byType.map((t) => ({
            key: t.type, label: TYPE_LABEL[t.type], value: t.averageHours, hint: `${TYPE_LABEL[t.type]}: ${duration(t.averageHours)} average over ${t.count} resolved`,
          }))} format={duration} empty="Nothing resolved in this range" />}
        </section>
      </div>

      <div className="grid-2 grid-wide-left">
        <section className="card">
          <div className="card-head">
            <h2>By barangay</h2>
            <span className="muted">Click a row to see it on the map</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th scope="col">Barangay</th><th scope="col" className="num">Active</th><th scope="col" className="num">High</th>
                  <th scope="col" className="num">Resolved</th><th scope="col" className="num">Avg. age</th></tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.name} tabIndex={0} onClick={() => navigate(`/map?tab=active&area=${encodeURIComponent(a.name)}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/map?tab=active&area=${encodeURIComponent(a.name)}`); }}>
                    <th scope="row">{a.name}</th>
                    <td className="num">{a.active}</td>
                    <td className="num">{a.high}</td>
                    <td className="num">{a.resolved}</td>
                    <td className="num">{a.avgAgeDays == null ? '—' : `${a.avgAgeDays.toFixed(1)} days`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resolved.truncated && <p className="muted small">Resolved counts use the latest {resolved.hazards.length} resolved hazards.</p>}
        </section>
        <section className="card heat-card">
          <div className="card-head">
            <h2>Where hazards concentrate</h2>
            <div className="segmented small">
              <button type="button" aria-pressed={heatLayer === 'severity'} onClick={() => setHeatLayer('severity')}>Severity</button>
              <button type="button" aria-pressed={heatLayer === 'density'} onClick={() => setHeatLayer('density')}>Density</button>
            </div>
          </div>
          <div className="heat-map">
            <MapView hazards={active.hazards} layer={heatLayer} barangays={barangays} fitKey="analytics" loading={active.loading} />
          </div>
          <p className="muted small">Active hazards. {heatLayer === 'severity' ? 'High severity counts most.' : 'Every report counts the same.'}</p>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, delta }: { label: string; value?: string; hint?: string; delta?: { text: string; good: boolean } }) {
  return (
    <div className="kpi static" title={hint}>
      <span className="kpi-value">{value ?? <span className="skeleton" style={{ width: 56, height: 32, display: 'inline-block' }} />}</span>
      <span className="kpi-label">{label}</span>
      {delta && <span className={`kpi-delta ${delta.good ? 'good' : 'bad'}`}>{delta.text}</span>}
    </div>
  );
}
