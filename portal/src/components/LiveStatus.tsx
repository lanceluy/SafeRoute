import { useEffect, useState } from 'react';
import { ago } from '../lib/format';
import { useLive } from '../state/live';

/** "● Live · Updated 2 min ago". `compact` keeps only the dot, with the words for screen readers and on hover. */
export function LiveStatus({ compact = false, label = 'Live' }: { compact?: boolean; label?: string }) {
  const { status, updatedAt } = useLive();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const text = (words: string) => <span className={compact ? 'sr-only' : 'live-text'}>{words}</span>;

  if (status === 'live') {
    return (
      <span className="live live-on" title="New reports and status changes appear automatically">
        <span className="live-dot" aria-hidden="true" />{text(label)}
        {!compact && updatedAt && <span className="live-sub">· Updated {ago(new Date(updatedAt).toISOString())}</span>}
      </span>
    );
  }
  if (status === 'connecting') {
    return <span className="live" title="Connecting…"><span className="live-dot" aria-hidden="true" />{text('Connecting…')}</span>;
  }
  return (
    <span className="live live-off" role="status" title="Data may be temporarily outdated">
      <span className="live-dot" aria-hidden="true" />{text('Reconnecting…')}
      {!compact && <span className="live-sub">· data may be outdated</span>}
    </span>
  );
}
