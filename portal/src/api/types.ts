// Shapes returned by the SafeRoute backend (see backend/.../dto and moderation/dto).

export type HazardType =
  | 'FLOODING' | 'BROKEN_SIDEWALK' | 'OPEN_MANHOLE' | 'POOR_LIGHTING'
  | 'ACCESSIBILITY_BARRIER' | 'CONSTRUCTION' | 'PATH_OBSTRUCTION';
export type HazardStatus = 'REPORTED' | 'VERIFIED' | 'DISPUTED' | 'RESOLVED' | 'EXPIRED' | 'REMOVED';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type Confidence = 'UNCONFIRMED' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CONTESTED';
export type Role = 'USER' | 'MODERATOR' | 'MUNICIPAL_OFFICIAL';
export type TrustLevel = 'NEW_REPORTER' | 'REGULAR_REPORTER' | 'TRUSTED_REPORTER';
export type MunicipalPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export const PRIORITIES: MunicipalPriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

export interface Department {
  code: string;
  name: string;
}
/** In the departments filter: hazards nobody is assigned to. */
export const UNASSIGNED = 'UNASSIGNED';

export const HAZARD_TYPES: HazardType[] = [
  'BROKEN_SIDEWALK', 'FLOODING', 'ACCESSIBILITY_BARRIER', 'OPEN_MANHOLE',
  'CONSTRUCTION', 'POOR_LIGHTING', 'PATH_OBSTRUCTION',
];
export const SEVERITIES: Severity[] = ['HIGH', 'MEDIUM', 'LOW'];
export const CONFIDENCES: Confidence[] = ['UNCONFIRMED', 'LOW', 'MEDIUM', 'HIGH', 'CONTESTED'];
export const ACTIVE_STATUSES: HazardStatus[] = ['REPORTED', 'VERIFIED', 'DISPUTED'];

export interface Hazard {
  id: string;
  type: HazardType;
  latitude: number;
  longitude: number;
  description: string | null;
  photoUrl: string | null;
  status: HazardStatus;
  severity: Severity;
  severityAnswer: string | null;
  confirmationCount: number;
  disputeCount: number;
  /** Null once the hazard is closed. */
  confidence: Confidence | null;
  reporterId: string;
  createdAt: string;
  updatedAt: string;
  lastConfirmedAt: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  version: number;
  /** City response: department code, or null when unassigned. */
  assignedDepartment: string | null;
  municipalPriority: MunicipalPriority | null;
  assignedAt: string | null;
  /** Last staff action; null = the city hasn't looked at it yet. */
  reviewedAt: string | null;
  /** Set when a week passed without staff review. Still active and on the commuter map. */
  archivedAt: string | null;
  /** Other people's matching reports collated into this one. */
  mergedReportCount: number;
}

export interface HazardDetail {
  hazard: Hazard;
  reporterTrustLevel: TrustLevel;
  viewer: { isReporter: boolean; canEdit: boolean; canModerate: boolean };
  community: {
    confirmations: number;
    disputes: number;
    noLongerPresentVotes: number;
    stillPresentVotes: number;
    resolutionThreshold: number;
  };
  expiringSoon: boolean;
}

export type AuditAction =
  | 'CREATED' | 'DUPLICATE_MERGED' | 'CONFIRMATION_CHANGED' | 'RESOLUTION_VOTE' | 'STATUS_CHANGED'
  | 'FIELD_EDITED' | 'MODERATOR_RESOLVED' | 'MODERATOR_REOPENED' | 'MODERATOR_REMOVED'
  | 'MUNICIPAL_ASSIGNED' | 'MUNICIPAL_PRIORITY' | 'STAFF_REVIEWED' | 'ARCHIVED';

export interface TimelineEntry {
  id: string;
  action: AuditAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  /** REPORTER, COMMUNITY, MODERATOR or SYSTEM. */
  actor: string;
  at: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
  hasMore: boolean;
}

export type QueueView = 'recent' | 'attention' | 'high' | 'contested' | 'expiring' | 'unconfirmed' | 'active' | 'removed' | 'unassigned'
  | 'archived' | 'duplicates';
export type QueueSort = 'review' | 'newest' | 'oldest' | 'severity' | 'confidence' | 'disputed' | 'confirmed' | 'expiring' | 'priority' | 'updated';

export interface QueueQuery {
  view?: QueueView;
  statuses?: HazardStatus[];
  types?: HazardType[];
  severities?: Severity[];
  confidences?: Confidence[];
  from?: string;
  to?: string;
  bbox?: [number, number, number, number];
  sort?: QueueSort;
  departments?: string[];
  priorities?: MunicipalPriority[];
}

export interface SavedView {
  id: string;
  name: string;
  /** JSON written by the portal (see lib/views.ts). */
  config: string;
  createdAt: string;
}

export interface Stats {
  from: string;
  to: string;
  timeZone: string;
  generatedAt: string;
  totals: { active: number; highSeverity: number; needsReview: number; reportedInRange: number; resolvedInRange: number };
  queueCounts: Record<QueueView, number>;
  activeByType: { key: HazardType; count: number }[];
  activeBySeverity: { key: Severity; count: number }[];
  daily: {
    date: string; reported: number; resolved: number; backlog: number;
    reportedHigh: number; reportedMedium: number; reportedLow: number;
    /** Reports that created a hazard, and reports merged into an existing one. */
    newReports: number; mergedReports: number;
  }[];
  resolution: {
    averageHours: number | null;
    previousAverageHours: number | null;
    resolvedCount: number;
    byType: { type: HazardType; averageHours: number; count: number }[];
  };
  /** Status changes in the range. */
  outcomes: { resolved: number; expired: number; removed: number; reopened: number };
  /** Report-to-verified time of hazards first verified in the range. */
  verification: { averageHours: number | null; verifiedCount: number; byType: { type: HazardType; averageHours: number; count: number }[] };
  /** Reports by local weekday (1 = Monday) and hour; empty cells are left out. */
  reportTimes: { dayOfWeek: number; hour: number; count: number }[];
  /** Places (~165 m) with repeated hazards in the range, busiest first. */
  hotspots: { latitude: number; longitude: number; count: number; topType: HazardType }[];
}

export interface ActivityEntry {
  id: string;
  hazardId: string;
  hazardType: HazardType;
  hazardSeverity: Severity;
  latitude: number;
  longitude: number;
  action: AuditAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  actor: { kind: 'STAFF' | 'REPORTER' | 'COMMUNITY' | 'SYSTEM'; name: string | null; email: string | null; role: Role | null };
  at: string;
}

/** A portal account (moderator or municipal official). */
export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
  /** Who gave them access in the portal; null for accounts set up by an operator. */
  addedBy: string | null;
  addedAt: string | null;
}

/** A hazard_* frame from /ws/notifications. */
export interface HazardFrame {
  type: string;
  change: string;
  hazardId: string;
  hazardType: HazardType;
  latitude: number;
  longitude: number;
  status: HazardStatus;
  severity: Severity;
  occurredAt: string;
  version: number;
}

export interface Session {
  token: string;
  refreshToken: string;
  email: string;
  displayName: string;
  role: Role;
}
