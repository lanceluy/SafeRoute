import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A button that opens a small list of actions. Esc or a click outside closes it. */
export function Menu({ label, trigger, items, align = 'right', direction = 'down', footer }: {
  label: string; trigger: ReactNode; items: (MenuItem | null)[]; align?: 'left' | 'right'; direction?: 'up' | 'down';
  /** Extra content under the items (e.g. an empty-state line). */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shown = items.filter((i): i is MenuItem => i !== null);
  const moveFocus = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu-list menu-${align} menu-${direction}`} role="menu" id={id} onKeyDown={moveFocus}>
          {shown.map((item) => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
              className={item.danger ? 'menu-item danger' : 'menu-item'}
              onClick={() => { setOpen(false); item.onSelect(); }}>
              <span className="menu-item-label">{item.label}</span>
              {item.hint && <span className="menu-item-hint">{item.hint}</span>}
            </button>
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}
