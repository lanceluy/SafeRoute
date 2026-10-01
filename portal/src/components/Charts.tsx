import { useId } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Stats } from '../api/types';
import { dayLabel } from '../lib/format';
import { hourLabel, type Weather } from '../lib/weather';
import { useThemeColors } from '../lib/theme';

/**
 * Categorical slots 1 and 2, from --series-1/--series-2: #2a78d6/#eb6834 on light, #3987e5/#d95926
 * on dark (both validated: every check passes against their surface).
 */
function useChartColors() {
  const c = useThemeColors();
  return {
    reported: c.series1, resolved: c.series2, fixed: c.good, grid: c.grid, surface: c.surface,
    axis: { stroke: c.axis, fontSize: 12, tickLine: false, axisLine: false },
  };
}

/**
 * Reported (blue) and resolved (green) per day as two quiet lines over a faint fill. Not animated:
 * live updates re-render the chart, and a draw-in animation would restart (and get cut off) each time.
 */
export function TrendChart({ daily, height = 240 }: { daily: Stats['daily']; height?: number }) {
  const { reported, fixed, grid, surface, axis } = useChartColors();
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  const dot = (fill: string) => (data.length <= 14 ? { r: 3, strokeWidth: 2, stroke: surface, fill } : false);
  return (
    <figure className="chart" aria-label="Hazards reported and resolved per day">
      <div className="diverging-legend chart-legend">
        <span><i className="swatch line" style={{ background: reported }} />Reported</span>
        <span><i className="swatch line" style={{ background: fixed }} />Resolved</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip content={<DayTooltip />} cursor={{ stroke: axis.stroke, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="reported" name="Reported" stroke={reported} strokeWidth={2} fill={reported} fillOpacity={0.08}
            dot={dot(reported)} activeDot={{ r: 5, stroke: surface, strokeWidth: 2 }} isAnimationActive={false} />
          <Area type="monotone" dataKey="resolved" name="Resolved" stroke={fixed} strokeWidth={2} fill={fixed} fillOpacity={0.08}
            dot={dot(fixed)} activeDot={{ r: 5, stroke: surface, strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Incoming reports per day: a new hazard, or merged into one already on the map. */
export function IntakeChart({ daily, height = 220 }: { daily: Stats['daily']; height?: number }) {
  const { reported, resolved: merged, grid, surface, axis } = useChartColors();
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  return (
    <figure className="chart" aria-label="Reports per day that created a new hazard or were merged into an existing one">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }} barCategoryGap="20%">
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip content={<IntakeTooltip />} cursor={{ fill: grid }} />
          <Legend verticalAlign="top" align="right" height={28} iconType="square" wrapperStyle={{ fontSize: 13 }} />
          {/* A 2 px surface-coloured edge separates the stacked segments. */}
          <Bar dataKey="newReports" name="New hazard" stackId="in" fill={reported} stroke={surface} strokeWidth={2} />
          <Bar dataKey="mergedReports" name="Merged into existing" stackId="in" fill={merged} stroke={surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function IntakeTooltip({ active, payload }: { active?: boolean; payload?: { payload: Stats['daily'][number] }[] }) {
  const colors = useChartColors();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const total = d.newReports + d.mergedReports;
  return (
    <div className="chart-tip">
      <strong>{new Date(`${d.date}T00:00:00`).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
      <span><i className="swatch" style={{ background: colors.reported }} />{d.newReports} new hazard{d.newReports === 1 ? '' : 's'}</span>
      <span><i className="swatch" style={{ background: colors.resolved }} />{d.mergedReports} merged{total ? ` (${Math.round((d.mergedReports / total) * 100)}%)` : ''}</span>
    </div>
  );
}

/** Vertical columns for one measure over ordered buckets (e.g. hazard age). */
export function ColumnChart({ rows, height = 220, label, unit }: {
  rows: { key: string; label: string; value: number }[]; height?: number; label: string; unit: string;
}) {
  const { reported: fill, grid, axis } = useChartColors();
  if (rows.every((r) => r.value === 0)) return <p className="muted chart-empty">No data yet</p>;
  return (
    <figure className="chart" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 16, right: 16, bottom: 0, left: -12 }} barCategoryGap={2}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} interval={0} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip cursor={{ fill: grid }} content={({ active, payload }) => (active && payload?.length
            ? <div className="chart-tip"><strong>{payload[0].payload.label}</strong><span>{payload[0].payload.value} {unit}</span></div>
            : null)} />
          <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} maxBarSize={44} label={{ position: 'top', fontSize: 12, fill: axis.stroke }} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/**
 * How often hazards were reported per day or week, for one barangay and type (the Analytics
 * selector). One series, one hue, no per-bar labels: the tooltip carries the numbers.
 */
export function FrequencyChart({ rows, height = 240, label }: {
  rows: { key: string; label: string; range: string; hazards: number; reports: number }[]; height?: number; label: string;
}) {
  const { reported: fill, grid, axis } = useChartColors();
  return (
    <figure className="chart" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 16, right: 16, bottom: 0, left: -12 }} barCategoryGap={2}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip cursor={{ fill: grid }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof rows)[number];
            return (
              <div className="chart-tip">
                <strong>{r.range}</strong>
                <span>{r.hazards} hazard{r.hazards === 1 ? '' : 's'}</span>
                {r.reports > r.hazards && <span className="muted">{r.reports} reports, duplicates included</span>}
              </div>
            );
          }} />
          <Bar dataKey="hazards" fill={fill} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function DayTooltip({ active, payload, only }: {
  active?: boolean; payload?: { payload: Stats['daily'][number] & { label: string } }[]; only?: 'backlog';
}) {
  const colors = useChartColors();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>{new Date(`${d.date}T00:00:00`).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
      {only === 'backlog'
        ? <span>{d.backlog} unresolved at day’s end</span>
        : <>
          <span><i style={{ background: colors.reported }} />{d.reported} reported</span>
          <span><i style={{ background: colors.fixed }} />{d.resolved} resolved</span>
        </>}
    </div>
  );
}

/** Rain per hour for the next 24 hours: one measure, one hue; chance of rain rides in the tooltip. */
export function RainChart({ hourly, height = 200 }: { hourly: Weather['hourly']; height?: number }) {
  const { reported: fill, grid, axis } = useChartColors();
  const data = hourly.map((h) => ({ ...h, label: hourLabel(h.time) }));
  return (
    <figure className="chart" aria-label="Expected rain per hour for the next 24 hours, in millimetres">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }} barCategoryGap={2}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
          {/* A dry day still gets a readable 0–2 mm scale instead of a flat, unlabeled axis. */}
          <YAxis {...axis} width={40} unit=" mm" domain={[0, (max: number) => Math.max(2, Math.ceil(max))]} allowDecimals={false} />
          <Tooltip content={<RainTooltip />} cursor={{ fill: grid }} />
          <Bar dataKey="precipitation" name="Rain" fill={fill} radius={[4, 4, 0, 0]} minPointSize={0} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function RainTooltip({ active, payload }: {
  active?: boolean; payload?: { payload: Weather['hourly'][number] & { label: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const h = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>{h.label}</strong>
      <span>{h.precipitation.toFixed(1)} mm of rain</span>
      <span>{h.chance}% chance of rain · {Math.round(h.temperature)}°C</span>
    </div>
  );
}

/** Ranked horizontal bars, one series, values labeled at the end. */
export function BarList({ rows, format = (n) => n.toLocaleString(), onSelect, empty = 'No data yet' }: {
  /** `color` is for meaningful colour only (severity); bars are the default blue otherwise. */
  rows: { key: string; label: string; value: number; hint?: string; color?: string }[];
  format?: (n: number) => string;
  onSelect?: (key: string) => void;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || rows.every((r) => r.value === 0)) return <p className="muted chart-empty">{empty}</p>;
  return (
    <ul className="bar-list">
      {rows.map((r) => {
        const content = (
          <>
            <span className="bar-label">{r.label}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, ...(r.color ? { background: r.color } : {}) }} /></span>
            <span className="bar-value">{format(r.value)}</span>
          </>
        );
        return (
          <li key={r.key} title={r.hint ?? `${r.label}: ${format(r.value)}`}>
            {onSelect ? <button type="button" className="bar-row" onClick={() => onSelect(r.key)}>{content}</button>
              : <div className="bar-row">{content}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Two measures that pull in opposite directions (disputes left, confirmations right) on one shared
 * scale, so bar lengths compare across both sides.
 */
export function DivergingBars({ rows, leftLabel, rightLabel, empty = 'No data yet' }: {
  rows: { key: string; label: string; left: number; right: number }[];
  leftLabel: string; rightLabel: string; empty?: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.left, r.right]));
  if (!rows.length || rows.every((r) => r.left === 0 && r.right === 0)) return <p className="muted chart-empty">{empty}</p>;
  return (
    <div className="diverging">
      <div className="diverging-legend">
        <span><i className="swatch" style={{ background: 'var(--series-2)' }} />{leftLabel}</span>
        <span><i className="swatch" style={{ background: 'var(--series-1)' }} />{rightLabel}</span>
      </div>
      <ul className="diverging-list">
        {rows.map((r) => (
          <li key={r.key} title={`${r.label}: ${r.right.toLocaleString()} ${rightLabel.toLowerCase()}, ${r.left.toLocaleString()} ${leftLabel.toLowerCase()}`}>
            <span className="bar-label">{r.label}</span>
            <span className="diverging-side left">
              <span className="diverging-value">{r.left.toLocaleString()}</span>
              <span className="diverging-fill" style={{ width: `${(r.left / max) * 100}%` }} />
            </span>
            <span className="diverging-side right">
              <span className="diverging-fill" style={{ width: `${(r.right / max) * 100}%` }} />
              <span className="diverging-value">{r.right.toLocaleString()}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Reported and resolved per day as one waveform: reported grows up from a centre line, resolved
 * grows down (drawn negative, always shown positive), over a faint grey envelope of nearby peaks.
 * Blue/green validated in both themes (CVD ΔE ≥ 23); the tooltip adds the day's net backlog.
 */
export function ActivityWave({ daily, height = 200 }: { daily: Stats['daily']; height?: number }) {
  const id = useId().replace(/:/g, '');
  const { axis } = useChartColors();
  // The grey envelope is each side's local peak (two days either way): depth around real activity,
  // and nothing below the line on days near no resolutions.
  const near = (i: number, key: 'reported' | 'resolved') =>
    Math.max(...daily.slice(Math.max(0, i - 2), i + 3).map((d) => d[key]));
  const data = daily.map((d, i) => ({
    ...d, label: dayLabel(d.date), up: d.reported, down: -d.resolved,
    envUp: near(i, 'reported'), envDown: -near(i, 'resolved'),
  }));
  const m = Math.max(1, ...data.map((d) => d.envUp)) * 1.08;
  const bar = { radius: 3, maxBarSize: 9, isAnimationActive: false } as const;
  return (
    <figure className="chart wave" aria-label="Hazards reported (up) and resolved (down) per day">
      <span className="wave-tag up" aria-hidden="true">Reported ↑</span>
      <span className="wave-tag down" aria-hidden="true">Resolved ↓</span>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} stackOffset="sign" barCategoryGap="22%">
          <defs>
            <linearGradient id={`up-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--wave-up-top)' }} />
              <stop offset="1" style={{ stopColor: 'var(--wave-up)' }} />
            </linearGradient>
            <linearGradient id={`down-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--wave-down)' }} />
              <stop offset="1" style={{ stopColor: 'var(--wave-down-bottom)' }} />
            </linearGradient>
          </defs>
          <XAxis xAxisId="env" dataKey="label" hide />
          <XAxis dataKey="label" stroke={axis.stroke} fontSize={12} tickLine={false} axisLine={false}
            interval="preserveStartEnd" minTickGap={36} />
          <YAxis hide domain={[-m, m]} />
          {/* Two faint guides behind the bars, and a firmer zero line; no other grid. */}
          <CartesianGrid vertical={false} stroke="var(--wave-grid)"
            horizontalCoordinatesGenerator={({ height: h, offset }) => {
              const top = offset.top ?? 0, plot = h - top - (offset.bottom ?? 0);
              return [top + plot * 0.25, top + plot * 0.75];
            }} />
          <Tooltip content={<WaveTooltip />} cursor={{ fill: 'var(--wave-cursor)' }} />
          <Bar xAxisId="env" dataKey="envUp" stackId="env" fill="var(--wave-env)" {...bar} />
          <Bar xAxisId="env" dataKey="envDown" stackId="env" fill="var(--wave-env)" {...bar} />
          <Bar dataKey="up" stackId="flow" fill={`url(#up-${id})`} {...bar} />
          <Bar dataKey="down" stackId="flow" fill={`url(#down-${id})`} fillOpacity={0.8} {...bar} />
          <ReferenceLine y={0} stroke="var(--wave-zero)" strokeWidth={1.5} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function WaveTooltip({ active, payload }: { active?: boolean; payload?: { payload: Stats['daily'][number] }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const net = d.reported - d.resolved;
  return (
    <div className="chart-tip wave-tip">
      <strong>{new Date(`${d.date}T00:00:00`).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
      <span><i style={{ background: 'var(--wave-up)' }} />Reported<b>{d.reported}</b></span>
      <span><i style={{ background: 'var(--wave-down)' }} />Resolved<b>{d.resolved}</b></span>
      <span className={`wave-net${net < 0 ? ' good' : net > 0 ? ' up' : ''}`}>Net backlog<b>{net > 0 ? '+' : net < 0 ? '−' : ''}{Math.abs(net)}</b></span>
    </div>
  );
}
