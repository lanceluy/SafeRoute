import { useEffect, useRef } from 'react';

/** Single-key shortcuts ("/", "f", "m"), ignored while typing or when a dialog is open. */
export function useShortcuts(map: Record<string, () => void>) {
  const ref = useRef(map);
  useEffect(() => { ref.current = map; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.dialog')) return;
      const run = ref.current[e.key.toLowerCase()];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
