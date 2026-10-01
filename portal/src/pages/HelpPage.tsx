import { BookOpen, Keyboard, ListChecks, ShieldAlert } from 'lucide-react';
import type { Confidence, HazardStatus, Severity } from '../api/types';
import { ConfidenceBadge, SeverityBadge, StatusBadge } from '../components/Badges';
import { Card, PageHeader } from '../components/ui';
import { CONFIDENCE_HINT, STATUS_HINT } from '../lib/hazards';
import { MAP_CHIPS, MAP_TABS, MODERATION_CHIPS, MODERATION_TABS } from '../lib/queue';

const MANUAL_URL = 'https://claude.ai/code/artifact/5724a8ba-0a0e-4e21-b171-2c02e899fc69';

const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Search places and reports, from any page'],
  ['/', 'Search the hazard queue (Map, Moderation)'],
  ['↑ ↓', 'Move through the queue'],
  ['Enter', 'Open the focused hazard'],
  ['F', 'Show or hide filters'],
  ['M', 'Go to the map'],
  ['Esc', 'Close a drawer, dialog or menu'],
];

const TAB_HELP: Record<string, string> = {
  new: 'Reports from the last 24 hours, newest first. Opens by default so nothing new is missed.',
  attention: 'Contested reports, unverified high-severity hazards, and reports waiting over a day. Called Needs attention on the map.',
  active: 'Every hazard currently on the commuter map.',
  duplicates: 'Hazards that collected more than one report: when two people report the same hazard, the reports are combined.',
  archived: 'Reports nobody on staff acted on within 7 days. They stay on the commuter map until resolved or expired.',
  removed: 'Reports removed as false, spam or invalid.',
  closed: 'Resolved, expired and removed hazards.',
};

const CHIP_HELP: Record<string, string> = {
  high: 'High-severity hazards only.',
  contested: 'Reports the community disagrees about: some confirm it, others say it isn’t there.',
  unconfirmed: 'Nobody besides the reporter has responded yet.',
  expiring: 'Not confirmed recently, so it will drop off the commuter map soon unless someone confirms it.',
  unassigned: 'No department is handling it yet.',
};

const SEVERITY: [Severity, string][] = [
  ['HIGH', 'A danger to anyone walking past: open manholes, deep flooding. Handle first.'],
  ['MEDIUM', 'Makes the route harder or riskier: obstructions, construction.'],
  ['LOW', 'An inconvenience worth fixing: poor lighting, a cracked sidewalk.'],
];
const STATUSES: HazardStatus[] = ['REPORTED', 'VERIFIED', 'DISPUTED', 'RESOLVED', 'EXPIRED', 'REMOVED'];
const CONFIDENCE: Confidence[] = ['UNCONFIRMED', 'LOW', 'MEDIUM', 'HIGH', 'CONTESTED'];

/** How the portal works, sourced from the same definitions the queues use so it can't drift. */
export function HelpPage() {
  // Tabs and chips shared by both pages are listed once.
  const tabs = [...MODERATION_TABS, ...MAP_TABS.filter((t) => !MODERATION_TABS.some((m) => m.key === t.key))];
  const chips = [...MODERATION_CHIPS, ...MAP_CHIPS.filter((c) => !MODERATION_CHIPS.some((m) => m.key === c.key))];
  const mapOnly = new Set(MAP_TABS.filter((t) => !MODERATION_TABS.some((m) => m.key === t.key)).map((t) => t.key));

  return (
    <div className="page help-page">
      <PageHeader title="Help" subtitle="What the queues, labels and shortcuts in the portal mean."
        actions={<a className="btn btn-secondary" href={MANUAL_URL} target="_blank" rel="noreferrer"><BookOpen size={16} aria-hidden="true" />User manual</a>} />

      <div className="grid-main-side">
        <Card title={<span className="title-icon"><ListChecks aria-hidden="true" />Queue tabs</span>}
          subtitle="Each tab is a different list of reports. Moderation and the Hazard Map share most of them.">
          <dl className="help-list">
            {tabs.map((t) => (
              <div key={t.key}>
                <dt>{t.label}{mapOnly.has(t.key) && <span className="info-pill">Map</span>}</dt>
                <dd>{TAB_HELP[t.key] ?? t.empty.body}</dd>
              </div>
            ))}
          </dl>
          <h3 className="help-subhead">Filter by</h3>
          <p className="card-sub">Chips narrow whichever tab is open. Several chips combine.</p>
          <dl className="help-list">
            {chips.map((c) => <div key={c.key}><dt>{c.label}</dt><dd>{CHIP_HELP[c.key] ?? c.empty.title}</dd></div>)}
          </dl>
        </Card>

        <div className="stack">
          <Card title={<span className="title-icon"><Keyboard aria-hidden="true" />Keyboard shortcuts</span>} subtitle="Anywhere except while typing.">
            <dl className="shortcuts">
              {SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
            </dl>
          </Card>
          <Card title={<span className="title-icon"><ShieldAlert aria-hidden="true" />Severity</span>} subtitle="How dangerous a hazard is. Set by the reporter, adjustable by staff.">
            <dl className="help-list">
              {SEVERITY.map(([s, d]) => <div key={s}><dt><SeverityBadge severity={s} /></dt><dd>{d}</dd></div>)}
            </dl>
          </Card>
        </div>
      </div>

      <div className="grid-2">
        <Card title="Status" subtitle="Where a report is in its life.">
          <dl className="help-list">
            {STATUSES.map((s) => <div key={s}><dt><StatusBadge status={s} /></dt><dd>{STATUS_HINT[s]}</dd></div>)}
          </dl>
        </Card>
        <Card title="Confidence" subtitle="How far the community backs a report. Separate from how dangerous it is.">
          <dl className="help-list">
            {CONFIDENCE.map((c) => <div key={c}><dt><ConfidenceBadge confidence={c} /></dt><dd>{CONFIDENCE_HINT[c]}</dd></div>)}
          </dl>
        </Card>
      </div>
    </div>
  );
}
