/** The small down chevron on menu buttons; matches the one drawn on dropdowns. */
export function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg className={`chev${up ? ' up' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
