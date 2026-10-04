// Live Makati weather from Open-Meteo (free, no key, CORS-enabled; data CC BY 4.0, credited on the
// page). Times come back as Asia/Manila wall-clock strings without an offset, so they are formatted
// from the string rather than converted through the browser's time zone.

/** Makati's centre: the city is about 27 km², so one point stands for all of it. */
export const MAKATI = { latitude: 14.5547, longitude: 121.0244 };
export const WEATHER_SOURCE_URL = 'https://open-meteo.com/';

export interface Weather {
  current: {
    time: string;
    temperature: number;
    feelsLike: number;
    humidity: number;
    /** Rain in the last 15 minutes, mm. */
    precipitation: number;
    code: number;
    windSpeed: number;
    windGusts: number;
    isDay: boolean;
  };
  /** The next 24 hours, starting with the current one. */
  hourly: { time: string; temperature: number; precipitation: number; chance: number; code: number }[];
  /** Today and the next 6 days. */
  daily: { date: string; code: number; max: number; min: number; precipitation: number; chance: number }[];
}

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: String(MAKATI.latitude),
  longitude: String(MAKATI.longitude),
  timezone: 'Asia/Manila',
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day',
  hourly: 'temperature_2m,precipitation,precipitation_probability,weather_code',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
  forecast_days: '7',
  forecast_hours: '24',
});

export async function fetchWeather(signal?: AbortSignal): Promise<Weather> {
  let res: Response;
  try {
    res = await fetch(FORECAST_URL, { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error("Can't reach the weather service. Check your connection.", { cause: err });
  }
  if (!res.ok) throw new Error('The weather service isn’t responding right now.');
  const d = await res.json();
  const c = d.current;
  return {
    current: {
      time: c.time, temperature: c.temperature_2m, feelsLike: c.apparent_temperature, humidity: c.relative_humidity_2m,
      precipitation: c.precipitation, code: c.weather_code, windSpeed: c.wind_speed_10m, windGusts: c.wind_gusts_10m,
      isDay: c.is_day === 1,
    },
    hourly: (d.hourly.time as string[]).map((time, i) => ({
      time, temperature: d.hourly.temperature_2m[i], precipitation: d.hourly.precipitation[i] ?? 0,
      chance: d.hourly.precipitation_probability[i] ?? 0, code: d.hourly.weather_code[i],
    })),
    daily: (d.daily.time as string[]).map((date, i) => ({
      date, code: d.daily.weather_code[i], max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i],
      precipitation: d.daily.precipitation_sum[i] ?? 0, chance: d.daily.precipitation_probability_max[i] ?? 0,
    })),
  };
}

// ------------------------------------------------------------------ rainfall history

export type RainWindow = 'day' | 'threeDays' | 'week';
export const RAIN_WINDOW_HOURS: Record<RainWindow, number> = { day: 24, threeDays: 72, week: 168 };

export interface RainPoint { name: string; latitude: number; longitude: number }
export interface RainArea extends RainPoint, Record<RainWindow, number> {
  /** The model's rain in the last 15 minutes, mm. */
  now: number;
}
export interface RainHistory { time: string; areas: RainArea[] }

/**
 * Past rain for each point, summed over the last 24, 72 and 168 hours. Open-Meteo's hourly value at
 * HH:00 is the rain of the hour before it, so hours after the current one (forecasts) are left out.
 */
export async function fetchRainHistory(points: RainPoint[], signal?: AbortSignal): Promise<RainHistory> {
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: points.map((p) => p.latitude.toFixed(4)).join(','),
    longitude: points.map((p) => p.longitude.toFixed(4)).join(','),
    timezone: 'Asia/Manila',
    current: 'precipitation',
    hourly: 'precipitation',
    past_days: '7',
    forecast_days: '1',
  });
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error("Can't reach the weather service. Check your connection.", { cause: err });
  }
  if (!res.ok) throw new Error('The weather service isn’t responding right now.');
  const body = await res.json();
  // One location comes back as an object, several as an array in request order.
  const locations: { current: { time: string; precipitation: number }; hourly: { time: string[]; precipitation: (number | null)[] } }[] =
    Array.isArray(body) ? body : [body];
  const time = locations[0].current.time;
  const areas = points.map((p, i) => {
    const loc = locations[i];
    const last = loc.hourly.time.indexOf(`${loc.current.time.slice(0, 13)}:00`);
    const sum = (hours: number) => loc.hourly.precipitation.slice(Math.max(0, last - hours + 1), last + 1)
      .reduce<number>((total, v) => total + (v ?? 0), 0);
    return {
      ...p, now: loc.current.precipitation ?? 0,
      day: sum(RAIN_WINDOW_HOURS.day), threeDays: sum(RAIN_WINDOW_HOURS.threeDays), week: sum(RAIN_WINDOW_HOURS.week),
    };
  });
  return { time, areas };
}


// ------------------------------------------------------------------ live radar

