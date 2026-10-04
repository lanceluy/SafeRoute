import { useChangeFlash, useCountUp } from '../lib/motion';

/**
 * A number that counts to its new value (from zero on first view when `fromZero`), and tints once
 * when a live update changes it: blue for a neutral change, green for an improvement. Red is kept
 * for `tone="severity"` numbers, where a rise really is bad news.
 */
export function CountUp({ value, fromZero = false, ms = 350, goodWhen, tone = 'neutral', fadeLater = false }: {
  value: number; fromZero?: boolean; ms?: number; goodWhen?: 'up' | 'down'; tone?: 'neutral' | 'severity';
  /** Count only on first view; later values crossfade (measurements, such as temperature). */
  fadeLater?: boolean;
}) {
  const shown = useCountUp(value, { ms, fromZero, onlyFirst: fadeLater }) ?? value;
  const flash = useChangeFlash(value);
  if (fadeLater) return <span key={value} className="count count-fade">{shown.toLocaleString()}</span>;
  let kind = '';
  if (flash) {
    const good = goodWhen && flash.dir === goodWhen;
    const bad = goodWhen && flash.dir !== goodWhen && flash.dir !== 'same';
    kind = good ? 'good' : bad && tone === 'severity' ? 'bad' : 'neutral';
  }
  return (
    <span key={flash?.n ?? 0} className={kind ? `count value-flash flash-${kind}` : 'count'}>
      {shown.toLocaleString()}
    </span>
  );
}
