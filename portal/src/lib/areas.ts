import type { Hazard } from '../api/types';
import { barangayAt, type Barangay } from './geo';

export interface AreaRow {
  name: string;
  active: number;
  high: number;
  resolved: number;
  /** Mean age of the active hazards, in days. */
  avgAgeDays: number | null;
}

/** Per-barangay numbers from the active hazards and those resolved between `from` and `to`. */
export function areaStats(barangays: Barangay[], active: Hazard[], resolved: Hazard[], from: number, to: number, now = Date.now()) {
  const rows = new Map<string, AreaRow & { ageSum: number }>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) rows.set(name, r = { name, active: 0, high: 0, resolved: 0, avgAgeDays: null, ageSum: 0 });
    return r;
  };
  for (const b of barangays) row(b.name);
  for (const h of active) {
    const name = barangayAt(barangays, h.latitude, h.longitude)?.name;
    if (!name) continue;
    const r = row(name);
    r.active++;
    if (h.severity === 'HIGH') r.high++;
    r.ageSum += (now - Date.parse(h.createdAt)) / 86_400_000;
  }
  for (const h of resolved) {
    const at = h.resolvedAt ? Date.parse(h.resolvedAt) : NaN;
    if (!(at >= from && at < to)) continue;
    const name = barangayAt(barangays, h.latitude, h.longitude)?.name;
    if (name) row(name).resolved++;
  }
  return [...rows.values()]
    .map(({ ageSum, ...r }) => ({ ...r, avgAgeDays: r.active ? ageSum / r.active : null }))
    .sort((a, b) => b.active - a.active || b.resolved - a.resolved || a.name.localeCompare(b.name));
}
