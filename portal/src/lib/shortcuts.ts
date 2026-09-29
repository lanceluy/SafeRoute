import { useEffect, useRef } from 'react';

/** Single-key shortcuts ("/", "f", "m", "arrowdown"), ignored while typing, in a menu or when a dialog is open. */
/** A handler can return false to leave the key alone (then the browser's default runs). */
export function useShortcuts(map: Record<string, () => void | boolean>) {
  const ref = useRef(map);
  useEffect(() => { ref.current = map; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      // Not while typing, inside an open menu (its arrow keys move between items) or behind a dialog.
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"]') || document.querySelector('.dialog')) return;
      const run = ref.current[e.key.toLowerCase()];
      if (run && run() !== false) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
