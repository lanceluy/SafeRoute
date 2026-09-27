import type { Department, Hazard } from '../api/types';
import { departmentName } from '../state/departments';
import { barangayAt, cachedStreet, type Barangay } from './geo';
import { CONFIDENCE_LABEL, PRIORITY_LABEL, SEVERITY_LABEL, STATUS_LABEL, TYPE_LABEL, shortId } from './hazards';

/** One row per hazard, in words staff would use in a meeting. */
export function hazardRows(hazards: Hazard[], barangays: Barangay[], departments: Department[]) {
  return hazards.map((h) => ({
    Reference: shortId(h.id),
    Type: TYPE_LABEL[h.type],
    Severity: SEVERITY_LABEL[h.severity],
    Status: STATUS_LABEL[h.status],
    Confidence: h.confidence ? CONFIDENCE_LABEL[h.confidence] : '',
    Department: departmentName(departments, h.assignedDepartment) ?? 'Unassigned',
    'City priority': h.municipalPriority ? PRIORITY_LABEL[h.municipalPriority] : '',
    Street: cachedStreet(h.latitude, h.longitude) ?? '',
    Barangay: barangayAt(barangays, h.latitude, h.longitude)?.name ?? '',
    Latitude: h.latitude.toFixed(6),
    Longitude: h.longitude.toFixed(6),
    Confirmations: String(h.confirmationCount),
    Disputes: String(h.disputeCount),
    Reported: new Date(h.createdAt).toISOString(),
    'Last confirmed': h.lastConfirmedAt ? new Date(h.lastConfirmedAt).toISOString() : '',
    Description: h.description ?? '',
  }));
}

/** Quotes every cell, and defuses cells a spreadsheet would run as a formula. */
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadCsv(hazards: Hazard[], barangays: Barangay[], departments: Department[], name = 'hazards') {
  const rows = hazardRows(hazards, barangays, departments);
  if (!rows.length) return;
  const header = Object.keys(rows[0]) as (keyof (typeof rows)[number])[];
  const lines = [header.map(cell).join(','), ...rows.map((r) => header.map((k) => cell(r[k])).join(','))];
  // A byte-order mark so Excel reads the file as UTF-8 (ñ in Dasmariñas).
  const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saferoute-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
