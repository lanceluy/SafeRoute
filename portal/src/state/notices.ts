// High-severity reports that arrived live this session, for the top bar's bell. Kept in memory only:
// a reload starts the list again, and the queues remain the record.
import { useSyncExternalStore } from 'react';
import type { HazardFrame } from '../api/types';

const MAX = 10;
let notices: HazardFrame[] = [];
let unread = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pushNotice(frame: HazardFrame) {
  notices = [frame, ...notices.filter((n) => n.hazardId !== frame.hazardId)].slice(0, MAX);
  unread = Math.min(MAX, unread + 1);
  emit();
}

export function markNoticesRead() {
  if (!unread) return;
  unread = 0;
  emit();
}

let snapshot = { notices, unread };
function read() {
  if (snapshot.notices !== notices || snapshot.unread !== unread) snapshot = { notices, unread };
  return snapshot;
}

export function useNotices() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, read);
}
