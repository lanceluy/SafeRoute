// Authenticated access to the SafeRoute backend. Access tokens last 30 minutes: on a 401 the
// client refreshes once and retries; if that fails the session ends.
import type {
  ActivityEntry, Hazard, HazardDetail, Page, QueueQuery, Session, Stats, TimelineEntry,
} from './types';

const override = new URLSearchParams(location.search).get('api');
/** e.g. http://localhost:8080/api; `?api=` wins so a built portal can point anywhere. */
export const API_BASE = (override || import.meta.env.VITE_API_BASE || 'http://localhost:8080/api').replace(/\/$/, '');
/** Backend origin, for photo URLs (/uploads/...) and the WebSocket. */
export const API_ORIGIN = new URL(API_BASE).origin;
export const MODERATOR_ROLES = ['MODERATOR', 'MUNICIPAL_OFFICIAL'];

/** Something went wrong; `message` is safe to show to municipal staff. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const SESSION_KEY = 'saferoute.session';
let session: Session | null = readSession();
const listeners = new Set<(s: Session | null) => void>();

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function setSession(next: Session | null) {
  session = next;
  try {
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* private mode: the session lasts until reload */ }
  listeners.forEach((l) => l(next));
}

export function currentSession() {
  return session;
}

export function onSessionChange(listener: (s: Session | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function login(email: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError("Can't reach the SafeRoute server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 400) throw new ApiError('That email and password don’t match an account.', res.status);
  if (res.status === 429) throw new ApiError('Too many attempts. Wait a minute and try again.', 429);
  if (!res.ok) throw new ApiError('Sign-in isn’t working right now. Try again shortly.', res.status);
  if (!MODERATOR_ROLES.includes(data.role)) {
    throw new ApiError('This portal is for municipal officials and moderators. Your account doesn’t have access.', 403);
  }
  const next: Session = {
    token: data.token, refreshToken: data.refreshToken, email: data.email,
    displayName: data.displayName, role: data.role,
  };
  setSession(next);
  return next;
}

export function logout() {
  const refreshToken = session?.refreshToken;
  if (refreshToken) {
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  setSession(null);
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: parallel 401s share it, because refresh tokens rotate on use. */
export function refreshToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      if (!session) return false;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setSession({ ...session, token: data.token, refreshToken: data.refreshToken });
        return true;
      } catch {
        return false;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  signal?: AbortSignal;
}

async function request(path: string, options: RequestOptions = {}, retried = false): Promise<Response> {
  if (!session) throw new ApiError('Please sign in again.', 401);
  const { method = 'GET', json, signal } = options;
  const headers: Record<string, string> = { Authorization: `Bearer ${session.token}` };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers, signal, body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError("Can't reach the SafeRoute server. Check your connection and try again.", 0);
  }
  if (res.status === 401 && !retried && await refreshToken()) return request(path, options, true);
  if (res.status === 401) {
    setSession(null);
    throw new ApiError('Your session expired. Please sign in again.', 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(friendlyError(res.status, body.error), res.status, body.error);
  }
  return res;
}

function friendlyError(status: number, code?: string) {
  if (code === 'HAZARD_ALREADY_REMOVED') return 'This report was already removed.';
  if (code === 'HAZARD_NOT_ACTIVE') return 'This hazard is no longer active.';
  if (status === 403) return 'Your account isn’t allowed to do that.';
  if (status === 404) return 'That hazard no longer exists.';
  if (status === 409) return 'Someone else changed this hazard just now. Refresh and try again.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'The server had a problem. Try again shortly.';
  return 'That request didn’t work. Check the details and try again.';
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await request(path, { signal })).json() as Promise<T>;
}

function queueParams(q: QueueQuery, page: number, size: number) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q.view) p.set('view', q.view);
  if (q.statuses?.length) p.set('statuses', q.statuses.join(','));
  if (q.types?.length) p.set('types', q.types.join(','));
  if (q.severities?.length) p.set('severities', q.severities.join(','));
  if (q.confidences?.length) p.set('confidences', q.confidences.join(','));
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.bbox) p.set('bbox', q.bbox.join(','));
  if (q.sort) p.set('sort', q.sort);
  return p;
}

export const api = {
  queuePage(q: QueueQuery, page = 0, size = 100, signal?: AbortSignal) {
    return getJson<Page<Hazard>>(`/moderation/hazards?${queueParams(q, page, size)}`, signal);
  },

  /** Every matching hazard up to `max`, fetched 100 at a time. */
  async queueAll(q: QueueQuery, max = 500, signal?: AbortSignal) {
    const items: Hazard[] = [];
    let total = 0;
    for (let page = 0; items.length < max; page++) {
      const res = await api.queuePage(q, page, 100, signal);
      items.push(...res.items);
      total = res.totalItems;
      if (!res.hasMore) break;
    }
    return { items: items.slice(0, max), total, truncated: total > max };
  },

  stats(from?: string, to?: string, signal?: AbortSignal) {
    const p = new URLSearchParams({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila' });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return getJson<Stats>(`/moderation/stats?${p}`, signal);
  },

  activity(opts: { page?: number; size?: number; hazardId?: string; actions?: string[]; staffOnly?: boolean }, signal?: AbortSignal) {
    const p = new URLSearchParams({ page: String(opts.page ?? 0), size: String(opts.size ?? 50) });
    if (opts.hazardId) p.set('hazardId', opts.hazardId);
    if (opts.actions?.length) p.set('actions', opts.actions.join(','));
    if (opts.staffOnly) p.set('staffOnly', 'true');
    return getJson<Page<ActivityEntry>>(`/moderation/activity?${p}`, signal);
  },

  hazard(id: string, signal?: AbortSignal) {
    return getJson<HazardDetail>(`/hazards/${id}`, signal);
  },

  history(id: string, signal?: AbortSignal) {
    return getJson<TimelineEntry[]>(`/hazards/${id}/history`, signal);
  },

  /** Asynchronous on the server (202): the new status arrives a moment later. */
  async resolve(id: string, note: string) {
    await request(`/hazards/${id}/resolve`, { method: 'POST', json: { note: note || null } });
  },

  async reopen(id: string, note: string) {
    await request(`/hazards/${id}/reopen`, { method: 'POST', json: { note: note || null } });
  },

  async remove(id: string, reason: string) {
    await request(`/hazards/${id}?${new URLSearchParams({ reason })}`, { method: 'DELETE' });
  },
};

export function photoSrc(photoUrl: string) {
  return /^https?:\/\//.test(photoUrl) ? photoUrl : `${API_ORIGIN}${photoUrl}`;
}
