// Analytics-only chart forms drawn by hand (SVG / HTML) where Recharts has no equivalent: the report
// funnel, the severity gauge, segmented and progress bars, dot-matrix columns and severity multiples.
// Severity hues are status colours, not a categorical palette (they fail the CVD checks as a set),
// so every severity mark here carries its label and number beside it.
import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Severity, Stats } from '../api/types';
import { dayLabel } from '../lib/format';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../lib/hazards';
import { useThemeColors } from '../lib/theme';

function pct(n: number, of: number) {
  return of ? Math.round((n / of) * 100) : 0;
}

// ------------------------------------------------------------------ funnel

/**
 * Stages as columns with a flowing band whose height is each stage's count, and the change from
 * one stage to the next in a chip on the boundary. Later stages can outgrow earlier ones (they're
 * counted by when they happened), so a chip can read "+".
 */
export function Funnel({ stages, label }: { stages: { key: string; label: string; value: number; hint?: string }[]; label: string }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 200, mid = H / 2, maxH = 86;
  const max = Math.max(1, ...stages.map((s) => s.value));
  const n = stages.length;
  const half = (v: number) => Math.max(5, (v / max) * maxH);
  const xs = stages.map((_, i) => ((i + 0.5) * W) / n);
  const pts = [{ x: 0, h: half(stages[0].value) }, ...stages.map((s, i) => ({ x: xs[i], h: half(s.value) })), { x: W, h: half(stages[n - 1].value) }];
  // Smooth S-curves between points: horizontal tangents at each column centre.
  const edge = (sign: 1 | -1, list: typeof pts) => list.map((p, i) => {
    const y = mid + sign * p.h;
    if (i === 0) return `${sign === -1 ? 'M' : 'L'}${p.x},${y}`;
    const prev = list[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `C${cx},${mid + sign * prev.h} ${cx},${y} ${p.x},${y}`;
  }).join(' ');
  const d = `${edge(-1, pts)} ${edge(1, [...pts].reverse())} Z`;

  return (
    <figure className="funnel" aria-label={`${label}: ${stages.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
      <div className="funnel-cols" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {stages.map((s, i) => (
          <div key={s.key} className={`funnel-col${hover === i ? ' hover' : ''}`} title={s.hint}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="funnel-label">{s.label}</span>
            <strong className="funnel-value">{s.value.toLocaleString()}</strong>
            {i > 0 && <span className="funnel-share">{pct(s.value, stages[0].value)}% of {stages[0].label.toLowerCase()}</span>}
          </div>
        ))}
      </div>
      <svg className="funnel-band" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`fg-${id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--funnel-from)' }} />
            <stop offset="1" style={{ stopColor: 'var(--funnel-to)' }} />
          </linearGradient>
        </defs>
        <path d={d} fill={`url(#fg-${id})`} />
      </svg>
      <div className="funnel-chips" aria-hidden="true">
        {stages.slice(1).map((s, i) => {
          const prev = stages[i].value;
          const change = prev ? Math.round(((s.value - prev) / prev) * 100) : 0;
          return (
            <span key={s.key} className="funnel-chip" style={{ left: `${((i + 1) * 100) / n}%` }}>
              {change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change)}% →
            </span>
          );
        })}
      </div>
    </figure>
  );
}

// ------------------------------------------------------------------ severity gauge

/** A half-ring split by severity, the total in the middle, and a labelled list beside it. */
export function SeverityGauge({ counts, label = 'active' }: { counts: Record<Severity, number>; label?: string }) {
  const order: Severity[] = ['HIGH', 'MEDIUM', 'LOW'];
  const total = order.reduce((s, k) => s + counts[k], 0);
  // Degrees between segments: the round caps reach ~5.5° past each end, so the gap must clear both.
  const R = 84, cx = 100, cy = 100, gap = 14;
  const shown = order.filter((k) => counts[k] > 0);
  const span = 180 - gap * Math.max(0, shown.length - 1);
  let at = 180;
  const arc = (from: number, to: number) => {
    const p = (deg: number) => [cx + R * Math.cos((deg * Math.PI) / 180), cy - R * Math.sin((deg * Math.PI) / 180)];
    const [x1, y1] = p(from), [x2, y2] = p(to);
    return `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2}`;
  };
  return (
    <div className="gauge">
      <figure className="gauge-figure" aria-label={`${total} ${label}: ${order.map((k) => `${counts[k]} ${SEVERITY_LABEL[k].toLowerCase()}`).join(', ')}`}>
        <svg viewBox="0 0 200 112" aria-hidden="true">
          <path d={arc(180, 0)} className="gauge-track" />
          {total > 0 && shown.map((k) => {
            const sweep = (counts[k] / total) * span;
            const from = at, to = at - sweep;
            at = to - gap;
            return <path key={k} d={arc(from, Math.min(from - 0.5, to))} stroke={SEVERITY_COLOR[k]} className="gauge-seg" />;
          })}
        </svg>
        <figcaption className="gauge-center">
          <strong>{total.toLocaleString()}</strong>
          <span>{label}</span>
        </figcaption>
      </figure>
      <ul className="legend-rows">
        {order.map((k) => (
          <li key={k}>
            <span className="legend-dot" style={{ background: SEVERITY_COLOR[k] }} aria-hidden="true" />
            <span className="legend-name">{SEVERITY_LABEL[k]}</span>
            <span className="legend-leader" aria-hidden="true" />
            <strong>{counts[k]}</strong>
            <span className="legend-pct">{pct(counts[k], total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ segmented bar

/** Part-to-whole as one bar with 2 px gaps, and a labelled row per part underneath. */
export function SegmentBar({ parts, empty = 'No data yet' }: {
  parts: { key: string; label: string; value: number; color: string; hint?: string }[]; empty?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="muted chart-empty">{empty}</p>;
  return (
    <div className="segment">
      <div className="segment-bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value} (${pct(p.value, total)}%)`} />
        ))}
      </div>
      <ul className="legend-rows">
        {parts.map((p) => (
          <li key={p.key} title={p.hint}>
            <span className="legend-dot square" style={{ background: p.color }} aria-hidden="true" />
            <span className="legend-name">{p.label}</span>
            <span className="legend-leader" aria-hidden="true" />
            <strong>{p.value}</strong>
            <span className="legend-pct">{pct(p.value, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ progress rows

/** Label and number over a thin bar, one row per item (one hue: the rows are one measure). */
export function ProgressRows({ rows, format = (n) => n.toLocaleString(), empty = 'No data yet' }: {
  rows: { key: string; label: string; value: number; hint?: string; note?: string }[]; format?: (n: number) => string; empty?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!max) return <p className="muted chart-empty">{empty}</p>;
  return (
    <ul className="progress-rows">
      {rows.map((r) => (
        <li key={r.key} title={r.hint}>
          <span className="progress-head">
            <span>{r.label}{r.note && <span className="muted"> · {r.note}</span>}</span>
            <strong>{format(r.value)}</strong>
          </span>
          <span className="progress-track"><span style={{ width: `${(r.value / max) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ dot matrix

/**
 * Columns of dots, one per bucket (weekday, hour), with the busiest column in the accent and a
 * "Peak" tag over it. Dots are rounded down to a fixed grid; the hover title has the exact count.
 */
export function DotColumns({ buckets, rows = 8, unit = 'reports', label }: {
  buckets: { key: string; label: string; short?: string; value: number }[]; rows?: number; unit?: string; label: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...buckets.map((b) => b.value));
  if (!max) return <p className="muted chart-empty">No reports in this range</p>;
  const peak = buckets.reduce((a, b) => (b.value > a.value ? b : a));
  const shown = hover ? buckets.find((b) => b.key === hover)! : peak;
  return (
    <figure className="dots" aria-label={`${label}. Busiest: ${peak.label}, ${peak.value} ${unit}. ${buckets.map((b) => `${b.label} ${b.value}`).join(', ')}`}>
      <div className="dots-readout" aria-hidden="true">
        <span className="dots-tag">{hover ? shown.label : `Peak: ${peak.label}`}</span>
        <strong>{shown.value.toLocaleString()}</strong> <span className="muted">{unit}</span>
      </div>
      <div className="dots-grid" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        {buckets.map((b) => {
          const on = b.value ? Math.max(1, Math.round((b.value / max) * rows)) : 0;
          const isPeak = b.key === peak.key;
          return (
            <div key={b.key} className={`dots-col${isPeak ? ' peak' : ''}${hover === b.key ? ' hover' : ''}`}
              title={`${b.label}: ${b.value} ${unit}`} onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover(null)}>
              {Array.from({ length: rows }, (_, i) => <i key={i} className={rows - i <= on ? 'on' : undefined} />)}
              <span className="dots-label">{b.short ?? b.label}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

// ------------------------------------------------------------------ severity small multiples

/** One small area chart per severity, each labelled with its total: no telling series apart by hue. */
export function SeverityMultiples({ daily }: { daily: Stats['daily'] }) {
  const { grid, surface } = useThemeColors();
  const rows: { key: Severity; field: 'reportedHigh' | 'reportedMedium' | 'reportedLow' }[] = [
    { key: 'HIGH', field: 'reportedHigh' }, { key: 'MEDIUM', field: 'reportedMedium' }, { key: 'LOW', field: 'reportedLow' },
  ];
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  const max = Math.max(1, ...daily.flatMap((d) => [d.reportedHigh, d.reportedMedium, d.reportedLow]));
  return (
    <div className="multiples">
      {rows.map((r) => {
        const total = daily.reduce((s, d) => s + d[r.field], 0);
        return (
          <div key={r.key} className="multiple">
            <div className="multiple-head">
              <span className="legend-dot" style={{ background: SEVERITY_COLOR[r.key] }} aria-hidden="true" />
              <span>{SEVERITY_LABEL[r.key]}</span>
              <strong>{total}</strong>
            </div>
            <ResponsiveContainer width="100%" height={56}>
              <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={grid} vertical={false} horizontal={false} />
                <YAxis hide domain={[0, max]} />
                <XAxis dataKey="label" hide />
                <Tooltip cursor={{ stroke: grid }} content={({ active, payload }) => (active && payload?.length
                  ? <div className="chart-tip"><strong>{payload[0].payload.label}</strong>
                    <span>{payload[0].value} {SEVERITY_LABEL[r.key].toLowerCase()} severity</span></div>
                  : null)} />
                <Area type="monotone" dataKey={r.field} stroke={SEVERITY_COLOR[r.key]} strokeWidth={2} fill={SEVERITY_COLOR[r.key]}
                  fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: surface, strokeWidth: 2 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })}
      <p className="muted small">Same scale in all three, so the heights compare.</p>
    </div>
  );
}

// ------------------------------------------------------------------ backlog steps

/** Unresolved hazards at each day's end as steps: the backlog only moves when something changes. */
export function BacklogSteps({ daily, height = 200 }: { daily: Stats['daily']; height?: number }) {
  const { series1, grid, surface, axis } = useThemeColors();
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  return (
    <figure className="chart" aria-label="Unresolved backlog at the end of each day">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" stroke={axis} fontSize={12} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} stroke={axis} fontSize={12} tickLine={false} axisLine={false} width={40} />
          <Tooltip cursor={{ stroke: axis }} content={({ active, payload }) => (active && payload?.length
            ? <div className="chart-tip"><strong>{payload[0].payload.label}</strong><span>{payload[0].payload.backlog} unresolved at day’s end</span></div>
            : null)} />
          <Area type="stepAfter" dataKey="backlog" stroke={series1} strokeWidth={2} fill={series1} fillOpacity={0.1}
            dot={false} activeDot={{ r: 4, stroke: surface, strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
