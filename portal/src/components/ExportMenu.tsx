import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Department, Hazard, Stats } from '../api/types';
import { hazardRows, downloadCsv } from '../lib/export';
import { duration, fullDate, plural } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { useToast } from '../state/toast';
import { Menu } from './Menu';

/** CSV of the hazards in view, or a printable report (the browser's Save as PDF). */
export function ExportMenu({ hazards, title, barangays, departments, stats }: {
  hazards: Hazard[]; title: string; barangays: Barangay[]; departments: Department[]; stats: Stats | null;
}) {
  const toast = useToast();
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    // Let the report render before the print dialog snapshots the page.
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);

  const none = hazards.length === 0;
  return (
    <>
      <Menu label="Export" align="right" trigger={<span className="btn btn-secondary btn-sm">Export ▾</span>} items={[
        {
          label: 'CSV spreadsheet', hint: none ? 'Nothing to export' : plural(hazards.length, 'hazard'), disabled: none,
          onSelect: () => {
            downloadCsv(hazards, barangays, departments, title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
            toast({ kind: 'success', message: `Exported ${plural(hazards.length, 'hazard')}` });
          },
        },
        { label: 'PDF report', hint: 'Summary and table, for meetings', disabled: none, onSelect: () => setPrinting(true) },
      ]} />
      {printing && createPortal(
        <PrintReport hazards={hazards} title={title} barangays={barangays} departments={departments} stats={stats} />,
        document.body,
      )}
    </>
  );
}

function countBy<T extends string>(items: T[]) {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function PrintReport({ hazards, title, barangays, departments, stats }: {
  hazards: Hazard[]; title: string; barangays: Barangay[]; departments: Department[]; stats: Stats | null;
}) {
  const rows = hazardRows(hazards, barangays, departments);
  const bySeverity = countBy(hazards.map((h) => SEVERITY_LABEL[h.severity]));
  const byType = countBy(hazards.map((h) => TYPE_LABEL[h.type]));
  const byArea = countBy(rows.map((r) => r.Barangay || 'Outside Makati')).slice(0, 8);
  const byDepartment = countBy(rows.map((r) => r.Department));
  const rate = stats && stats.totals.reportedInRange
    ? `${Math.round((stats.totals.resolvedInRange / stats.totals.reportedInRange) * 100)}%` : '—';

  return (
    <div className="print-report">
      <header>
        <img src="/logo-mark.png" alt="" width={28} height={33} />
        <div>
          <h1>SafeRoute hazard report · Makati City</h1>
          <p>{title} · {plural(hazards.length, 'hazard')} · Generated {fullDate(new Date().toISOString())}</p>
        </div>
      </header>

      {stats && (
        <section className="print-kpis">
          <div><strong>{stats.totals.active}</strong><span>Active hazards</span></div>
          <div><strong>{stats.totals.highSeverity}</strong><span>High severity</span></div>
          <div><strong>{stats.totals.resolvedInRange}</strong><span>Resolved, last 7 days</span></div>
          <div><strong>{rate}</strong><span>Resolution rate</span></div>
          <div><strong>{duration(stats.resolution.averageHours)}</strong><span>Avg. time to resolve</span></div>
        </section>
      )}

      <section className="print-summary">
        <Summary title="By severity" rows={bySeverity} />
        <Summary title="By type" rows={byType} />
        <Summary title="By barangay" rows={byArea} />
        <Summary title="By department" rows={byDepartment} />
      </section>

      <table>
        <thead>
          <tr>{['Ref.', 'Type', 'Severity', 'Status', 'Department', 'Priority', 'Location', 'Reported'].map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.Reference + r.Latitude}>
              <td>{r.Reference}</td><td>{r.Type}</td><td>{r.Severity}</td><td>{r.Status}</td>
              <td>{r.Department}</td><td>{r['City priority'] || '—'}</td>
              <td>{[r.Street, r.Barangay].filter(Boolean).join(', ') || `${r.Latitude}, ${r.Longitude}`}</td>
              <td>{new Date(r.Reported).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div>
      <h2>{title}</h2>
      <dl>{rows.map(([k, n]) => <div key={k}><dt>{k}</dt><dd>{n}</dd></div>)}</dl>
    </div>
  );
}
