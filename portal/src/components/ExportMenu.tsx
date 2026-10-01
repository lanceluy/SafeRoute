import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Department, Hazard, Stats } from '../api/types';
import { downloadCsv, hazardRows, reportNumber, type ExportMeta } from '../lib/export';
import { duration, fullDate, plural } from '../lib/format';
import type { Barangay } from '../lib/geo';
import { SEVERITY_LABEL, TYPE_LABEL } from '../lib/hazards';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { Menu, type MenuItem } from './Menu';
import { Chevron } from './Chevron';

interface ExportSource {
  hazards: Hazard[]; title: string; barangays: Barangay[]; departments: Department[]; stats: Stats | null;
  /** Active filters and search, as readable labels; printed under Scope. */
  filters?: string[];
}

/**
 * Export actions for a list of hazards: a CSV download, or a printable report (the browser's Save
 * as PDF). Returns menu items plus the report element, which must be rendered while printing.
 */
export function useExport({ hazards, title, barangays, departments, stats, filters = [] }: ExportSource): { items: MenuItem[]; element: ReactNode } {
  const toast = useToast();
  const session = useSession();
  const [printing, setPrinting] = useState<ExportMeta | null>(null);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    // Let the report render before the print dialog snapshots the page.
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);

  const meta = (): ExportMeta => ({
    scope: [title, ...filters].join(' · '),
    preparedBy: session ? `${session.displayName} (${session.email})` : 'Municipal staff',
    generatedAt: new Date(),
  });
  const none = hazards.length === 0;
  return {
    items: [
      {
        label: 'CSV spreadsheet', hint: none ? 'Nothing to export' : plural(hazards.length, 'hazard'), disabled: none,
        onSelect: () => {
          downloadCsv(hazards, barangays, departments, meta(), title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
          toast({ kind: 'success', message: `Exported ${plural(hazards.length, 'hazard')}` });
        },
      },
      { label: 'PDF report', hint: 'Formal report with summary, for meetings and filing', disabled: none, onSelect: () => setPrinting(meta()) },
    ],
    element: printing
      ? createPortal(<PrintReport hazards={hazards} meta={printing} barangays={barangays} departments={departments} stats={stats} />, document.body)
      : null,
  };
}

/** An Export ▾ button (used by the selection bar). */
export function ExportMenu(props: ExportSource) {
  const { items, element } = useExport(props);
  return (
    <>
      <Menu label="Export" align="right" trigger={<span className="btn btn-secondary btn-sm">Export<Chevron /></span>} items={items} />
      {element}
    </>
  );
}

function countBy<T extends string>(items: T[]) {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function PrintReport({ hazards, meta, barangays, departments, stats }: {
  hazards: Hazard[]; meta: ExportMeta; barangays: Barangay[]; departments: Department[]; stats: Stats | null;
}) {
  const rows = hazardRows(hazards, barangays, departments);
  const total = hazards.length;
  const bySeverity = countBy(hazards.map((h) => SEVERITY_LABEL[h.severity]));
  const byStatus = countBy(rows.map((r) => r.Status));
  const byType = countBy(hazards.map((h) => TYPE_LABEL[h.type]));
  const byArea = countBy(rows.map((r) => r.Barangay || 'Outside Makati')).slice(0, 8);
  const byDepartment = countBy(rows.map((r) => r['Assigned department']));
  const rate = stats && stats.totals.reportedInRange
    ? `${Math.round((stats.totals.resolvedInRange / stats.totals.reportedInRange) * 100)}%` : '—';
  const generated = meta.generatedAt.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <div className="print-report">
      <header className="print-letterhead">
        <img src="/logo-mark.png" alt="" width={36} height={36} />
        <div className="print-org">
          <p className="print-kicker">Makati City · Municipal Hazard Monitoring</p>
          <h1>SafeRoute Municipal Hazard Report</h1>
        </div>
        <dl className="print-ref">
          <div><dt>Report no.</dt><dd>{reportNumber(meta.generatedAt)}</dd></div>
          <div><dt>Date generated</dt><dd>{generated}</dd></div>
        </dl>
      </header>

      <table className="print-details">
        <tbody>
          <tr><th>Scope</th><td>{meta.scope}</td></tr>
          <tr><th>Prepared by</th><td>{meta.preparedBy}</td></tr>
          <tr><th>Hazards listed</th><td>{plural(total, 'hazard')}</td></tr>
        </tbody>
      </table>

      {stats && (
        <section>
          <h2 className="print-h2">1. City-wide summary</h2>
          <div className="print-kpis">
            <div><strong>{stats.totals.active}</strong><span>Active hazards</span></div>
            <div><strong>{stats.totals.highSeverity}</strong><span>High severity</span></div>
            <div><strong>{stats.totals.resolvedInRange}</strong><span>Resolved in the period</span></div>
            <div><strong>{rate}</strong><span>Resolution rate</span></div>
            <div><strong>{duration(stats.resolution.averageHours)}</strong><span>Average time to resolve</span></div>
          </div>
          <p className="print-note">Period: {fullDate(stats.from)} to {fullDate(stats.to)}.</p>
        </section>
      )}

      <section>
        <h2 className="print-h2">{stats ? '2.' : '1.'} Breakdown of hazards listed</h2>
        <div className="print-summary">
          <Summary title="By severity" rows={bySeverity} total={total} />
          <Summary title="By status" rows={byStatus} total={total} />
          <Summary title="By hazard type" rows={byType} total={total} />
          <Summary title="By barangay" rows={byArea} total={total} />
          <Summary title="By department" rows={byDepartment} total={total} />
        </div>
      </section>

      <section>
        <h2 className="print-h2">{stats ? '3.' : '2.'} Hazard register</h2>
        <table className="print-register">
          <thead>
            <tr>{['No.', 'Ref.', 'Hazard type', 'Severity', 'Status', 'Department', 'Priority', 'Location', 'Reports', 'Date reported'].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={hazards[i].id}>
                <td>{r['No.']}</td><td>{r.Reference}</td><td>{r['Hazard type']}</td><td>{r.Severity}</td><td>{r.Status}</td>
                <td>{r['Assigned department']}</td><td>{r['City priority'] || '—'}</td>
                <td>{[r.Street, r.Barangay].filter(Boolean).join(', ') || `${r.Latitude}, ${r.Longitude}`}</td>
                <td className="num">{r['Reports combined']}</td>
                <td>{new Date(hazards[i].createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="print-signoff">
        <p className="print-note">
          Hazards are reported by commuters through the SafeRoute app and confirmed by other commuters. Matching reports
          within 30 m are combined into one. “Archived” means no staff action within 7 days of the report.
        </p>
        <div className="print-signatures">
          <div><span className="line" /><span>Prepared by</span></div>
          <div><span className="line" /><span>Reviewed and approved by</span></div>
          <div><span className="line" /><span>Date</span></div>
        </div>
      </section>
    </div>
  );
}

function Summary({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <table className="print-breakdown">
      <thead><tr><th>{title}</th><th className="num">No.</th><th className="num">%</th></tr></thead>
      <tbody>
        {rows.map(([k, n]) => (
          <tr key={k}><td>{k}</td><td className="num">{n}</td><td className="num">{total ? Math.round((n / total) * 100) : 0}%</td></tr>
        ))}
      </tbody>
    </table>
  );
}
