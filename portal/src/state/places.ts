import { useEffect, useState, useSyncExternalStore } from 'react';
import { barangayAt, loadBarangays, onStreetsChange, streetAt, type Barangay } from '../lib/geo';

export function useBarangays() {
  const [list, setList] = useState<Barangay[]>([]);
  useEffect(() => {
    let alive = true;
    loadBarangays().then((b) => { if (alive) setList(b); });
    return () => { alive = false; };
  }, []);
  return list;
}

let streetsVersion = 0;
onStreetsChange(() => { streetsVersion++; });

/** Re-renders when street lookups finish. */
export function useStreetsVersion() {
  return useSyncExternalStore(onStreetsChange, () => streetsVersion);
}

/** "Ayala Avenue · Urdaneta", falling back to whichever part is known. */
export function usePlace(lat: number, lon: number, barangays: Barangay[]) {
  useStreetsVersion();
  const street = streetAt(lat, lon);
  const barangay = barangayAt(barangays, lat, lon)?.name;
  return { street, barangay, label: [street, barangay].filter(Boolean).join(' · ') };
}
