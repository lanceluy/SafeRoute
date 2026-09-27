import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Stats } from '../api/types';
import { dayLabel } from '../lib/format';
import { useThemeColors } from '../lib/theme';

/**
 * Categorical slots 1 and 2, from --series-1/--series-2: #2a78d6/#eb6834 on light, #3987e5/#d95926
 * on dark (both validated: every check passes against their surface).
 */
function useChartColors() {
  const c = useThemeColors();
  return {
    reported: c.series1, resolved: c.series2, grid: c.grid, surface: c.surface,
    axis: { stroke: c.axis, fontSize: 12, tickLine: false, axisLine: false },
  };
}

/** Reported vs resolved per day: both are counts, so they share one axis. */
export function TrendChart({ daily, height = 240 }: { daily: Stats['daily']; height?: number }) {
  const { reported, resolved, grid, surface, axis } = useChartColors();
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  return (
    <figure className="chart" aria-label="Hazards reported and resolved per day">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip content={<DayTooltip />} cursor={{ stroke: axis.stroke, strokeDasharray: '3 3' }} />
          <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 13 }} />
          <Line type="monotone" dataKey="reported" name="Reported" stroke={reported} strokeWidth={2}
            dot={data.length <= 14 ? { r: 4, strokeWidth: 2, stroke: surface, fill: reported } : false} activeDot={{ r: 5, stroke: surface, strokeWidth: 2 }} />
          <Line type="monotone" dataKey="resolved" name="Resolved" stroke={resolved} strokeWidth={2}
            dot={data.length <= 14 ? { r: 4, strokeWidth: 2, stroke: surface, fill: resolved } : false} activeDot={{ r: 5, stroke: surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Hazards still open at the end of each day. */
export function BacklogChart({ daily, height = 200 }: { daily: Stats['daily']; height?: number }) {
  const { reported, grid, surface, axis } = useChartColors();
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  return (
    <figure className="chart" aria-label="Unresolved backlog at the end of each day">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip content={<DayTooltip only="backlog" />} cursor={{ stroke: axis.stroke, strokeDasharray: '3 3' }} />
          <Line type="monotone" dataKey="backlog" name="Unresolved" stroke={reported} strokeWidth={2}
            dot={false} activeDot={{ r: 5, stroke: surface, strokeWidth: 2 }} />
        </LineChart>
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
          <span><i style={{ background: colors.resolved }} />{d.resolved} resolved</span>
        </>}
    </div>
  );
}

/** Ranked horizontal bars, one series, values labeled at the end. */
export function BarList({ rows, format = (n) => n.toLocaleString(), onSelect, empty = 'No data yet' }: {
  rows: { key: string; label: string; value: number; hint?: string }[];
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
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
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
