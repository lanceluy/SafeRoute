import { useSyncExternalStore } from 'react';

const KEY = 'saferoute.notify.high';
const listeners = new Set<() => void>();

/** Whether this browser shows a notice when a new high-severity hazard is reported. */
export function highSeverityNotices(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setHighSeverityNotices(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* not remembered */ }
  listeners.forEach((l) => l());
}

export function useHighSeverityNotices() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, highSeverityNotices);
}
