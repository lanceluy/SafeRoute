import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useChartReveal } from '../lib/motion';

/** Page title, one line of context under it, and the page's own actions on the right. */
export function PageHeader({ eyebrow, title, subtitle, actions }: {
  eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, action, className, children }: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Small label → large value → change or note, with an optional sparkline beside the value.
 * `delta` is a percentage; `goodWhen` says which direction is good news.
 */
export function StatCard({ label, icon, value, unit, loading, to, delta, goodWhen = 'up', deltaNote, foot, spark }: {
  label: string; icon?: ReactNode; value: ReactNode; unit?: string; loading?: boolean; to?: string;
  delta?: number | null; goodWhen?: 'up' | 'down'; deltaNote?: string; foot?: ReactNode; spark?: number[];
}) {
  const body = (
    <>
      <span className="stat-label">{icon}{label}</span>
      <span className="stat-main">
        <span className="stat-value">
          {loading ? <span className="skeleton" style={{ width: 72, height: 30, display: 'inline-block' }} /> : value}
          {!loading && unit && <span className="stat-unit">{unit}</span>}
        </span>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </span>
      {(delta != null || foot) && (
        <span className="stat-foot">
          {delta != null && <Delta value={delta} goodWhen={goodWhen} />}
          {delta != null && deltaNote}
          {foot}
        </span>
      )}
    </>
  );
  return to ? <Link to={to} className="stat">{body}</Link> : <div className="stat">{body}</div>;
}

export function Delta({ value, goodWhen = 'up' }: { value: number; goodWhen?: 'up' | 'down' }) {
  if (value === 0) return <span className="delta flat"><Minus aria-hidden="true" />0%</span>;
  const up = value > 0;
  const good = up === (goodWhen === 'up');
  return (
    <span className={`delta ${good ? 'good' : 'bad'}`}>
      {up ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}
      <span className="sr-only">{up ? 'up' : 'down'} </span>{Math.abs(value)}%
    </span>
  );
}

/** A tiny trend line: texture, not a chart, so it carries no axes and is hidden from screen readers. */
export function Sparkline({ values, width = 96, height = 34 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const step = width / (values.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${points.join(' L')}`;
  const last = values.length - 1;
  const { ref, reveal } = useChartReveal();
  return (
    <svg ref={ref} className={`sparkline${reveal ? ' reveal' : ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${line} L${width},${height} L0,${height} Z`} className="spark-fill" fill="currentColor" opacity="0.08" />
      <path d={line} pathLength={1} className="spark-line" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last * step} cy={y(values[last])} r="2.75" className="spark-dot" fill="currentColor" />
    </svg>
  );
}

/** Percentage change, or null when there's nothing to compare against. */
export function percentChange(now: number | null | undefined, before: number | null | undefined) {
  if (now == null || !before) return null;
  return Math.round(((now - before) / before) * 100);
}
