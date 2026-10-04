import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, CircleDot, Inbox, Table2, Timer } from 'lucide-react';
import type { Confidence, HazardType, QueueQuery, Severity, Stats } from '../api/types';
import { BacklogSteps, DotColumns, Funnel, ProgressRows, SegmentBar, SeverityGauge, SeverityMultiples } from '../components/AnalyticsCharts';
import { AreaFrequencyCard } from '../components/AreaFrequency';
import { AreaMap } from '../components/AreaMap';
import { BarList, ColumnChart, DivergingBars, IntakeChart, TrendChart } from '../components/Charts';
import { MapView, type MapLayer } from '../components/MapView';
import { ErrorState } from '../components/States';
import { Card, PageHeader, StatCard, percentChange } from '../components/ui';
import { areaStats, type AreaRow } from '../lib/areas';
import { duration, shortDate } from '../lib/format';
import { barangayAt, streetAt } from '../lib/geo';
import { CONFIDENCE_HINT, CONFIDENCE_LABEL, TYPE_LABEL } from '../lib/hazards';
import { SEQUENTIAL_BLUE } from '../lib/scales';
import { useBarangays, useStreetsVersion } from '../state/places';
import { useQueue } from '../state/useQueue';
import { useStats } from '../state/useStats';
import { Segmented } from '../components/Segmented';
import { Swap } from '../components/Swap';
import { CountUp } from '../components/CountUp';

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
/** Ordinal blue for the trusted-to-weak steps (validated --ordinal), grey for none yet, violet for contested. */
const CONFIDENCE_COLOR: Record<Confidence, string> = {
  HIGH: 'var(--conf-high)', MEDIUM: 'var(--conf-medium)', LOW: 'var(--conf-low)', UNCONFIRMED: 'var(--conf-none)', CONTESTED: 'var(--contested)',
};
const AGE_BUCKETS = [
  { key: 'lt1', label: '< 1 day', max: 1 },
  { key: '1-3', label: '1–3 days', max: 4 },
  { key: '4-7', label: '4–7 days', max: 8 },
  { key: '8-14', label: '8–14 days', max: 15 },
  { key: '15+', label: '15+ days', max: Infinity },
];

type AreaMetric = 'active' | 'high' | 'avgAgeDays' | 'resolutionRate' | 'disputeRate';
const AREA_METRICS: { value: AreaMetric; label: string; format: (v: number) => string }[] = [
  { value: 'active', label: 'Open hazards', format: (v) => `${v} open` },
  { value: 'high', label: 'High severity', format: (v) => `${v} high severity` },
  { value: 'avgAgeDays', label: 'Average age', format: (v) => `${v.toFixed(1)} days on average` },
  { value: 'resolutionRate', label: 'Resolution rate', format: (v) => `${Math.round(v * 100)}% resolved` },
  { value: 'disputeRate', label: 'Dispute rate', format: (v) => `${Math.round(v * 100)}% of responses dispute` },
];

