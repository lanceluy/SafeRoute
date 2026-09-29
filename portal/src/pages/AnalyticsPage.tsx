import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Confidence, HazardType, QueueQuery, Severity, Stats } from '../api/types';
import { AreaMap } from '../components/AreaMap';
import {
  BacklogChart, BarList, ColumnChart, DivergingBars, IntakeChart, ReportTimesHeatmap, SeverityStackBars, SeverityTrendChart, TrendChart,
} from '../components/Charts';
import { MapView, type MapLayer } from '../components/MapView';
import { ErrorState } from '../components/States';
import { areaStats, type AreaRow } from '../lib/areas';
import { duration, shortDate } from '../lib/format';
import { barangayAt, streetAt } from '../lib/geo';
import { CONFIDENCE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { SEQUENTIAL_BLUE } from '../lib/scales';
import { useBarangays, useStreetsVersion } from '../state/places';
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
const SEVERITIES: Severity[] = ['HIGH', 'MEDIUM', 'LOW'];
/** Most trusted first; contested last, since it's a different kind of problem. */
const CONFIDENCES: Confidence[] = ['HIGH', 'MEDIUM', 'LOW', 'UNCONFIRMED', 'CONTESTED'];
const AGE_BUCKETS = [
  { key: 'lt1', label: '< 1 day', max: 1 },
  { key: '1-3', label: '1–3 days', max: 4 },
  { key: '4-7', label: '4–7 days', max: 8 },
  { key: '8-14', label: '8–14 days', max: 15 },
  { key: '15+', label: '15+ days', max: Infinity },
];

type AreaMetric = 'active' | 'high' | 'avgAgeDays' | 'resolutionRate' | 'disputeRate';
const AREA_METRICS: { value: AreaMetric; label: string; format: (v: number) => string }[] = [
  { value: 'active', label: 'Active hazards', format: (v) => `${v} active` },
  { value: 'high', label: 'High severity', format: (v) => `${v} high severity` },
  { value: 'avgAgeDays', label: 'Average age', format: (v) => `${v.toFixed(1)} days on average` },
  { value: 'resolutionRate', label: 'Resolution rate', format: (v) => `${Math.round(v * 100)}% resolved` },
  { value: 'disputeRate', label: 'Dispute rate', format: (v) => `${Math.round(v * 100)}% of responses dispute` },
];

const HEAT_LAYERS: { value: MapLayer; label: string; note: string }[] = [
  { value: 'density', label: 'Density', note: 'Every active hazard counts the same.' },
  { value: 'severity', label: 'Severity', note: 'High-severity hazards count most.' },
  { value: 'high', label: 'High risk', note: 'Only high-severity hazards.' },
  { value: 'age', label: 'Age', note: 'Older unresolved hazards count more, fully after two weeks.' },
];

function percent(n: number, of: number) {
  return of ? `${Math.round((n / of) * 100)}%` : '—';
}

export function AnalyticsPage() {
  const navigate = useNavigate();
  const barangays = useBarangays();
  useStreetsVersion();
  const [range, setRange] = useState<Range>('30d');
  const [today] = useState(() => isoDay(new Date()));
  const [customFrom, setCustomFrom] = useState(() => isoDay(new Date(Date.now() - 13 * 86_400_000)));
  const [customTo, setCustomTo] = useState(today);
  const { from, to } = useMemo(() => rangeBounds(range, customFrom, customTo), [range, customFrom, customTo]);
  const { stats, error, reload } = useStats(from, to);
  const active = useQueue(ACTIVE);
  const resolved = useQueue(RESOLVED);
  const [heatLayer, setHeatLayer] = useState<MapLayer>('severity');
  const [areaMetric, setAreaMetric] = useState<AreaMetric>('active');
  const [now] = useState(() => Date.now());

  const areas = useMemo(() => (stats
    ? areaStats(barangays, active.hazards, resolved.hazards, Date.parse(stats.from), Date.parse(stats.to))
    : []), [barangays, active.hazards, resolved.hazards, stats]);

  // Derived from the active hazards themselves (as of now).
  const confidence = useMemo(() => CONFIDENCES.map((c) => ({
    key: c, label: CONFIDENCE_LABEL[c], value: active.hazards.filter((h) => h.confidence === c).length,
  })), [active.hazards]);
  const ages = useMemo(() => {
    const counts = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: 0 }));
    for (const h of active.hazards) {
      const days = (now - Date.parse(h.createdAt)) / 86_400_000;
      counts[AGE_BUCKETS.findIndex((b) => days < b.max)].value++;
    }
    return counts;
  }, [active.hazards, now]);
  const opinions = useMemo(() => {
    const byType = new Map<HazardType, { left: number; right: number }>();
    for (const h of active.hazards) {
      const r = byType.get(h.type) ?? { left: 0, right: 0 };
      r.left += h.disputeCount;
      r.right += h.confirmationCount;
      byType.set(h.type, r);
    }
    return [...byType].map(([type, r]) => ({ key: type, label: TYPE_LABEL[type], ...r }))
      .sort((a, b) => b.left + b.right - (a.left + a.right));
  }, [active.hazards]);

  const metric = AREA_METRICS.find((m) => m.value === areaMetric)!;
  const areaValues = useMemo(() => new Map(areas.map((a) => [a.name, a[areaMetric] as number | null])), [areas, areaMetric]);
  const areaMax = Math.max(0, ...[...areaValues.values()].map((v) => v ?? 0));

  const avg = stats?.resolution.averageHours ?? null;
  const prev = stats?.resolution.previousAverageHours ?? null;
  const change = avg != null && prev ? Math.round(((avg - prev) / prev) * 100) : null;
  const heat = HEAT_LAYERS.find((l) => l.value === heatLayer)!;

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

      {/* 1. Summary */}
      <div className="kpis">
        <Stat label="Reported" value={stats?.totals.reportedInRange.toLocaleString()} />
        <Stat label="Active now" value={stats?.totals.active.toLocaleString()} />
        <Stat label="High severity" value={stats?.totals.highSeverity.toLocaleString()} tone="critical" hint="Active high-severity hazards, as of now" />
        <Stat label="Resolved" value={stats?.totals.resolvedInRange.toLocaleString()} />
        <Stat label="Resolution rate" value={stats ? percent(stats.totals.resolvedInRange, stats.totals.reportedInRange) : undefined}
          hint="Resolved in the range as a share of hazards reported in it" />
        <Stat label="Avg. time to resolve" value={stats ? duration(avg) : undefined}
          delta={change ? { text: `${change < 0 ? '↓' : '↑'} ${Math.abs(change)}% vs previous period`, good: change < 0 } : undefined} />
      </div>

      {/* 2. Trends */}
      <div className="grid-2">
        <Card title="Reports over time" sub="How reporting volume changes, and how much gets resolved">
          {stats ? <TrendChart daily={stats.daily} /> : <Skeleton h={240} />}
        </Card>
        <Card title="Unresolved backlog" sub="Active hazards remaining at the end of each day">
          {stats ? <BacklogChart daily={stats.daily} height={240} /> : <Skeleton h={240} />}
        </Card>
      </div>
      <Card title="Severity trend" sub="Hazards reported each day, by severity">
        {stats ? <SeverityTrendChart daily={stats.daily} /> : <Skeleton h={240} />}
      </Card>

      {/* 3. Composition and quality */}
      <div className="grid-3">
        <Card title="Active by type">
          {stats ? <BarList rows={stats.activeByType.map((t) => ({ key: t.key, label: TYPE_LABEL[t.key], value: t.count }))}
            onSelect={(type) => navigate(`/map?tab=active&type=${type}`)} empty="No active hazards" /> : <Skeleton h={200} />}
        </Card>
        <Card title="Active by severity">
          {stats ? <BarList rows={SEVERITIES.map((s) => ({
            key: s, label: SEVERITY_LABEL[s], color: SEVERITY_COLOR[s],
            value: stats.activeBySeverity.find((x) => x.key === s)?.count ?? 0,
          }))} empty="No active hazards" /> : <Skeleton h={200} />}
        </Card>
        <Card title="Report confidence" sub="How well-supported the active hazards are">
          {active.loading ? <Skeleton h={200} /> : <BarList rows={confidence} empty="No active hazards" />}
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Community verification" sub="Confirmations and disputes on active hazards, by type">
          {active.loading ? <Skeleton h={220} />
            : <DivergingBars rows={opinions} leftLabel="Disputes" rightLabel="Confirmations" empty="No community responses yet" />}
        </Card>
        <Card title="Age of active hazards" sub="How long unresolved hazards have been on the map">
          {active.loading ? <Skeleton h={220} /> : <ColumnChart rows={ages} label="Active hazards by age" unit="active hazards" />}
        </Card>
      </div>

      {/* 4. Operations */}
      <div className="grid-3">
        <Card title="Time to verification" sub="Report to first verified, for hazards verified in the range">
          {stats ? <TypeDurations rows={stats.verification.byType} what="verified" /> : <Skeleton h={200} />}
        </Card>
        <Card title="Time to resolve by type" sub="Report to resolved, for hazards resolved in the range">
          {stats ? <TypeDurations rows={stats.resolution.byType} what="resolved" /> : <Skeleton h={200} />}
        </Card>
        <Card title="How hazards close" sub="Status changes in the range; an expired hazard wasn’t necessarily fixed">
          {stats ? <Outcomes outcomes={stats.outcomes} /> : <Skeleton h={200} />}
        </Card>
      </div>
      <Card title="New vs existing hazards" sub="Whether each incoming report found a new hazard or reinforced one already on the map">
        {stats ? <IntakeChart daily={stats.daily} /> : <Skeleton h={220} />}
      </Card>

      {/* 5. Geography */}
      <div className="grid-2">
        <Card title="Severity by barangay" sub="Active hazards; click one to see it on the map">
          <SeverityStackBars
            rows={areas.filter((a) => a.active > 0).slice(0, 10).map((a) => ({ key: a.name, label: a.name, high: a.high, medium: a.medium, low: a.low }))}
            onSelect={(name) => navigate(`/map?tab=active&area=${encodeURIComponent(name)}`)} empty="No active hazards in Makati barangays" />
        </Card>
        <section className="card heat-card">
          <div className="card-head">
            <h2>Hazard concentration</h2>
            <div className="segmented small" role="group" aria-label="Map layer">
              {HEAT_LAYERS.map((l) => (
                <button key={l.value} type="button" aria-pressed={heatLayer === l.value} onClick={() => setHeatLayer(l.value)}>{l.label}</button>
              ))}
            </div>
          </div>
          <div className="heat-map">
            <MapView hazards={active.hazards} layer={heatLayer} barangays={barangays} fitKey="analytics" loading={active.loading} />
          </div>
          <p className="muted small">Active hazards. {heat.note}</p>
        </section>
      </div>
      <div className="grid-2">
        <Card title="When hazards are reported" sub="Every report received in the range, by weekday and hour">
          {stats ? <ReportTimesHeatmap cells={stats.reportTimes} /> : <Skeleton h={220} />}
        </Card>
        <Card title="Recurring hotspots" sub="Places (about 165 m across) with repeated reports in the range">
          {stats ? <Hotspots hotspots={stats.hotspots} barangays={barangays} /> : <Skeleton h={220} />}
        </Card>
      </div>
      <div className="grid-2 grid-wide-left">
        <section className="card">
          <div className="card-head">
            <h2>By barangay</h2>
            <span className="muted">Click a row to see it on the map</span>
          </div>
          <AreaTable areas={areas} onSelect={(name) => navigate(`/map?tab=active&area=${encodeURIComponent(name)}`)} />
          {resolved.truncated && <p className="muted small">Resolved counts use the latest {resolved.hazards.length} resolved hazards.</p>}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Barangay map</h2>
            <label className="select-label">
              <span className="sr-only">Colour by</span>
              <select value={areaMetric} onChange={(e) => setAreaMetric(e.target.value as AreaMetric)}>
                {AREA_METRICS.map((m) => <option key={m.value} value={m.value}>Colour by: {m.label}</option>)}
              </select>
            </label>
          </div>
          <AreaMap barangays={barangays} values={areaValues} max={areaMax}
            format={(v) => (v == null ? 'No data' : metric.format(v))}
            label={`Makati barangays shaded by ${metric.label.toLowerCase()}; the table has the same numbers`} />
          <div className="rain-legend" aria-label="Colour scale">
            <span className="muted">{metric.format(0)}</span>
            <span className="rain-ramp" style={{ background: `linear-gradient(90deg, ${SEQUENTIAL_BLUE.join(', ')})` }} />
            <span className="muted">{metric.format(areaMax)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head card-head-stacked">
        <h2>{title}</h2>
        {sub && <span className="muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Skeleton({ h }: { h: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

/** Durations by type, or an explanation while there's too little to compare. */
function TypeDurations({ rows, what }: { rows: { type: HazardType; averageHours: number; count: number }[]; what: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (rows.length < 2) {
    return (
      <div className="chart-empty-block">
        <p><strong>Not enough {what} hazards yet</strong></p>
        <p className="muted">A comparison appears once two or more hazard types have {what} cases in this range.
          {rows.length === 1 && <> So far: {TYPE_LABEL[rows[0].type]}, {duration(rows[0].averageHours)} on average over {rows[0].count}.</>}
        </p>
      </div>
    );
  }
  return (
    <>
      <BarList rows={rows.map((t) => ({
        key: t.type, label: TYPE_LABEL[t.type], value: t.averageHours,
        hint: `${TYPE_LABEL[t.type]}: ${duration(t.averageHours)} average over ${t.count} ${what}`,
      }))} format={duration} />
      <p className="muted small">Based on {total} {what} hazard{total === 1 ? '' : 's'}.</p>
    </>
  );
}

function Outcomes({ outcomes }: { outcomes: Stats['outcomes'] }) {
  const rows = [
    { key: 'resolved', label: 'Resolved', value: outcomes.resolved, hint: 'Fixed and closed by staff or the community' },
    { key: 'expired', label: 'Expired', value: outcomes.expired, hint: 'Nobody confirmed it for its type’s time to live' },
    { key: 'removed', label: 'Removed', value: outcomes.removed, hint: 'Taken down as false, spam or invalid' },
    { key: 'reopened', label: 'Reopened', value: outcomes.reopened, hint: 'Came back after being marked resolved' },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  return <BarList rows={rows.map((r) => ({ ...r, hint: `${r.label}: ${r.value} (${percent(r.value, total)}). ${r.hint}.` }))}
    format={(n) => `${n} · ${percent(n, total)}`} empty="No hazards closed or reopened in this range" />;
}

function Hotspots({ hotspots, barangays }: { hotspots: Stats['hotspots']; barangays: ReturnType<typeof useBarangays> }) {
  if (!hotspots.length) return <p className="muted chart-empty">No place had repeated reports in this range</p>;
  return (
    <BarList rows={hotspots.map((h, i) => {
      const street = streetAt(h.latitude, h.longitude);
      const area = barangayAt(barangays, h.latitude, h.longitude)?.name;
      const label = [street || null, area].filter(Boolean).join(' · ') || `${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}`;
      return { key: String(i), label, value: h.count, hint: `${label}: ${h.count} reports, mostly ${TYPE_LABEL[h.topType].toLowerCase()}` };
    })} format={(n) => `${n} reports`} />
  );
}

function AreaTable({ areas, onSelect }: { areas: AreaRow[]; onSelect: (name: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th scope="col">Barangay</th><th scope="col" className="num">Active</th><th scope="col" className="num">High</th>
            <th scope="col" className="num">Resolved</th><th scope="col" className="num">Avg. age</th>
            <th scope="col" className="num" title="Resolved in the range as a share of those plus the ones still active">Resolution rate</th></tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a.name} tabIndex={0} onClick={() => onSelect(a.name)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(a.name); }}>
              <th scope="row">{a.name}</th>
              <td className="num">{a.active}</td>
              <td className="num">{a.high}</td>
              <td className="num">{a.resolved}</td>
              <td className="num">{a.avgAgeDays == null ? '—' : `${a.avgAgeDays.toFixed(1)} days`}</td>
              <td className="num">{a.resolutionRate == null ? '—' : `${Math.round(a.resolutionRate * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, hint, delta, tone }: {
  label: string; value?: string; hint?: string; delta?: { text: string; good: boolean }; tone?: 'critical';
}) {
  return (
    <div className={`kpi static${tone ? ` kpi-${tone} kpi-toned` : ''}`} title={hint}>
      <span className="kpi-value">{value ?? <span className="skeleton" style={{ width: 56, height: 32, display: 'inline-block' }} />}</span>
      <span className="kpi-label">{label}</span>
      {delta && <span className={`kpi-delta ${delta.good ? 'good' : 'bad'}`}>{delta.text}</span>}
    </div>
  );
}
