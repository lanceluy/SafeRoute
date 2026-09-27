import { useEffect, useState } from 'react';
import { ago } from '../lib/format';
import { useLive } from '../state/live';

export function LiveStatus() {
  const { status, updatedAt } = useLive();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (status === 'live') {
    return (
      <span className="live live-on" title="New reports and status changes appear automatically">
        <span className="live-dot" aria-hidden="true" />Live
        {updatedAt && <span className="live-sub">· Updated {ago(new Date(updatedAt).toISOString())}</span>}
      </span>
    );
  }
  if (status === 'connecting') return <span className="live"><span className="live-dot" aria-hidden="true" />Connecting…</span>;
  return (
    <span className="live live-off" role="status" title="Data may be temporarily outdated">
      <span className="live-dot" aria-hidden="true" />Reconnecting…
      <span className="live-sub">· data may be outdated</span>
    </span>
  );
}
