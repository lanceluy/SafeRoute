import { useEffect, useState, useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'saferoute.theme';
const listeners = new Set<() => void>();

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Sets data-theme on <html>; "system" removes it so prefers-color-scheme decides. */
export function applyTheme(choice: ThemeChoice = themeChoice()) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme; else root.dataset.theme = choice;
}

export function setThemeChoice(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice); } catch { /* not remembered */ }
  applyTheme(choice);
  listeners.forEach((l) => l());
}

export function useThemeChoice() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, themeChoice);
}

/** True while the portal is showing its dark theme (either chosen or from the system). */
export function useIsDark() {
  const choice = useThemeChoice();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return choice === 'system' ? systemDark : choice === 'dark';
}

/** Resolved token values, for places CSS variables can't reach (SVG attributes, Leaflet styles). */
export function useThemeColors() {
  const dark = useIsDark();
  // Read on every render; a theme flip re-renders through useIsDark.
  const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return {
    dark,
    navy: read('--navy'), series1: read('--series-1'), series2: read('--series-2'),
    grid: read('--grid'), axis: read('--axis'), surface: read('--surface'), text2: read('--text-2'),
  };
}

