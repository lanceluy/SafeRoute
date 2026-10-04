import type { Confidence, HazardStatus, HazardType, Severity } from '../api/types';
import {
  CONFIDENCE_BARS, CONFIDENCE_HINT, CONFIDENCE_LABEL, SEVERITY_LABEL, STATUS_HINT, STATUS_LABEL, STATUS_MARK, typeIcon,
} from '../lib/hazards';

export function SeverityBadge({ severity, suffix = true }: { severity: Severity; suffix?: boolean }) {
  return (
    <span className={`badge sev-${severity.toLowerCase()}`}>
      <span className="sev-dot" aria-hidden="true" />
      {SEVERITY_LABEL[severity]}{suffix ? ' severity' : ''}
    </span>
  );
}

/** "● High": severity as a category in lists, where a pill on every row would be noise. */
export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span className={`sev-text sev-text-${severity.toLowerCase()}`}>
      <span className={`sev-dot sev-bg-${severity.toLowerCase()}`} aria-hidden="true" />
      {SEVERITY_LABEL[severity]}<span className="sr-only"> severity</span>
    </span>
  );
}

/** `plain` drops the pill: icon and text only, for rows. */
export function StatusBadge({ status, plain = false }: { status: HazardStatus; plain?: boolean }) {
  return (
    <span className={`${plain ? 'plain-badge' : 'badge status'} status-${status.toLowerCase()}`} title={STATUS_HINT[status]}>
      <span aria-hidden="true" className="status-mark">{STATUS_MARK[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Confidence is how trustworthy the report looks; it's separate from how dangerous it is. */
export function ConfidenceBadge({ confidence, long = false, plain = false }: { confidence: Confidence | null; long?: boolean; plain?: boolean }) {
  if (!confidence) return null;
  const bars = CONFIDENCE_BARS[confidence];
  return (
    <span className={`${plain ? 'plain-badge' : 'badge confidence'} conf-${confidence.toLowerCase()}`} title={CONFIDENCE_HINT[confidence]}>
      {confidence === 'CONTESTED'
        ? <span aria-hidden="true" className="status-mark">!</span>
        : (
          <span className="conf-bars" aria-hidden="true">
            {[1, 2, 3].map((i) => <i key={i} className={i <= bars ? 'on' : ''} />)}
          </span>
        )}
      {CONFIDENCE_LABEL[confidence]}{long ? ' confidence' : ''}
    </span>
  );
}

export function TypeIcon({ type, size = 18 }: { type: HazardType; size?: number }) {
  return <span className="type-icon" dangerouslySetInnerHTML={{ __html: typeIcon(type, size) }} />;
}

/** "ⓘ" with an explanation on hover and focus. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden="true">i</span>
      <span className="info-tip-text" aria-hidden="true">{text}</span>
    </span>
  );
}
