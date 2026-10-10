import { describe, expect, it } from 'vitest';
import { clockLabel, heatBand, hourLabel, rainBand, weatherRisks, weatherUpdate, type Weather } from './weather';

/** A dry, mild forecast; each test overrides what it cares about. */
function weather(over: { feelsLike?: number; code?: number; precipitation?: number; hourly?: Partial<Weather['hourly'][number]>[] } = {}): Weather {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    time: `2026-10-10T${String(i).padStart(2, '0')}:00`, temperature: 29, precipitation: 0, chance: 0, code: 1,
    ...over.hourly?.[i],
  }));
  return {
    current: {
      time: '2026-10-10T00:00', temperature: 29, feelsLike: over.feelsLike ?? 30, humidity: 70,
      precipitation: over.precipitation ?? 0, code: over.code ?? 1, windSpeed: 10, windGusts: 20, isDay: true,
    },
    hourly: hours,
    daily: [],
  };
}

describe('rainBand (PAGASA rainfall warnings)', () => {
  it('steps up at the published thresholds', () => {
    expect(rainBand(0).label).toBe('No rain');
    expect(rainBand(0.1).label).toBe('Light rain');
    expect(rainBand(2.5).label).toBe('Moderate rain');
    expect(rainBand(7.5).label).toBe('Yellow warning');
    expect(rainBand(15).label).toBe('Orange warning');
    expect(rainBand(30).label).toBe('Orange warning'); // red is strictly above 30 mm
    expect(rainBand(30.1).label).toBe('Red warning');
  });

  it('only warns (not "good") from yellow upward', () => {
    expect(rainBand(7.4).tone).toBe('good');
    expect(rainBand(7.5).tone).toBe('warning');
    expect(rainBand(15).tone).toBe('critical');
  });
});

describe('heatBand (PAGASA heat index)', () => {
  it('steps up at the published thresholds', () => {
    expect(heatBand(26.9).label).toBe('No heat warning');
    expect(heatBand(27).label).toBe('Caution');
    expect(heatBand(33).label).toBe('Extreme caution');
    expect(heatBand(42).label).toBe('Danger');
    expect(heatBand(52).label).toBe('Extreme danger');
  });
});

describe('weatherRisks', () => {
  const level = (risks: ReturnType<typeof weatherRisks>, key: string) => risks.find((r) => r.key === key)!.level;

  it('is all Low on a dry day', () => {
    const risks = weatherRisks(weather(), 0);
    expect(risks.map((r) => r.level)).toEqual(['Low', 'Low', 'Low', 'Low']);
    expect(risks.find((r) => r.key === 'slippery')!.note).toBe('Dry for the next 3 hours');
  });

  it('raises flooding to High on heavy rain and reports how many flooding reports are open', () => {
    const risks = weatherRisks(weather({ hourly: [{ precipitation: 20 }] }), 2);
    expect(level(risks, 'flood')).toBe('High');
    expect(risks.find((r) => r.key === 'flood')!.note).toBe('Orange warning · 2 flooding reports open');
  });

  it('raises flooding to Moderate when rain is moderate and flooding reports are already open', () => {
    expect(level(weatherRisks(weather({ hourly: [{ precipitation: 3 }] }), 0), 'flood')).toBe('Low');
    expect(level(weatherRisks(weather({ hourly: [{ precipitation: 3 }] }), 1), 'flood')).toBe('Moderate');
  });

  it('flags poor visibility for fog and thunderstorms', () => {
    expect(level(weatherRisks(weather({ code: 45 }), 0), 'visibility')).toBe('High');
    expect(level(weatherRisks(weather({ hourly: [{}, {}, { code: 95 }] }), 0), 'visibility')).toBe('High');
  });

  it('reads heat from the heat index', () => {
    expect(level(weatherRisks(weather({ feelsLike: 45 }), 0), 'heat')).toBe('High');
    expect(level(weatherRisks(weather({ feelsLike: 35 }), 0), 'heat')).toBe('Moderate');
  });
});

describe('weatherUpdate', () => {
  it('is a calm update when nothing is expected', () => {
    expect(weatherUpdate(weather())).toEqual({ watch: false, text: 'No significant rain expected in the next 12 hours.' });
  });

  it('is a watch for heavy rain, naming the hour and part of day', () => {
    const update = weatherUpdate(weather({ hourly: Object.assign(Array(15).fill({}), { 14: { precipitation: 9 } }) }));
    expect(update.watch).toBe(false); // hour 14 is beyond the 12-hour look-ahead
    const soon = weatherUpdate(weather({ hourly: Object.assign(Array(15).fill({}), { 8: { precipitation: 9 } }) }));
    expect(soon).toEqual({ watch: true, text: 'Heavy rain around 8 AM may increase flooding this morning.' });
  });

  it('is a watch for extreme heat', () => {
    expect(weatherUpdate(weather({ feelsLike: 44 })).text).toBe('Heat index 44°C: danger for people walking.');
  });

  it('mentions likely rain without raising a watch', () => {
    const update = weatherUpdate(weather({ hourly: [{}, {}, { chance: 70, precipitation: 1 }] }));
    expect(update).toEqual({ watch: false, text: 'Rain likely around 2 AM (70% chance).' });
  });
});

describe('time labels', () => {
  it('formats 12-hour clocks, including midnight and noon', () => {
    expect(hourLabel('2026-10-10T00:00')).toBe('12 AM');
    expect(hourLabel('2026-10-10T12:00')).toBe('12 PM');
    expect(hourLabel('2026-10-10T15:00')).toBe('3 PM');
    expect(clockLabel('2026-10-10T23:45')).toBe('11:45 PM');
  });
});
