const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const short = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const full = new Intl.DateTimeFormat('en', {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** "just now", "18 min ago", "2 days ago", "3 weeks ago". */
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute').replace('minutes', 'min').replace('minute', 'min');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 14) return rtf.format(Math.round(seconds / 86400), 'day');
  if (abs < 86400 * 60) return rtf.format(Math.round(seconds / (86400 * 7)), 'week');
  return rtf.format(Math.round(seconds / (86400 * 30)), 'month');
}

/** "Sep 24, 12:08 AM" */
export function shortDate(iso: string | null | undefined) {
  return iso ? short.format(new Date(iso)) : '';
}

/** Full timestamp, for audit detail only. */
export function fullDate(iso: string | null | undefined) {
  return iso ? full.format(new Date(iso)) : '';
}

export function dayLabel(date: Date | string) {
  return dayFmt.format(typeof date === 'string' ? new Date(`${date}T00:00:00`) : date);
}

export function timeOfDay(iso: string) {
  return timeFmt.format(new Date(iso));
}

/** "2.4 days", "5.2 hr", "40 min". */
export function duration(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function coords(lat: number, lon: number) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function googleMapsUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}
