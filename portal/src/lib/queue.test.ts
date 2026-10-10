import { describe, expect, it } from 'vitest';
import type { Hazard, QueueView } from '../api/types';
import {
  MAP_CHIPS, MAP_TABS, MODERATION_CHIPS, MODERATION_TABS,
  isExpiringSoon, isStale, needsAction, queueReason, resolveTab, shortAge, tabCount,
} from './queue';

const NOW = Date.parse('2026-10-10T06:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: '3f2a9c1e-0000-4000-8000-000000000001', type: 'OPEN_MANHOLE', latitude: 14.5547, longitude: 121.0244,
    description: null, photoUrl: null, status: 'REPORTED', severity: 'MEDIUM', severityAnswer: null,
    confirmationCount: 0, disputeCount: 0, confidence: 'UNCONFIRMED', reporterId: 'r1',
    createdAt: iso(-HOUR), updatedAt: iso(-HOUR), lastConfirmedAt: null, expiresAt: iso(DAY), resolvedAt: null,
    version: 0, assignedDepartment: null, municipalPriority: null, assignedAt: null, reviewedAt: null,
    archivedAt: null, mergedReportCount: 0,
    ...over,
  };
}

describe('resolveTab', () => {
  it('keeps a key that is a tab', () => {
    expect(resolveTab(MODERATION_TABS, MODERATION_CHIPS, 'archived')).toEqual({ tab: 'archived', chips: [] });
  });

  it('opens All active with the chip on for an old link whose key is now a chip', () => {
    expect(resolveTab(MAP_TABS, MAP_CHIPS, 'high')).toEqual({ tab: 'active', chips: ['high'] });
    expect(resolveTab(MODERATION_TABS, MODERATION_CHIPS, 'contested')).toEqual({ tab: 'active', chips: ['contested'] });
  });

  it('falls back to the first tab for a missing or unknown key', () => {
    expect(resolveTab(MAP_TABS, MAP_CHIPS, undefined)).toEqual({ tab: MAP_TABS[0].key, chips: [] });
    expect(resolveTab(MAP_TABS, MAP_CHIPS, 'nonsense')).toEqual({ tab: MAP_TABS[0].key, chips: [] });
  });
});

describe('tabCount', () => {
  const counts = { active: 86, archived: 6, attention: 10, recent: 0 } as Record<QueueView, number>;

  it('is unknown until the counts load', () => {
    expect(tabCount(MODERATION_TABS[0], undefined)).toBeUndefined();
  });

  it('uses the tab\'s view, and Active excludes archived reports', () => {
    expect(tabCount(MODERATION_TABS.find((t) => t.key === 'attention')!, counts)).toBe(10);
    expect(tabCount(MODERATION_TABS[0], counts)).toBe(80);
    expect(tabCount(MODERATION_TABS.find((t) => t.key === 'open')!, counts)).toBe(86);
  });

  it('never goes negative', () => {
    expect(tabCount(MODERATION_TABS[0], { ...counts, active: 2, archived: 5 })).toBe(0);
  });
});

describe('isExpiringSoon', () => {
  // Flooding lives 12 hours, so "soon" is the last 2.4 hours.
  it('is true in the last fifth of the time to live', () => {
    expect(isExpiringSoon(hazard({ type: 'FLOODING', expiresAt: iso(2 * HOUR) }), NOW)).toBe(true);
  });

  it('is false earlier, after expiry, with no expiry, or once closed', () => {
    expect(isExpiringSoon(hazard({ type: 'FLOODING', expiresAt: iso(5 * HOUR) }), NOW)).toBe(false);
    expect(isExpiringSoon(hazard({ type: 'FLOODING', expiresAt: iso(-HOUR) }), NOW)).toBe(false);
    expect(isExpiringSoon(hazard({ type: 'FLOODING', expiresAt: null }), NOW)).toBe(false);
    expect(isExpiringSoon(hazard({ type: 'FLOODING', status: 'RESOLVED', expiresAt: iso(HOUR) }), NOW)).toBe(false);
  });
});

describe('needsAction', () => {
  it('flags an urgent city priority', () => {
    expect(needsAction(hazard({ municipalPriority: 'URGENT' }), NOW)).toBe('The city marked it urgent');
  });

  it('flags a verified high-severity hazard nobody picked up in 3 days', () => {
    const stuck = hazard({ severity: 'HIGH', status: 'VERIFIED', createdAt: iso(-3 * DAY) });
    expect(needsAction(stuck, NOW)).toMatch(/unassigned for 3\+ days/);
    expect(needsAction({ ...stuck, createdAt: iso(-2 * DAY) }, NOW)).toBeNull();
    expect(needsAction({ ...stuck, assignedDepartment: 'ENGINEERING' }, NOW)).toBeNull();
  });

  it('ignores closed hazards, even urgent ones', () => {
    expect(needsAction(hazard({ status: 'RESOLVED', municipalPriority: 'URGENT' }), NOW)).toBeNull();
  });
});

describe('age', () => {
  it('shortens to minutes, hours or days', () => {
    expect(shortAge(hazard({ createdAt: iso(-10_000) }), NOW)).toBe('1m');
    expect(shortAge(hazard({ createdAt: iso(-30 * 60_000) }), NOW)).toBe('30m');
    expect(shortAge(hazard({ createdAt: iso(-5 * HOUR) }), NOW)).toBe('5h');
    expect(shortAge(hazard({ createdAt: iso(-3 * DAY) }), NOW)).toBe('3d');
  });

  it('is stale at 7 days while active, never once closed', () => {
    expect(isStale(hazard({ createdAt: iso(-7 * DAY) }), NOW)).toBe(true);
    expect(isStale(hazard({ createdAt: iso(-6 * DAY) }), NOW)).toBe(false);
    expect(isStale(hazard({ createdAt: iso(-9 * DAY), status: 'RESOLVED' }), NOW)).toBe(false);
  });
});

describe('queueReason', () => {
  it('explains Needs review by what is wrong', () => {
    expect(queueReason('attention', [], hazard({ status: 'DISPUTED', confirmationCount: 1, disputeCount: 2 }), NOW))
      .toBe('Contested: 1 confirmation vs 2 disputes');
    expect(queueReason('attention', [], hazard({ status: 'REPORTED', severity: 'HIGH' }), NOW))
      .toBe('High severity, not yet verified');
  });

  it('uses the first chip when chips narrow a tab', () => {
    const h = hazard({ municipalPriority: 'HIGH' });
    expect(queueReason('active', ['unassigned'], h, NOW)).toBe('No department yet · high city priority');
    expect(queueReason('active', ['unassigned'], hazard(), NOW)).toBe('No department assigned yet');
  });

  it('says nothing where the tab already says it all', () => {
    expect(queueReason('active', [], hazard(), NOW)).toBeNull();
  });

  it('counts the reporter in a duplicate group', () => {
    expect(queueReason('duplicates', [], hazard({ mergedReportCount: 2 }), NOW))
      .toBe('3 people reported this · combined into one report');
  });
});
