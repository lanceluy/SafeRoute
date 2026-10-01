import { useMemo, useState } from 'react';
import { HAZARD_TYPES, type HazardStatus, type HazardType, type QueueQuery } from '../api/types';
import { plural } from '../lib/format';
import { contains, type Barangay } from '../lib/geo';
import { TYPE_LABEL } from '../lib/hazards';
import { useQueue } from '../state/useQueue';
import { FrequencyChart } from './Charts';

/** Removed reports were never real hazards, so they don't count toward how often hazards appear. */
const COUNTED: HazardStatus[] = ['REPORTED', 'VERIFIED', 'DISPUTED', 'RESOLVED', 'EXPIRED'];
const DAY = 86_400_000;
const ALL = 'ALL';

/** Local midnight of `t`, or of the Monday of its week. */
function bucketStart(t: number, weekly: boolean) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (weekly) d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const short = (t: number) => new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric' });

/**
 * Task 2, revision 7: one graph of how often hazards appear in an area, narrowed by barangay and
 * hazard type. Days for ranges up to a month, weeks beyond that.
 */
export function AreaFrequencyCard({ barangays, from, to }: { barangays: Barangay[]; from: string; to?: string }) {
  const [area, setArea] = useState(ALL);
  const [type, setType] = useState<HazardType | typeof ALL>(ALL);
  const selected = area === ALL ? undefined : barangays.find((b) => b.name === area);

  const query = useMemo<QueueQuery>(() => ({
    statuses: COUNTED, from, to, sort: 'newest',
    types: type === ALL ? undefined : [type],
    bbox: selected?.bbox,
  }), [from, to, type, selected]);
  const queue = useQueue(query, 3000);

  const { rows, hazards, reports, topTypes } = useMemo(() => {
    const inArea = selected ? queue.hazards.filter((h) => contains(selected, h.latitude, h.longitude)) : queue.hazards;
    const start = Date.parse(from);
    const end = to ? Date.parse(to) : Date.now();
    const weekly = end - start > 31 * DAY;
    const buckets = new Map<number, { hazards: number; reports: number }>();
    for (let t = bucketStart(start, weekly); t < end; t += (weekly ? 7 : 1) * DAY) {
      buckets.set(t, { hazards: 0, reports: 0 }); // Manila has no daylight saving, so days are 24 h
    }
    for (const h of inArea) {
      const b = buckets.get(bucketStart(Date.parse(h.createdAt), weekly));
      if (!b) continue;
      b.hazards++;
      b.reports += h.mergedReportCount + 1;
    }
    const rows = [...buckets].map(([t, v]) => ({
      key: String(t),
      label: short(t),
      range: weekly ? `Week of ${short(t)}` : new Date(t).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
      ...v,
    }));
    const byType = new Map<HazardType, number>();
    for (const h of inArea) byType.set(h.type, (byType.get(h.type) ?? 0) + 1);
    const topTypes = [...byType].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { rows, hazards: inArea.length, reports: inArea.reduce((n, h) => n + h.mergedReportCount + 1, 0), topTypes };
  }, [queue.hazards, selected, from, to]);

  const where = selected ? `Barangay ${selected.name}` : 'all of Makati';
  const what = type === ALL ? 'hazards' : `${TYPE_LABEL[type].toLowerCase()} hazards`;

  return (
    <section className="card">
      <div className="card-head">
        <div className="freq-head">
          <h2>Hazard frequency by area</h2>
          <span className="muted">How often hazards were reported in the range, by barangay and type</span>
        </div>
        <div className="button-row">
          <label className="select-label">
            <span className="sr-only">Barangay</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value={ALL}>All of Makati</option>
              {[...barangays].sort((a, b) => a.name.localeCompare(b.name)).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </label>
          <label className="select-label">
            <span className="sr-only">Hazard type</span>
            <select value={type} onChange={(e) => setType(e.target.value as HazardType | typeof ALL)}>
              <option value={ALL}>All hazard types</option>
              {HAZARD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
        </div>
      </div>
      {queue.loading && !queue.hazards.length
        ? <div className="skeleton" style={{ height: 240 }} />
        : queue.error
          ? <p className="muted chart-empty">{queue.error}</p>
          : hazards === 0
            ? <p className="muted chart-empty">No {what} reported in {where} in this range.</p>
            : (
              <>
                <p className="freq-summary">
                  <strong>{plural(hazards, 'hazard')}</strong> in {where}
                  {reports > hazards && <span className="muted"> · {plural(reports, 'report')} including duplicates</span>}
                  {type === ALL && topTypes.length > 0 && (
                    <span className="muted"> · Most often: {topTypes.map(([t, n]) => `${TYPE_LABEL[t]} (${n})`).join(', ')}</span>
                  )}
                </p>
                <FrequencyChart rows={rows} label={`${what} reported per ${rows.length > 40 ? 'week' : 'day'} in ${where}`} />
              </>
            )}
      {queue.truncated && <p className="muted small">Showing the latest {queue.hazards.length} hazards in the range.</p>}
    </section>
  );
}
