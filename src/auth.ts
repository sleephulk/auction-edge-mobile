// Login against the existing Auction Edge Supabase project, over its REST
// endpoints (no SDK). The access token is what FastAPI's default-deny boundary
// verifies, so every /api/mobile/* call carries it as a Bearer header.

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const KEY = 'aem_session_v1';
const REFRESH_MARGIN_S = 90;

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  email: string;
}

let session: Session | null = load();
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s.access_token && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

function store(s: Session | null): void {
  session = s;
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  for (const l of listeners) l(!!s);
}

async function tokenCall(grant: 'password' | 'refresh_token', body: object, email: string): Promise<Session> {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (j.error_description ?? j.msg ?? j.message ?? `login failed (${res.status})`) as string;
    throw new AuthError(msg, res.status);
  }
  const expiresIn = Number(j.expires_in ?? 3600);
  return {
    access_token: String(j.access_token),
    refresh_token: String(j.refresh_token),
    expires_at: Number(j.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn),
    email,
  };
}

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function isSignedIn(): boolean {
  return session !== null;
}

export function currentEmail(): string {
  return session?.email ?? '';
}

export function onAuthChange(cb: (signedIn: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function signIn(email: string, password: string): Promise<void> {
  store(await tokenCall('password', { email, password }, email));
}

export function signOut(): void {
  store(null);
}

async function refresh(): Promise<Session | null> {
  const cur = session;
  if (!cur) return null;
  if (!refreshing) {
    refreshing = tokenCall('refresh_token', { refresh_token: cur.refresh_token }, cur.email)
      .then((s) => {
        store(s);
        return s;
      })
      .catch((e: unknown) => {
        // A rejected refresh token means the login is gone; a network failure
        // does not, so only the former signs the user out.
        if (e instanceof AuthError && e.status >= 400 && e.status < 500) store(null);
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** A token good for at least the next minute, refreshed when needed. Null = signed out or offline. */
export async function accessToken(force = false): Promise<string | null> {
  if (!session) return null;
  const left = session.expires_at - Date.now() / 1000;
  if (force || left < REFRESH_MARGIN_S) {
    const s = await refresh();
    if (s) return s.access_token;
    // Offline but the old token still has life in it: use it.
    return session && !force && left > 5 ? session.access_token : null;
  }
  return session.access_token;
}
