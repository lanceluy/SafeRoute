// How hazard attributes are named, colored and drawn. Color means severity; the glyph means type;
// status and confidence always come with text so nothing relies on color alone.
import type { AuditAction, Confidence, HazardStatus, HazardType, MunicipalPriority, Severity, TrustLevel } from '../api/types';

export const TYPE_LABEL: Record<HazardType, string> = {
  FLOODING: 'Flooding',
  BROKEN_SIDEWALK: 'Broken sidewalk',
  OPEN_MANHOLE: 'Open manhole',
  POOR_LIGHTING: 'Poor lighting',
  ACCESSIBILITY_BARRIER: 'Accessibility barrier',
  CONSTRUCTION: 'Construction',
  PATH_OBSTRUCTION: 'Path obstruction',
};

/** 24×24 glyphs drawn in currentColor. */
export const TYPE_GLYPH: Record<HazardType, string> = {
  FLOODING: '<path d="M12 2.5c3.4 4.6 6.5 8 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10.5 8.6 7.1 12 2.5z"/>',
  BROKEN_SIDEWALK: '<path d="M2 15h7.5l1.7 2.4 2.3-3.4 1.9 1h6.6v5H2z"/><path d="M2 9h8l-1 2.5 2 1.5H2z" opacity=".7"/><path d="M13.5 9H22v4h-6.2l-1.5-.8z" opacity=".7"/>',
  OPEN_MANHOLE: '<path fill-rule="evenodd" d="M12 6.5c5.2 0 9 2.4 9 5.5s-3.8 5.5-9 5.5-9-2.4-9-5.5 3.8-5.5 9-5.5zm0 3c-3.2 0-5.4 1.2-5.4 2.5s2.2 2.5 5.4 2.5 5.4-1.2 5.4-2.5-2.2-2.5-5.4-2.5z"/>',
  POOR_LIGHTING: '<path d="M12 2a6.5 6.5 0 0 0-3.8 11.8V16h7.6v-2.2A6.5 6.5 0 0 0 12 2z"/><path d="M8.5 18h7v1.8h-7zM10 21h4v1.5h-4z"/>',
  ACCESSIBILITY_BARRIER: '<circle cx="11" cy="3.8" r="2.1"/><path d="M9.3 7.2h3.2v4.3h4.3l2.4 6.3h-2.3l-1.8-4.4H9.3z"/><path d="M8 10.3v2A4.4 4.4 0 1 0 14.3 18h2.1A6.4 6.4 0 1 1 8 10.3z"/>',
  CONSTRUCTION: '<path d="M10.2 2.5h3.6l1.2 4H9zM8.4 8.5h7.2l1.2 4H7.2zM6.6 14.5h10.8l1.4 4.5H5.2z"/><path d="M3 20h18v2H3z"/>',
  PATH_OBSTRUCTION: '<path d="M2 7h20v6H2z"/><path d="M5 13h2.2v8H5zM16.8 13H19v8h-2.2z"/><path d="M5 7l4 6h3L8 7zM13 7l4 6h3l-4-6z" fill="#fff" opacity=".85"/>',
};

