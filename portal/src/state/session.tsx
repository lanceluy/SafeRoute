import { useSyncExternalStore } from 'react';
import { currentSession, onSessionChange } from '../api/client';

export function useSession() {
  return useSyncExternalStore(onSessionChange, currentSession);
}