export const RADAR_SOURCE_URL = 'https://www.rainviewer.com/';
/** RainViewer's free tiles stop at zoom 7; closer in they return a "Zoom Level Not Supported" image. */
export const RADAR_MAX_ZOOM = 7;

export interface RadarFrame {
  /** Leaflet tile URL template for the newest frame (512 px tiles, "Universal Blue" colours, smoothed). */
  tileUrl: string;
  /** When the radar image was taken. */
  time: Date;
}

export async function fetchRadarFrame(signal?: AbortSignal): Promise<RadarFrame> {
  let res: Response;
  try {
    res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('Live radar is unavailable right now.', { cause: err });
  }
  if (!res.ok) throw new Error('Live radar is unavailable right now.');
  const d: { host: string; radar: { past: { time: number; path: string }[] } } = await res.json();
  const newest = d.radar.past.at(-1);
  if (!newest) throw new Error('Live radar is unavailable right now.');
  return { tileUrl: `${d.host}${newest.path}/512/{z}/{x}/{y}/2/1_1.png`, time: new Date(newest.time * 1000) };
}

// ------------------------------------------------------------------ conditions

type Glyph = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow';

/** WMO weather interpretation codes, as Open-Meteo documents them. */
const CONDITIONS: Record<number, [string, Glyph]> = {
  0: ['Clear', 'clear'], 1: ['Mostly clear', 'clear'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm with hail', 'storm'], 99: ['Thunderstorm with hail', 'storm'],
};

export function conditionLabel(code: number) {
  return CONDITIONS[code]?.[0] ?? 'Unknown';
}

const SUN = '<circle cx="12" cy="12" r="4"/><path class="wx-rays" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
const CLOUD = '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 11a3.75 3.75 0 0 0 0 7.5z"/>';
const SMALL_CLOUD = '<path d="M7.5 15.5h8a3.2 3.2 0 0 0 .5-6.36A4.4 4.4 0 0 0 7.5 9.8a2.85 2.85 0 0 0 0 5.7z"/>';
const GLYPHS: Record<Glyph, (day: boolean) => string> = {
  clear: (day) => (day ? SUN : MOON),
  partly: (day) => (day
    ? '<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/><path class="wx-cloud" d="M9 19h8.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9 12.5a3.25 3.25 0 0 0 0 6.5z"/>'
    : '<path d="M11 7.5A4.5 4.5 0 1 1 5.5 3a3.6 3.6 0 0 0 5.5 4.5z"/><path d="M9 19h8.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9 12.5a3.25 3.25 0 0 0 0 6.5z"/>'),
  cloud: () => CLOUD,
  fog: () => '<path d="M4 9h16M3 13h18M5 17h14"/>',
  drizzle: () => `${SMALL_CLOUD}<path class="wx-drops" d="M9 19v1M13 19v1M11 21v1"/>`,
  rain: () => `${SMALL_CLOUD}<path class="wx-drops" d="M9 18.5l-1 3M13 18.5l-1 3M17 18.5l-1 3"/>`,
  storm: () => `${SMALL_CLOUD}<path class="wx-bolt" d="M12.5 16.5l-2 3h3l-2 3"/>`,
  snow: () => `${SMALL_CLOUD}<path d="M9 19.5h.01M12 21h.01M15 19.5h.01"/>`,
};

/** Line icon for a WMO code; `currentColor`, so it follows the text colour in both themes. */
export function conditionIcon(code: number, isDay = true, size = 24, animated = false) {
  const glyph = CONDITIONS[code]?.[1] ?? 'cloud';
  // `animated` is only for the current-conditions icon; forecast icons stay still so they never imply live progression.
  return `<svg${animated ? ' class="wx-animated"' : ''} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[glyph](isDay)}</svg>`;
}

// ------------------------------------------------------------------ advisories

export type Tone = 'good' | 'warning' | 'critical';
export interface Band { label: string; tone: Tone; note: string }

/** PAGASA rainfall warning bands, for rain in one hour (mm). */
export function rainBand(mmPerHour: number): Band {
  if (mmPerHour > 30) return { label: 'Red warning', tone: 'critical', note: 'Torrential rain: serious flooding likely' };
  if (mmPerHour >= 15) return { label: 'Orange warning', tone: 'critical', note: 'Intense rain: flooding likely' };
  if (mmPerHour >= 7.5) return { label: 'Yellow warning', tone: 'warning', note: 'Heavy rain: flooding reports likely' };
  if (mmPerHour >= 2.5) return { label: 'Moderate rain', tone: 'good', note: 'No rainfall warning' };
  if (mmPerHour > 0) return { label: 'Light rain', tone: 'good', note: 'No rainfall warning' };
  return { label: 'No rain', tone: 'good', note: 'No rainfall warning' };
}

/** PAGASA heat index bands (°C). */
export function heatBand(feelsLike: number): Band {
  if (feelsLike >= 52) return { label: 'Extreme danger', tone: 'critical', note: 'Heat stroke is likely with continued exposure' };
  if (feelsLike >= 42) return { label: 'Danger', tone: 'critical', note: 'Heat cramps and exhaustion are likely' };
  if (feelsLike >= 33) return { label: 'Extreme caution', tone: 'warning', note: 'Heat cramps and exhaustion are possible' };
  if (feelsLike >= 27) return { label: 'Caution', tone: 'good', note: 'Fatigue is possible with long exposure' };
  return { label: 'No heat warning', tone: 'good', note: 'Comfortable for walking' };
}

// ------------------------------------------------------------------ formatting

/** "3 PM" from "2026-09-28T15:00". */
export function hourLabel(time: string) {
  const h = Number(time.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "11:45 PM" from "2026-09-28T23:45". */
export function clockLabel(time: string) {
  const h = Number(time.slice(11, 13));
  return `${h % 12 || 12}:${time.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Today", "Tomorrow", then "Wed". */
export function dayName(date: string, index: number) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en', { weekday: 'short' });
}

/** Night for an hour that isn't the current one: good enough for an icon. */
export function isDaytime(time: string) {
  const h = Number(time.slice(11, 13));
  return h >= 6 && h < 18;
}

// ------------------------------------------------------------------ what it means for streets

export type RiskLevel = 'Low' | 'Moderate' | 'High';
export interface Risk { key: string; label: string; level: RiskLevel; note: string }

const LEVEL_OF: Record<Tone, RiskLevel> = { good: 'Low', warning: 'Moderate', critical: 'High' };
const FOG = new Set([45, 48]);
const STORM = new Set([95, 96, 99]);

/**
 * Weather read as pedestrian risk, from the same forecast and PAGASA bands as the rest of the page:
 * flooding (rain bands, plus open flooding reports), slippery roads, visibility and heat.
 */
export function weatherRisks(w: Weather, floodingReports: number): Risk[] {
  const next6 = w.hourly.slice(0, 6);
  const peak6 = Math.max(0, ...next6.map((h) => h.precipitation));
  const next3 = w.hourly.slice(0, 3).reduce((s, h) => s + h.precipitation, 0);
  const rain = rainBand(peak6);
  let flood = LEVEL_OF[rain.tone];
  if (flood === 'Low' && floodingReports > 0 && peak6 >= 2.5) flood = 'Moderate';
  const wetNow = w.current.precipitation > 0 || next3 >= 1;
  const slippery: RiskLevel = peak6 >= 7.5 ? 'High' : wetNow ? 'Moderate' : 'Low';
  const storm = next6.some((h) => STORM.has(h.code)) || STORM.has(w.current.code);
  const visibility: RiskLevel = FOG.has(w.current.code) || storm || peak6 >= 15 ? 'High' : peak6 >= 7.5 ? 'Moderate' : 'Low';
  const heat = heatBand(w.current.feelsLike);
  return [
    { key: 'flood', label: 'Flooding', level: flood,
      note: `${rain.label}${floodingReports ? ` · ${floodingReports} flooding report${floodingReports === 1 ? '' : 's'} open` : ''}` },
    { key: 'slippery', label: 'Slippery roads', level: slippery, note: wetNow ? `${next3.toFixed(1)} mm expected in the next 3 hours` : 'Dry for the next 3 hours' },
    { key: 'visibility', label: 'Poor visibility', level: visibility,
      note: FOG.has(w.current.code) ? 'Fog' : storm ? 'Thunderstorms possible' : peak6 >= 7.5 ? 'Heavy rain' : 'Clear enough' },
    { key: 'heat', label: 'Heat exposure', level: LEVEL_OF[heat.tone], note: `${heat.label} · feels like ${Math.round(w.current.feelsLike)}°C` },
  ];
}

/**
 * One line about what's coming: a watch (amber) when heavy rain or heat warrants action,
 * otherwise a calm update (blue).
 */
export function weatherUpdate(w: Weather): { watch: boolean; text: string } {
  const soon = w.hourly.slice(0, 12);
  const heavy = soon.find((h) => h.precipitation >= 7.5);
  if (heavy) return { watch: true, text: `Heavy rain around ${hourLabel(heavy.time)} may increase flooding this ${partOfDay(heavy.time)}.` };
  const storm = soon.find((h) => STORM.has(h.code));
  if (storm) return { watch: true, text: `Thunderstorms possible around ${hourLabel(storm.time)}.` };
  const heat = heatBand(w.current.feelsLike);
  if (heat.tone !== 'good') return { watch: true, text: `Heat index ${Math.round(w.current.feelsLike)}°C: ${heat.label.toLowerCase()} for people walking.` };
  const likely = soon.find((h) => h.chance >= 60 && h.precipitation >= 0.5);
  if (likely) return { watch: false, text: `Rain likely around ${hourLabel(likely.time)} (${likely.chance}% chance).` };
  return { watch: false, text: 'No significant rain expected in the next 12 hours.' };
}

function partOfDay(time: string) {
  const h = Number(time.slice(11, 13));
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}
