import { useRef } from 'react';
import { useNavigate } from 'react-router';
import type { HazardFrame } from '../api/types';
import { TYPE_LABEL } from '../lib/hazards';
import { highSeverityNotices } from '../lib/prefs';
import { useHazardFrames } from '../state/live';
import { pushNotice } from '../state/notices';
import { useToast } from '../state/toast';

const BATCH_MS = 4000;

/**
 * A quiet notice when a new high-severity hazard is reported, with a link to it. Several in a
 * few seconds become one notice, so a burst never floods the screen.
 */
export function LiveNotices() {
  const toast = useToast();
  const navigate = useNavigate();
  const pending = useRef<HazardFrame[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useHazardFrames((frame) => {
    if (frame.type !== 'hazard_created' || frame.severity !== 'HIGH') return;
    // The bell always keeps them; the pop-up notice is a preference.
    pushNotice(frame);
    if (!highSeverityNotices()) return;
    pending.current.push(frame);
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      const batch = pending.current;
      pending.current = [];
      timer.current = undefined;
      const first = batch[0];
      toast(batch.length === 1
        ? {
          kind: 'info', message: `New high-severity report: ${TYPE_LABEL[first.hazardType]}`,
          action: { label: 'View', run: () => navigate(`/map?tab=active&hazard=${first.hazardId}`) },
        }
        : {
          kind: 'info', message: `${batch.length} new high-severity reports`,
          action: { label: 'View', run: () => navigate('/map?tab=high') },
        });
    }, BATCH_MS);
  });

  return null;
}