export function typeIcon(type: HazardType, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${TYPE_GLYPH[type]}</svg>`;
}

export const SEVERITY_LABEL: Record<Severity, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
/** Marker fill per severity; the same values as --sev-* in styles.css. */
export const SEVERITY_COLOR: Record<Severity, string> = { HIGH: '#D92D20', MEDIUM: '#E07B0B', LOW: '#B58A1B' };

export const STATUS_LABEL: Record<HazardStatus, string> = {
  REPORTED: 'Reported',
  VERIFIED: 'Verified',
  DISPUTED: 'Contested',
  RESOLVED: 'Resolved',
  EXPIRED: 'Expired',
  REMOVED: 'Removed',
};
export const STATUS_MARK: Record<HazardStatus, string> = {
  REPORTED: '○', VERIFIED: '✓', DISPUTED: '!', RESOLVED: '✓', EXPIRED: '–', REMOVED: '×',
};
export const STATUS_HINT: Record<HazardStatus, string> = {
  REPORTED: 'Reported by a commuter and not yet verified by others.',
  VERIFIED: 'Other commuters confirmed it’s there.',
  DISPUTED: 'Commuters disagree about whether it’s there.',
  RESOLVED: 'Fixed or no longer present.',
  EXPIRED: 'Nobody confirmed it recently, so it dropped off the map.',
  REMOVED: 'Removed as a false, spam or invalid report.',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  UNCONFIRMED: 'Unconfirmed', LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CONTESTED: 'Contested',
};
/** Matches HazardLifecycle.confidence on the backend. */
export const CONFIDENCE_HINT: Record<Confidence, string> = {
  UNCONFIRMED: 'Nobody besides the reporter has confirmed or disputed it yet.',
  LOW: 'Some community responses, but not verified, or verified with under 60% support.',
  MEDIUM: 'Verified, with at least 60% community support.',
  HIGH: 'Verified by five or more people with at least 80% community support.',
  CONTESTED: 'Community reports disagree about whether this hazard is real.',
};
export const CONFIDENCE_BARS: Record<Confidence, number> = { UNCONFIRMED: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CONTESTED: 0 };

export const TRUST_LABEL: Record<TrustLevel, string> = {
  NEW_REPORTER: 'New reporter',
  REGULAR_REPORTER: 'Regular reporter',
  TRUSTED_REPORTER: 'Trusted reporter',
};

export function isActive(status: HazardStatus) {
  return status === 'REPORTED' || status === 'VERIFIED' || status === 'DISPUTED';
}

/** Short hazard reference for staff, e.g. "H-3F2A". */
export function shortId(id: string) {
  return `H-${id.slice(0, 4).toUpperCase()}`;
}

export const REMOVAL_REASONS = [
  'Spam', 'Duplicate', 'Incorrect location', 'False report', 'Inappropriate content', 'Other',
] as const;

export const ACTION_LABEL: Record<AuditAction, string> = {
  CREATED: 'Reported',
  DUPLICATE_MERGED: 'Duplicate report merged',
  CONFIRMATION_CHANGED: 'Community response',
  RESOLUTION_VOTE: 'Resolution vote',
  STATUS_CHANGED: 'Status changed',
  FIELD_EDITED: 'Details edited',
  MODERATOR_RESOLVED: 'Marked resolved',
  MODERATOR_REOPENED: 'Reopened',
  MODERATOR_REMOVED: 'Report removed',
  MUNICIPAL_ASSIGNED: 'Department assigned',
  MUNICIPAL_PRIORITY: 'City priority set',
};

export const PRIORITY_LABEL: Record<MunicipalPriority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
export const PRIORITY_HINT = 'How urgently the city means to deal with it. Separate from severity, which is how dangerous commuters say it is.';

/** Notes the backend fills in by itself; they add nothing for staff. */
export const DEFAULT_NOTES = new Set(['Resolved by moderator']);

/** Fields whose edits are bookkeeping, not something staff need to see. */
export const HIDDEN_FIELDS = new Set(['contentRevision', 'expiresAt']);

const FIELD_LABEL: Record<string, string> = {
  description: 'description', photoUrl: 'photo', location: 'location', type: 'type', severity: 'severity',
  department: 'department', priority: 'city priority',
};

export function fieldLabel(field: string | null) {
  return (field && FIELD_LABEL[field]) || 'details';
}

/** Makes enum values in audit values readable: OPEN_MANHOLE → Open manhole, VERIFY → Confirmed. */
export function valueLabel(value: string | null) {
  if (!value) return '';
  if (value in TYPE_LABEL) return TYPE_LABEL[value as HazardType];
  if (value in STATUS_LABEL) return STATUS_LABEL[value as HazardStatus];
  if (value in SEVERITY_LABEL) return SEVERITY_LABEL[value as Severity];
  const words: Record<string, string> = {
    VERIFY: 'Confirmed', DISPUTE: 'Disputed', NO_LONGER_PRESENT: 'No longer there', STILL_PRESENT: 'Still there',
    URGENT: 'Urgent', NORMAL: 'Normal',
  };
  return words[value] ?? value;
}
