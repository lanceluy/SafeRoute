// Colour scales shared by charts and maps.

/** The dataviz reference blue ramp, steps 100–700 (step 450 is the portal's --series-1). */
export const SEQUENTIAL_BLUE = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
];

/** Light (near zero) to dark (the largest value), so the lightest step always means "little". */
export function sequentialColor(value: number, max: number) {
  if (max <= 0 || value <= 0) return SEQUENTIAL_BLUE[0];
  return SEQUENTIAL_BLUE[Math.min(SEQUENTIAL_BLUE.length - 1, Math.round((value / max) * (SEQUENTIAL_BLUE.length - 1)))];
}
