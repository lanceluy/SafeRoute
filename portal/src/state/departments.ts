import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Department } from '../api/types';

let cached: Promise<Department[]> | null = null;

/** The city's departments (GET /api/meta/departments), loaded once per session. */
export function useDepartments() {
  const [list, setList] = useState<Department[]>([]);
  useEffect(() => {
    let alive = true;
    if (!cached) cached = api.departments().catch(() => { cached = null; return []; });
    cached.then((d) => { if (alive) setList(d); });
    return () => { alive = false; };
  }, []);
  return list;
}

export function departmentName(list: Department[], code: string | null | undefined) {
  if (!code) return null;
  return list.find((d) => d.code === code)?.name ?? code.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