const HEAT_LAYERS: { value: MapLayer; label: string; note: string }[] = [
  { value: 'density', label: 'Density', note: 'Every open hazard counts the same.' },
  { value: 'severity', label: 'Severity', note: 'High-severity hazards count most.' },
  { value: 'high', label: 'High risk', note: 'Only high-severity hazards.' },
  { value: 'age', label: 'Age', note: 'Older unresolved hazards count more, fully after two weeks.' },
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type Trend = 'volume' | 'severity' | 'intake';
type Speed = 'resolve' | 'verify';
type Where = 'barangays' | 'concentration';
const TREND_TITLE: Record<Trend, string> = { volume: 'Reports over time', severity: 'Reports by severity', intake: 'New vs merged reports' };
const TREND_SUB: Record<Trend, string> = {
  volume: 'Hazards reported and resolved per day',
  severity: 'New hazards per day, one chart per severity',
  intake: 'Whether each report found a new hazard or joined one already on the map',
};

function percent(n: number, of: number) {
  return of ? `${Math.round((n / of) * 100)}%` : '—';
}

/** "2.4 days" → ["2.4", "days"], so the number can be large and the unit quiet. */
function splitUnit(text: string): [string, string | undefined] {
  const [value, ...rest] = text.split(' ');
  return [value, rest.join(' ') || undefined];
}

/** "12 AM", "3 PM". */
function hourName(h: number) {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Analytics reads in sections, each answering one question: how much (volume and the report
 * pipeline), what's open now, how fast, when, and where. Related views share a card behind a
 * toggle instead of each taking its own.
 */
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
  // A new date range crossfades the line charts; a live update of the same range doesn't.
  const rangeKey = stats ? `${stats.from}|${stats.to}` : '';
  const active = useQueue(ACTIVE);
  const resolved = useQueue(RESOLVED);
  const [trend, setTrend] = useState<Trend>('volume');
  const [speed, setSpeed] = useState<Speed>('resolve');
  const [where, setWhere] = useState<Where>('barangays');
  const [showTable, setShowTable] = useState(false);
  const [heatLayer, setHeatLayer] = useState<MapLayer>('severity');
  const [areaMetric, setAreaMetric] = useState<AreaMetric>('active');
  const [now] = useState(() => Date.now());

  const areas = useMemo(() => (stats
    ? areaStats(barangays, active.hazards, resolved.hazards, Date.parse(stats.from), Date.parse(stats.to))
    : []), [barangays, active.hazards, resolved.hazards, stats]);

  // Derived from the open hazards themselves (as of now).
  const confidence = useMemo(() => CONFIDENCES.map((c) => ({
    key: c, label: CONFIDENCE_LABEL[c], value: active.hazards.filter((h) => h.confidence === c).length,
    color: CONFIDENCE_COLOR[c], hint: CONFIDENCE_HINT[c],
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
  const byWeekday = useMemo(() => WEEKDAYS.map((name, i) => ({
    key: name, label: name, short: name.slice(0, 3),
    value: (stats?.reportTimes ?? []).filter((c) => c.dayOfWeek === i + 1).reduce((s, c) => s + c.count, 0),
  })), [stats]);
  const byHour = useMemo(() => Array.from({ length: 24 }, (_, h) => ({
    key: String(h), label: hourName(h), short: h % 6 === 0 ? hourName(h) : '',
    value: (stats?.reportTimes ?? []).filter((c) => c.hour === h).reduce((s, c) => s + c.count, 0),
  })), [stats]);

  const metric = AREA_METRICS.find((m) => m.value === areaMetric)!;
  const areaValues = useMemo(() => new Map(areas.map((a) => [a.name, a[areaMetric] as number | null])), [areas, areaMetric]);
  const areaMax = Math.max(0, ...[...areaValues.values()].map((v) => v ?? 0));
  const heat = HEAT_LAYERS.find((l) => l.value === heatLayer)!;

  const daily = stats?.daily ?? [];
  const avg = stats?.resolution.averageHours ?? null;
  const [avgValue, avgUnit] = splitUnit(duration(avg));
  const received = daily.reduce((s, d) => s + d.newReports + d.mergedReports, 0);
  const severityCounts = Object.fromEntries(
    SEVERITIES.map((s) => [s, stats?.activeBySeverity.find((x) => x.key === s)?.count ?? 0]),
  ) as Record<Severity, number>;
  const goTo = (q: string) => navigate(`/map?tab=active&${q}`);

  return (
    <div className="page analytics">
      <PageHeader title="Analytics"
        subtitle={stats ? <>{shortDate(stats.from).replace(/,.*$/, '')} – {shortDate(stats.to).replace(/,.*$/, '')} · Open numbers are as of now</> : 'Loading…'}
        actions={
          <div className="range-picker" role="group" aria-label="Date range">
            <Segmented label="Range" options={RANGES} value={range} onChange={setRange} />
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
        } />

      {error && <ErrorState title="We couldn’t load analytics." message={error} onRetry={reload} />}

      {/* Headline numbers */}
      <div className="stat-row">
        <StatCard label="Reports received" icon={<Inbox aria-hidden="true" />} loading={!stats} value={<CountUp value={received} />}
          spark={daily.map((d) => d.newReports + d.mergedReports)} foot={stats ? <>{stats.totals.reportedInRange} new hazards</> : null} />
        <StatCard label="Resolved" icon={<CheckCircle2 aria-hidden="true" />} loading={!stats}
          value={stats ? <CountUp value={stats.totals.resolvedInRange} goodWhen="up" /> : ''} spark={daily.map((d) => d.resolved)}
          foot={stats ? <>{percent(stats.totals.resolvedInRange, stats.totals.reportedInRange)} of new hazards</> : null} />
        <StatCard label="Average time to resolve" icon={<Timer aria-hidden="true" />} loading={!stats} value={avgValue} unit={avgUnit}
          delta={percentChange(avg, stats?.resolution.previousAverageHours)} goodWhen="down" deltaNote="vs previous period"
          foot={stats && avg == null ? 'Nothing resolved in this range' : null} />
        <StatCard label="Open now" icon={<CircleDot aria-hidden="true" />} loading={!stats} value={stats ? <CountUp value={stats.totals.active} goodWhen="down" /> : ''}
          spark={daily.map((d) => d.backlog)} foot={stats ? <>{severityCounts.HIGH} high severity</> : null} to="/map?tab=active" />
      </div>

      {/* Volume */}
      <h2 className="section-title">Volume</h2>
      <div className="grid-main-side">
        <Card title={TREND_TITLE[trend]} subtitle={TREND_SUB[trend]}
          action={<Toggle value={trend} onChange={setTrend} label="Chart"
            options={[['volume', 'Reported'], ['severity', 'By severity'], ['intake', 'New vs merged']]} />}>
          {!stats ? <Skeleton h={260} /> : (
            <Swap k={`${trend}|${rangeKey}`}>
              {trend === 'volume' ? <TrendChart daily={daily} height={260} />
                : trend === 'severity' ? <SeverityMultiples daily={daily} />
                  : <IntakeChart daily={daily} height={260} />}
            </Swap>
          )}
        </Card>
        <Card title="Open by severity" subtitle="Hazards open right now">
          {stats ? <SeverityGauge counts={severityCounts} label="open" /> : <Skeleton h={220} />}
        </Card>
      </div>
      <Card title="Report pipeline"
        subtitle="From reports received to hazards resolved in this range. Verified and resolved count when they happened, so they can include older hazards.">
        {stats ? (
          <Funnel label="Report pipeline" stages={[
            { key: 'received', label: 'Reports received', value: received, hint: 'Every report submitted, duplicates included' },
            { key: 'hazards', label: 'New hazards', value: stats.totals.reportedInRange, hint: 'Reports that found a hazard not already on the map' },
            { key: 'verified', label: 'Verified', value: stats.verification.verifiedCount, hint: 'Hazards the community verified in this range' },
            { key: 'resolved', label: 'Resolved', value: stats.totals.resolvedInRange, hint: 'Hazards resolved in this range' },
          ]} />
        ) : <Skeleton h={260} />}
      </Card>

      {/* What's open now */}
      <h2 className="section-title">What’s open now</h2>
      <div className="grid-3">
        <Card title="By type" subtitle="Select one to see it on the map">
          {stats ? <BarList rows={stats.activeByType.map((t) => ({ key: t.key, label: TYPE_LABEL[t.key], value: t.count }))}
            onSelect={(type) => goTo(`type=${type}`)} empty="No open hazards" /> : <Skeleton h={200} />}
        </Card>
        <Card title="Confidence" subtitle="How well the community backs open reports">
          {active.loading ? <Skeleton h={200} /> : <SegmentBar parts={confidence} empty="No open hazards" />}
        </Card>
        <Card title="How hazards close" subtitle="Status changes in this range">
          {stats ? <Outcomes outcomes={stats.outcomes} /> : <Skeleton h={200} />}
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Community response by type" subtitle="Confirmations and disputes on open hazards">
          {active.loading ? <Skeleton h={220} />
            : <DivergingBars rows={opinions} leftLabel="Disputes" rightLabel="Confirmations" empty="No community responses yet" />}
        </Card>
        <Card title="How long they’ve been open" subtitle="Open hazards by age">
          {active.loading ? <Skeleton h={220} /> : <ColumnChart rows={ages} label="Open hazards by age" unit="open hazards" />}
        </Card>
      </div>

      {/* Speed */}
      <h2 className="section-title">Speed</h2>
      <div className="grid-2">
        <Card title={speed === 'resolve' ? 'Time to resolve by type' : 'Time to verification by type'}
          subtitle={speed === 'resolve' ? 'Report to resolved, for hazards resolved in this range' : 'Report to first verified, for hazards verified in this range'}
          action={<Toggle value={speed} onChange={setSpeed} label="Measure" options={[['resolve', 'Resolve'], ['verify', 'Verify']]} />}>
          {stats
            ? (
              <Swap k={speed}>
                <TypeDurations rows={speed === 'resolve' ? stats.resolution.byType : stats.verification.byType} what={speed === 'resolve' ? 'resolved' : 'verified'} />
              </Swap>
            )
            : <Skeleton h={200} />}
        </Card>
        <Card title="Unresolved backlog" subtitle="Open hazards at the end of each day">
          {stats ? <Swap k={rangeKey}><BacklogSteps daily={daily} height={220} /></Swap> : <Skeleton h={220} />}
        </Card>
      </div>

      {/* When */}
      <h2 className="section-title">When</h2>
      <div className="grid-2">
        <Card title="Reports by weekday" subtitle="Every report received in this range">
          {stats ? <DotColumns buckets={byWeekday} label="Reports by weekday" rows={9} /> : <Skeleton h={200} />}
        </Card>
        <Card title="Reports by hour" subtitle="Local time, all days together">
          {stats ? <DotColumns buckets={byHour} label="Reports by hour of day" rows={9} /> : <Skeleton h={200} />}
        </Card>
      </div>

      {/* Where */}
      <h2 className="section-title">Where</h2>
      <div className="grid-main-side">
        <section className="card heat-card">
          <div className="card-head">
            <div>
              <h2>{where === 'barangays' ? 'Barangays' : 'Hazard concentration'}</h2>
              <p className="card-sub">{where === 'barangays' ? 'Shaded by the measure you pick' : `Open hazards. ${heat.note}`}</p>
            </div>
            <Toggle value={where} onChange={setWhere} label="Map" options={[['barangays', 'Barangays'], ['concentration', 'Concentration']]} />
          </div>
          <Swap k={where}>
          {where === 'barangays' ? (
            <>
              <div className="map-controls-row">
                <label className="select-label">
                  <span className="sr-only">Shade by</span>
                  <select value={areaMetric} onChange={(e) => setAreaMetric(e.target.value as AreaMetric)}>
                    {AREA_METRICS.map((m) => <option key={m.value} value={m.value}>Shade by: {m.label}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTable((t) => !t)} aria-expanded={showTable}>
                  <Table2 size={15} aria-hidden="true" />{showTable ? 'Show map' : 'Show as table'}
                </button>
              </div>
              {showTable
                ? <AreaTable areas={areas} onSelect={(name) => goTo(`area=${encodeURIComponent(name)}`)} />
                : <>
                  <AreaMap barangays={barangays} values={areaValues} max={areaMax}
                    format={(v) => (v == null ? 'No data' : metric.format(v))}
                    label={`Makati barangays shaded by ${metric.label.toLowerCase()}; the table view has the same numbers`} />
                  <div className="rain-legend" aria-label="Colour scale">
                    <span className="muted">{metric.format(0)}</span>
                    <span className="rain-ramp" style={{ background: `linear-gradient(90deg, ${SEQUENTIAL_BLUE.join(', ')})` }} />
                    <span className="muted">{metric.format(areaMax)}</span>
                  </div>
                </>}
              {resolved.truncated && <p className="muted small">Resolved counts use the latest {resolved.hazards.length} resolved hazards.</p>}
            </>
          ) : (
            <>
              <div className="map-controls-row">
                <Segmented className="segmented small" label="Weighting" options={HEAT_LAYERS} value={heatLayer} onChange={setHeatLayer} />
              </div>
              <div className="heat-map">
                <MapView hazards={active.hazards} layer={heatLayer} barangays={barangays} fitKey="analytics" loading={active.loading} />
              </div>
            </>
          )}
          </Swap>
        </section>
        <div className="stack">
          <Card title="Most open hazards" subtitle="Barangays with the most, and how many are high severity">
            <ProgressRows empty="No open hazards in Makati barangays"
              rows={areas.filter((a) => a.active > 0).slice(0, 6).map((a) => ({
                key: a.name, label: a.name, value: a.active, note: a.high ? `${a.high} high` : undefined,
                hint: `${a.name}: ${a.active} open (${a.high} high, ${a.medium} medium, ${a.low} low)`,
              }))} format={(n) => `${n} open`} />
          </Card>
          <Card title="Recurring hotspots" subtitle="Places about 165 m across with repeated reports">
            {stats ? <Hotspots hotspots={stats.hotspots.slice(0, 6)} barangays={barangays} /> : <Skeleton h={180} />}
          </Card>
        </div>
      </div>
      <AreaFrequencyCard barangays={barangays} from={from} to={to} />
    </div>
  );
}

/** A small segmented control for switching one card between related views. */
function Toggle<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: [T, string][]; label: string;
}) {
  return <Segmented className="segmented small" label={label} value={value} onChange={onChange}
    options={options.map(([v, text]) => ({ value: v, label: text }))} />;
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
    { key: 'expired', label: 'Expired', value: outcomes.expired, hint: 'Nobody confirmed it for its type’s time to live; not necessarily fixed' },
    { key: 'removed', label: 'Removed', value: outcomes.removed, hint: 'Taken down as false, spam or invalid' },
    { key: 'reopened', label: 'Reopened', value: outcomes.reopened, hint: 'Came back after being marked resolved' },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  return <ProgressRows rows={rows.map((r) => ({ ...r, note: total ? percent(r.value, total) : undefined }))}
    empty="No hazards closed or reopened in this range" />;
}

function Hotspots({ hotspots, barangays }: { hotspots: Stats['hotspots']; barangays: ReturnType<typeof useBarangays> }) {
  if (!hotspots.length) return <p className="muted chart-empty">No place had repeated reports in this range</p>;
  return (
    <ProgressRows rows={hotspots.map((h, i) => {
      const street = streetAt(h.latitude, h.longitude);
      const area = barangayAt(barangays, h.latitude, h.longitude)?.name;
      const label = [street || null, area].filter(Boolean).join(' · ') || `${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}`;
      return { key: String(i), label, value: h.count, note: TYPE_LABEL[h.topType].toLowerCase(), hint: `${label}: ${h.count} reports, mostly ${TYPE_LABEL[h.topType].toLowerCase()}` };
    })} format={(n) => `${n} reports`} />
  );
}

function AreaTable({ areas, onSelect }: { areas: AreaRow[]; onSelect: (name: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th scope="col">Barangay</th><th scope="col" className="num">Open</th><th scope="col" className="num">High</th>
            <th scope="col" className="num">Resolved</th><th scope="col" className="num">Avg. age</th>
            <th scope="col" className="num" title="Resolved in the range as a share of those plus the ones still open">Resolution rate</th></tr>
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

