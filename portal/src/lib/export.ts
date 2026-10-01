import type { Department, Hazard } from '../api/types';
import { departmentName } from '../state/departments';
import { barangayAt, cachedStreet, type Barangay } from './geo';
import { CONFIDENCE_LABEL, PRIORITY_LABEL, SEVERITY_LABEL, STATUS_LABEL, TYPE_LABEL, shortId } from './hazards';

/** Who and what an export is for; printed at the top of the CSV and the PDF report. */
export interface ExportMeta {
  /** The list exported: tab, chips and filters, e.g. "All active · High severity · Barangay Poblacion". */
  scope: string;
  preparedBy: string;
  generatedAt: Date;
}

/** "SR-20261001-1430": a reference staff can quote for a printed or saved report. */
export function reportNumber(at: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `SR-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
}

/** "2026-10-01 14:30", local time: readable, and spreadsheets still read it as a date. */
export function localStamp(iso: string | Date | null | undefined) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One row per hazard, in words staff would use in a meeting. */
export function hazardRows(hazards: Hazard[], barangays: Barangay[], departments: Department[]) {
  return hazards.map((h, i) => ({
    'No.': String(i + 1),
    Reference: shortId(h.id),
    'Hazard type': TYPE_LABEL[h.type],
    Severity: SEVERITY_LABEL[h.severity],
    Status: STATUS_LABEL[h.status] + (h.archivedAt && h.status !== 'RESOLVED' && h.status !== 'EXPIRED' && h.status !== 'REMOVED' ? ' (archived)' : ''),
    Confidence: h.confidence ? CONFIDENCE_LABEL[h.confidence] : '',
    'Assigned department': departmentName(departments, h.assignedDepartment) ?? 'Unassigned',
    'City priority': h.municipalPriority ? PRIORITY_LABEL[h.municipalPriority] : '',
    Street: cachedStreet(h.latitude, h.longitude) ?? '',
    Barangay: barangayAt(barangays, h.latitude, h.longitude)?.name ?? '',
    Latitude: h.latitude.toFixed(6),
    Longitude: h.longitude.toFixed(6),
    'Reports combined': String(h.mergedReportCount + 1),
    Confirmations: String(h.confirmationCount),
    Disputes: String(h.disputeCount),
    'Date reported': localStamp(h.createdAt),
    'Last confirmed': localStamp(h.lastConfirmedAt),
    'Reviewed by staff': localStamp(h.reviewedAt),
    'Date closed': localStamp(h.resolvedAt),
    Description: h.description ?? '',
  }));
}

/** Quotes every cell, and defuses cells a spreadsheet would run as a formula. */
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadCsv(hazards: Hazard[], barangays: Barangay[], departments: Department[], meta: ExportMeta, name = 'hazards') {
  const rows = hazardRows(hazards, barangays, departments);
  if (!rows.length) return;
  const header = Object.keys(rows[0]) as (keyof (typeof rows)[number])[];
  // A title block like the PDF's, then the table.
  const title = [
    ['SafeRoute Municipal Hazard Report'],
    ['Makati City'],
    [],
    ['Report no.', reportNumber(meta.generatedAt)],
    ['Scope', meta.scope],
    ['Prepared by', meta.preparedBy],
    ['Date generated', localStamp(meta.generatedAt)],
    ['Hazards listed', String(rows.length)],
    [],
  ];
  const lines = [
    ...title.map((r) => r.map(cell).join(',')),
    header.map(cell).join(','),
    ...rows.map((r) => header.map((k) => cell(r[k])).join(',')),
    '',
    cell('Generated from the SafeRoute Municipal Portal. Hazards are crowdsourced from commuters and reviewed by city staff.'),
  ];
  // A byte-order mark so Excel reads the file as UTF-8 (ñ in Dasmariñas).
  const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saferoute-${name}-${reportNumber(meta.generatedAt)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
