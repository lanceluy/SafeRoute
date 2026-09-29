import type { Hazard } from '../api/types';
import { barangayAt, type Barangay } from './geo';

export interface AreaRow {
  name: string;
  active: number;
  high: number;
  medium: number;
  low: number;
  resolved: number;
  /** Mean age of the active hazards, in days. */
  avgAgeDays: number | null;
  /** Resolved in the range as a share of those plus the ones still active (0–1); null with neither. */
  resolutionRate: number | null;
  /** Disputes as a share of all community responses on the active hazards (0–1); null with none. */
  disputeRate: number | null;
}

/** Per-barangay numbers from the active hazards and those resolved between `from` and `to`. */
export function areaStats(barangays: Barangay[], active: Hazard[], resolved: Hazard[], from: number, to: number, now = Date.now()) {
  const rows = new Map<string, AreaRow & { ageSum: number; confirmations: number; disputes: number }>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) {
      rows.set(name, r = {
        name, active: 0, high: 0, medium: 0, low: 0, resolved: 0, avgAgeDays: null, resolutionRate: null, disputeRate: null,
        ageSum: 0, confirmations: 0, disputes: 0,
      });
    }
    return r;
  };
  for (const b of barangays) row(b.name);
  for (const h of active) {
    const name = barangayAt(barangays, h.latitude, h.longitude)?.name;
    if (!name) continue;
    const r = row(name);
    r.active++;
    if (h.severity === 'HIGH') r.high++;
    else if (h.severity === 'MEDIUM') r.medium++;
    else r.low++;
    r.ageSum += (now - Date.parse(h.createdAt)) / 86_400_000;
    r.confirmations += h.confirmationCount;
    r.disputes += h.disputeCount;
  }
  for (const h of resolved) {
    const at = h.resolvedAt ? Date.parse(h.resolvedAt) : NaN;
    if (!(at >= from && at < to)) continue;
    const name = barangayAt(barangays, h.latitude, h.longitude)?.name;
    if (name) row(name).resolved++;
  }
  return [...rows.values()]
    .map(({ ageSum, confirmations, disputes, ...r }) => ({
      ...r,
      avgAgeDays: r.active ? ageSum / r.active : null,
      resolutionRate: r.active + r.resolved ? r.resolved / (r.active + r.resolved) : null,
      disputeRate: confirmations + disputes ? disputes / (confirmations + disputes) : null,
    }))
    .sort((a, b) => b.active - a.active || b.resolved - a.resolved || a.name.localeCompare(b.name));
}
