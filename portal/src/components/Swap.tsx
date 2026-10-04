import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * Crossfades its content when `k` changes: the old view fades out (100 ms), the new one fades in
 * and rises 4 px (180 ms). The box keeps its last height meanwhile, so the card never collapses
 * and re-expands between chart types. Same `k`, such as a live update, changes nothing.
 */
export function Swap({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (!el.style.minHeight) height.current = el.offsetHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (box.current && height.current) box.current.style.minHeight = `${height.current}px`;
  }, [k]);
  const release = () => { if (box.current) box.current.style.minHeight = ''; };
  return (
    <div ref={box} className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={k} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }} onAnimationComplete={release}>
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
