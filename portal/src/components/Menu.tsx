import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { POPOVER } from '../lib/motion';
import { Check } from 'lucide-react';

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A checkbox (or, with `radio`, a radio) item: shows a tick and leaves the menu open. */
  checked?: boolean;
  radio?: boolean;
  /** Shown before the label (e.g. a severity dot). */
  icon?: ReactNode;
  /** Shown at the end of the label line (e.g. a count). */
  meta?: ReactNode;
  onSelect: () => void;
}

/** A small section label between groups of items. */
export interface MenuHeading { heading: string }
type Entry = MenuItem | MenuHeading;
const isHeading = (e: Entry): e is MenuHeading => 'heading' in e;
const ITEMS = '[role^="menuitem"]:not([disabled])';

/** Space kept between the list and the window edge. */
const EDGE = 8;
const GAP = 6;

/**
 * A button that opens a small list of actions. Esc or a click outside closes it.
 *
 * The list is drawn at the top of the page (a portal) and positioned against the button, so a
 * narrow or scrolling container (the map's side rail, the detail drawer) can never clip it. It is
 * kept inside the window: shifted in from either edge, flipped up when there's no room below, and
 * scrollable when it's still too tall.
 */
export function Menu({ label, trigger, items, align = 'right', direction = 'down', footer }: {
  label: string; trigger: ReactNode; items: (Entry | null)[]; align?: 'left' | 'right'; direction?: 'up' | 'down';
  /** Extra content under the items (e.g. an empty-state line). */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Place the list before the browser paints it, and keep it attached while the page moves.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = ref.current?.getBoundingClientRect();
      const list = listRef.current;
      if (!button || !list) return;
      list.style.maxHeight = '';
      const width = list.offsetWidth;
      const height = list.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const preferred = align === 'right' ? button.right - width : button.left;
      list.style.left = `${Math.max(EDGE, Math.min(preferred, vw - width - EDGE))}px`;
      const below = vh - button.bottom - GAP - EDGE;
      const above = button.top - GAP - EDGE;
      const down = direction === 'down' ? below >= height || below >= above : !(above >= height || above >= below);
      const room = down ? below : above;
      list.style.maxHeight = `${Math.max(120, room)}px`;
      list.style.top = `${down ? button.bottom + GAP : button.top - GAP - Math.min(height, room)}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture: any scrolling container moves the button
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, direction]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    listRef.current?.querySelector<HTMLButtonElement>(ITEMS)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shown = items.filter((i): i is Entry => i !== null);
  const moveFocus = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {createPortal(
        <AnimatePresence>
        {open && (
        <motion.div key="list" className="menu-list" role="menu" id={id} ref={listRef} onKeyDown={moveFocus} {...POPOVER}>
          {shown.map((item) => isHeading(item) ? (
            <div key={`h-${item.heading}`} className="menu-heading" role="presentation">{item.heading}</div>
          ) : (
            item.checked === undefined ? (
              <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
                className={item.danger ? 'menu-item danger' : 'menu-item'}
                onClick={() => { setOpen(false); item.onSelect(); }}>
                <span className="menu-item-label">{item.icon}{item.label}{item.meta !== undefined && <span className="menu-meta">{item.meta}</span>}</span>
                {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              </button>
            ) : (
              // Checkbox items stay open so several can be ticked; a radio choice closes the menu.
              <button key={item.label} type="button" role={item.radio ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={item.checked}
                disabled={item.disabled} className={`menu-item menu-check${item.checked ? ' on' : ''}`}
                onClick={() => { if (item.radio) setOpen(false); item.onSelect(); }}>
                <span className="menu-item-label">
                  <span className={`check-box${item.radio ? ' radio' : ''}`} aria-hidden="true">{item.checked && <Check size={12} strokeWidth={3} />}</span>
                  {item.icon}{item.label}
                  {item.meta !== undefined && <span className="menu-meta">{item.meta}</span>}
                </span>
                {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              </button>
            )
          ))}
          {footer}
        </motion.div>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
