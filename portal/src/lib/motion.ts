import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * The portal's motion tokens, mirrored from styles.css. Motion reinforces a change or a spatial
 * relationship; it never decorates, never loops, and never replays on a live update.
 */
export const EASE = [0.2, 0.7, 0.2, 1] as const;
export const T = { instant: 0.11, fast: 0.16, std: 0.23, emph: 0.36, reveal: 0.6 } as const;

/**
 * Popovers and menus: open by fading and dropping 4 px, close by reversing it a little faster.
 * Notifications, account and every Menu share exactly this.
 */
export const POPOVER = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: { duration: T.fast } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 }, pointerEvents: 'none' as const },
};

/** Shared indicator slides (sidebar, tabs, segmented controls). */
export const SLIDE = { type: 'tween', ease: EASE, duration: 0.18 } as const;

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True for the first `ms` after mount, then false for good. Gates a first-draw animation (a chart
 * line, a bar growing) so later data, such as a WebSocket update, never replays it.
 */
export function useFirstReveal(ms = 700, enabled = true) {
  const [on, setOn] = useState(() => enabled && !prefersReducedMotion());
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return on;
}

/**
 * A number that tweens to `value`: from the previous value on updates, and from zero on the first
 * real value only when `fromZero` is set. `onlyFirst` jumps straight to later values (the caller
 * crossfades them instead). Returns `value` itself under reduced motion.
 */
export function useCountUp(value: number | null | undefined, { ms = 350, fromZero = false, onlyFirst = false } = {}) {
  const target = value ?? 0;
  const [shown, setShown] = useState(() => (fromZero && !prefersReducedMotion() ? 0 : target));
  const from = useRef(shown);
  const seen = useRef(value != null);
  useEffect(() => {
    if (value == null) return;
    const first = !seen.current;
    const start = first && fromZero ? 0 : from.current;
    seen.current = true;
    if (start === target || prefersReducedMotion() || (onlyFirst && !first)) { from.current = target; setShown(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (target - start) * eased;
      from.current = v;
      setShown(p < 1 ? v : target);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, target, ms, fromZero, onlyFirst]);
  return value == null ? value : Math.round(shown);
}

/**
 * Which way `value` last changed after mount, held for `ms`: 'up', 'down' or null. Drives a
 * one-off tint on only the number that changed.
 */
export function useChangeFlash(value: number | string | null | undefined, ms = 900) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down' | 'same'; n: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before == null || value == null || before === value) return;
    const dir = typeof value === 'number' && typeof before === 'number' ? (value > before ? 'up' : 'down') : 'same';
    setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
    const t = window.setTimeout(() => setFlash(null), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return flash;
}

/**
 * Whether the page was opened just now. A chart that mounts in this window draws itself in; one
 * mounted later (a new date range, a different view in the same card) crossfades instead, so it
 * never redraws from nothing.
 */
const PageFresh = createContext(true);

export function PageReveal({ children }: { children: ReactNode }) {
  // Long enough for a slow API response: a chart that mounts in this window may play its draw-in.
  const fresh = useFirstReveal(4000);
  return createElement(PageFresh.Provider, { value: fresh }, children);
}

/** Whether `el` is on screen, or within the last 4% of it (where the scroll gate would reveal it). */
function nearViewport(el: Element) {
  return el.getBoundingClientRect().top < window.innerHeight * 0.96;
}

/**
 * First-draw animation for a chart, played when it scrolls into view rather than when the page
 * mounts. Attach `ref` (a callback ref) to the chart's root element, then:
 * - `seen` becomes true the first time the element is on screen (immediately if it already is);
 * - `reveal` is true for `ms` after that, only for a chart that mounted while the page was still
 *   fresh, so a chart remounted by a date-range or view change never replays.
 * A chart below the fold is therefore drawn static and hidden behind the scroll gate, and animates
 * once the user gets to it. (The Recharts area charts use `seen` as a `key` so they redraw then.)
 */
export function useChartReveal(ms = 900) {
  const fresh = useContext(PageFresh);
  const [wasFresh] = useState(fresh);
  const [el, setEl] = useState<Element | null>(null);
  const [seen, setSeen] = useState(false);
  const [expired, setExpired] = useState(false);

  // Measured when the element attaches (before paint), so a chart that is already on screen starts at once.
  const ref = useCallback((node: Element | null) => {
    setEl(node);
    if (node && nearViewport(node)) setSeen(true);
  }, []);

  useEffect(() => {
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -4% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);

  useEffect(() => {
    if (!seen) return;
    const t = window.setTimeout(() => setExpired(true), ms);
    return () => window.clearTimeout(t);
  }, [seen, ms]);

  return { ref, seen, reveal: seen && wasFresh && !expired && !prefersReducedMotion() };
}

/**
 * The scroll gate. Page blocks (`.route > .page > *`) that start below the fold are paused in
 * their "before" state (`data-reveal-wait`, see styles.css) and released as they scroll into view,
 * so their entrance animation plays when you get to them instead of already having finished.
 * Blocks that mount later (lazy pages, data arriving) are picked up by a MutationObserver.
 */
export function useScrollGate(root: RefObject<HTMLElement | null>, routeKey: string) {
  useEffect(() => {
    const host = root.current;
    if (!host || prefersReducedMotion()) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute('data-late', '');
        e.target.removeAttribute('data-reveal-wait');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -4% 0px' });
    const seen = new WeakSet<Element>();
    const scan = () => {
      host.querySelectorAll('.route > .page > *').forEach((block) => {
        if (seen.has(block)) return;
        seen.add(block);
        if (nearViewport(block)) return;
        block.setAttribute('data-reveal-wait', '');
        io.observe(block);
      });
    };
    scan();
    let frame = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scan); });
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      io.disconnect();
      host.querySelectorAll('[data-reveal-wait]').forEach((b) => b.removeAttribute('data-reveal-wait'));
    };
  }, [root, routeKey]);
}

/**
 * An exit animation for something its parent simply unmounts (a dialog closed by any of its
 * buttons): a copy of the element stays on screen just long enough to play `.is-leaving` from CSS.
 * Focus has already moved on; the copy is inert and hidden from assistive technology.
 */
export function useExitGhost(ref: RefObject<HTMLElement | null>, ms = 180) {
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (!node || prefersReducedMotion()) return;
      const ghost = node.cloneNode(true) as HTMLElement;
      // StrictMode replays effects without removing the element; only a real unmount gets a ghost.
      // The element must be fixed-position (it is re-attached to <body>).
      requestAnimationFrame(() => {
        if (node.isConnected) return;
        ghost.classList.add('is-leaving');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        document.body.appendChild(ghost);
        window.setTimeout(() => ghost.remove(), ms);
      });
    };
  }, [ref, ms]);
}

/**
 * Keeps showing the last non-null `value` for `ms` after it becomes null, so a CSS exit animation
 * can play. `leaving` is true during that window; the caller should make the content inert then.
 */
export function useHoldForExit<T>(value: T | null | undefined, ms = 180) {
  const [held, setHeld] = useState<T | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [prev, setPrev] = useState<T | null | undefined>(value);
  if (prev !== value) {
    setPrev(value);
    if (value != null) { setHeld(value); setLeaving(false); }
    else if (held != null && !prefersReducedMotion()) setLeaving(true);
    else setHeld(null);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => { setHeld(null); setLeaving(false); }, ms);
    return () => window.clearTimeout(t);
  }, [leaving, ms]);
  const shown = value ?? held;
  return { shown: shown as T | null, leaving: leaving && value == null };
}
