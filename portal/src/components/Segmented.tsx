import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { SLIDE } from '../lib/motion';

/** The active tab's underline: one element shared by a tab strip, so it slides to the new tab. */
export function TabIndicator({ id }: { id: string }) {
  return <motion.span layoutId={`tab-indicator-${id}`} className="tab-indicator" transition={SLIDE} aria-hidden="true" />;
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  title?: string;
  /** Accessible name when the label is an icon or abbreviated. */
  ariaLabel?: string;
}

/**
 * A row of mutually exclusive buttons (`aria-pressed`) with one selected pill that slides behind
 * the active option. The pill is drawn by `.seg-pill`; `className` keeps each control's own look.
 */
export function Segmented<V extends string>({ options, value, onChange, label, className = 'segmented' }: {
  options: readonly SegmentedOption<V>[]; value: V; onChange: (v: V) => void; label: string; className?: string;
}) {
  const id = useId();
  return (
    <div className={`${className} has-pill`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} title={o.title} aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={SLIDE} aria-hidden="true" />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
