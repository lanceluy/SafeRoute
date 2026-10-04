import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useExitGhost } from '../lib/motion';

/** Modal dialog: focus stays inside, Esc closes, focus returns to where it was. */
export function Dialog({ title, onClose, children, footer, tone = 'default', icon }: {
  title: string; onClose: () => void; children: ReactNode; footer: ReactNode; tone?: 'default' | 'danger';
  /** Shown in a tinted circle beside the title. */
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Closing reverses the entrance (CSS .is-leaving); focus returns straight away, not after it.
  useExitGhost(backdrop);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current!;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex]:not([tabindex="-1"])'));
    (panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" ref={backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog dialog-${tone}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog-head">
          {icon && <span className="dialog-icon" aria-hidden="true">{icon}</span>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">{footer}</div>
      </div>
    </div>
  );
}
