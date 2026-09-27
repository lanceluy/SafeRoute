import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Stats } from '../api/types';
import { dayLabel } from '../lib/format';

/** Categorical slots 1 and 2 (validated: CVD ΔE 24.7, all checks pass on the light surface). */
export const SERIES = { reported: '#2a78d6', resolved: '#eb6834' };

const axis = { stroke: '#98A2B3', fontSize: 12, tickLine: false, axisLine: false };

/** Reported vs resolved per day: both are counts, so they share one axis. */
export function TrendChart({ daily, height = 240 }: { daily: Stats['daily']; height?: number }) {
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  return (
    <figure className="chart" aria-label="Hazards reported and resolved per day">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#EEF2F7" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip content={<DayTooltip />} cursor={{ stroke: '#98A2B3', strokeDasharray: '3 3' }} />
          <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 13, color: '#475467' }} />
          <Line type="monotone" dataKey="reported" name="Reported" stroke={SERIES.reported} strokeWidth={2}
            dot={data.length <= 14 ? { r: 4, strokeWidth: 2, stroke: '#fff', fill: SERIES.reported } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
          <Line type="monotone" dataKey="resolved" name="Resolved" stroke={SERIES.resolved} strokeWidth={2}
            dot={data.length <= 14 ? { r: 4, strokeWidth: 2, stroke: '#fff', fill: SERIES.resolved } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Hazards still open at the end of each day. */
export function BacklogChart({ daily, height = 200 }: { daily: Stats['daily']; height?: number }) {
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  return (
    <figure className="chart" aria-label="Unresolved backlog at the end of each day">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#EEF2F7" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <Tooltip content={<DayTooltip only="backlog" />} cursor={{ stroke: '#98A2B3', strokeDasharray: '3 3' }} />
          <Line type="monotone" dataKey="backlog" name="Unresolved" stroke={SERIES.reported} strokeWidth={2}
            dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

function DayTooltip({ active, payload, only }: {
  active?: boolean; payload?: { payload: Stats['daily'][number] & { label: string } }[]; only?: 'backlog';
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>{new Date(`${d.date}T00:00:00`).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
      {only === 'backlog'
        ? <span>{d.backlog} unresolved at day’s end</span>
        : <>
          <span><i style={{ background: SERIES.reported }} />{d.reported} reported</span>
          <span><i style={{ background: SERIES.resolved }} />{d.resolved} resolved</span>
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
