import { useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Hazard } from '../api/types';
import { HazardDrawer } from '../components/HazardDrawer';
import { QueuePanel, useQueueControls } from '../components/QueuePanel';
import { MODERATION_TABS } from '../lib/queue';
import { useShortcuts } from '../lib/shortcuts';
import { useBarangays } from '../state/places';
import { useStats } from '../state/useStats';

/** The review queue on its own, full width: for working through reports one by one. */
export function ModerationPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const barangays = useBarangays();
  const c = useQueueControls(MODERATION_TABS, barangays, params.get('tab') ?? undefined);
  const { stats } = useStats();
  const selectedId = params.get('hazard');
  const searchRef = useRef<HTMLInputElement>(null);

  const select = useCallback((h: Hazard | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (h) next.set('hazard', h.id); else next.delete('hazard');
      return next;
    }, { replace: true });
  }, [setParams]);

  useShortcuts({
    '/': () => searchRef.current?.focus(),
    f: c.toggleFilters,
    m: () => navigate(selectedId ? `/map?hazard=${selectedId}` : '/map'),
  });

  return (
    <div className={`moderation-page${selectedId ? ' has-drawer' : ''}`}>
      <div className="page-head">
        <div>
          <h1>Moderation</h1>
          <p className="muted">Work through reports that need a decision. Open one to see its photo, history and actions.</p>
        </div>
      </div>
      <div className="moderation-body">
        <section className="card moderation-queue">
          <QueuePanel c={c} tabs={MODERATION_TABS} stats={stats} barangays={barangays} selectedId={selectedId}
            onSelect={select} searchRef={searchRef} page="moderation" />
        </section>
        {selectedId && (
          <HazardDrawer key={selectedId} hazardId={selectedId} barangays={barangays} onClose={() => select(null)} onChanged={c.queue.reload}
            onShowOnMap={() => navigate(`/map?hazard=${selectedId}&tab=active`)} />
        )}
      </div>
    </div>
  );
}
