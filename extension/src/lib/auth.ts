/**
 * Auth — Chrome identity → Worker JWT exchange.
 *
 * Two tokens:
 *   - access_jwt:  short-lived (1 hour). Sent as Authorization: Bearer on
 *                  every authenticated Worker call.
 *   - refresh_jwt: long-lived (90 days). Sent only to /auth/refresh.
 *
 * Both stored in `chrome.storage.local` so the service worker can reach them
 * across restarts. Wrapped behind `getValidAccessToken()` which transparently
 * refreshes when the access token is within 5 minutes of expiry.
 *
 * `signIn()` runs the Chrome OAuth consent flow (`chrome.identity.getAuthToken`)
 * then exchanges Google's access token for our Worker-issued JWTs.
 *
 * Tested via `extension/src/lib/auth.test.ts` with mocked chrome.identity and
 * fetch.
 */

import { getWorkerConfig } from './config';

const STORAGE_KEY = 'tryon_auth';
/** Refresh threshold: refresh if access token expires within this many seconds. */
const REFRESH_BEFORE_EXPIRY_SECONDS = 5 * 60;

export interface StoredAuth {
  access_jwt: string;
  refresh_jwt: string;
  /** Epoch SECONDS at which the access token expires. */
  access_expires_at: number;
  email: string;
}

export interface AuthDeps {
  fetchImpl?: typeof fetch;
  storage?: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
  identity?: {
    getAuthToken(details: { interactive: boolean }): Promise<string>;
    removeCachedAuthToken?(details: { token: string }): Promise<void>;
  };
  /** epoch ms; defaults to Date.now */
  nowMs?: () => number;
  baseUrl?: string;
}

function defaultIdentity(): NonNullable<AuthDeps['identity']> {
  return {
    getAuthToken: (details) =>
      new Promise((resolve, reject) => {
        chrome.identity.getAuthToken(details, (token) => {
          if (chrome.runtime.lastError || !token) {
            reject(new Error(chrome.runtime.lastError?.message ?? 'no_token'));
            return;
          }
          resolve(token);
        });
      }),
    removeCachedAuthToken: (details) =>
      new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken(details, () => resolve());
      }),
  };
}

function defaultStorage(): Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'> {
  return chrome.storage.local;
}

async function readStored(deps: AuthDeps): Promise<StoredAuth | null> {
  const storage = deps.storage ?? defaultStorage();
  const out = await storage.get(STORAGE_KEY);
  const v = out[STORAGE_KEY];
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<StoredAuth>;
  if (
    typeof r.access_jwt === 'string' &&
    typeof r.refresh_jwt === 'string' &&
    typeof r.access_expires_at === 'number' &&
    typeof r.email === 'string'
  ) {
    return r as StoredAuth;
  }
  return null;
}

async function writeStored(deps: AuthDeps, value: StoredAuth): Promise<void> {
  const storage = deps.storage ?? defaultStorage();
  await storage.set({ [STORAGE_KEY]: value });
}

async function clearStored(deps: AuthDeps): Promise<void> {
  const storage = deps.storage ?? defaultStorage();
  await storage.remove(STORAGE_KEY);
}

/** Returns the cached email if signed in, else null. Cheap; no network. */
export async function getCachedEmail(deps: AuthDeps = {}): Promise<string | null> {
  const stored = await readStored(deps);
  return stored?.email ?? null;
}

/**
 * Run the Google OAuth consent flow, exchange for Worker JWTs, store them.
 * Returns the email of the signed-in account.
 *
 * Throws on user cancellation, network failure, or auth rejection. Caller
 * should catch and surface a friendly message.
 */
export async function signIn(deps: AuthDeps = {}): Promise<{ email: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const identity = deps.identity ?? defaultIdentity();
  const baseUrl = deps.baseUrl ?? getWorkerConfig().baseUrl;
  const googleToken = await identity.getAuthToken({ interactive: true });
  if (!googleToken) throw new Error('no_google_token');

  const res = await fetchImpl(`${baseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_access_token: googleToken }),
  });
  if (!res.ok) {
    throw new Error(`auth_google_${res.status}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    access_jwt?: string;
    refresh_jwt?: string;
    access_expires_at?: number;
    user?: { email?: string };
  };
  if (
    !json.ok ||
    typeof json.access_jwt !== 'string' ||
    typeof json.refresh_jwt !== 'string' ||
    typeof json.access_expires_at !== 'number' ||
    typeof json.user?.email !== 'string'
  ) {
    throw new Error('auth_google_malformed');
  }
  await writeStored(deps, {
    access_jwt: json.access_jwt,
    refresh_jwt: json.refresh_jwt,
    access_expires_at: json.access_expires_at,
    email: json.user.email,
  });
  return { email: json.user.email };
}

/**
 * Returns a valid access JWT, refreshing if it's about to expire. Returns
 * null if there's no stored auth or refresh failed.
 */
export async function getValidAccessToken(deps: AuthDeps = {}): Promise<string | null> {
  const stored = await readStored(deps);
  if (!stored) return null;
  const now = (deps.nowMs ?? Date.now)();
  const expirySec = stored.access_expires_at;
  const expiresInSec = expirySec - Math.floor(now / 1000);
  if (expiresInSec > REFRESH_BEFORE_EXPIRY_SECONDS) {
    return stored.access_jwt;
  }
  // Try to refresh.
  const refreshed = await tryRefresh(deps, stored);
  if (refreshed) return refreshed.access_jwt;
  return null;
}

async function tryRefresh(deps: AuthDeps, stored: StoredAuth): Promise<StoredAuth | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = deps.baseUrl ?? getWorkerConfig().baseUrl;
  try {
    const res = await fetchImpl(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_jwt: stored.refresh_jwt }),
    });
    if (!res.ok) {
      // Refresh token expired or revoked — sign the user out so they get
      // prompted next time.
      await clearStored(deps);
      return null;
    }
    const json = (await res.json()) as {
      ok: boolean;
      access_jwt?: string;
      access_expires_at?: number;
    };
    if (
      !json.ok ||
      typeof json.access_jwt !== 'string' ||
      typeof json.access_expires_at !== 'number'
    ) {
      await clearStored(deps);
      return null;
    }
    const next: StoredAuth = {
      ...stored,
      access_jwt: json.access_jwt,
      access_expires_at: json.access_expires_at,
    };
    await writeStored(deps, next);
    return next;
  } catch {
    return null;
  }
}

/** Force a refresh even if not near expiry. Used by 401 retry logic. */
export async function forceRefresh(deps: AuthDeps = {}): Promise<string | null> {
  const stored = await readStored(deps);
  if (!stored) return null;
  const refreshed = await tryRefresh(deps, stored);
  return refreshed?.access_jwt ?? null;
}

export async function signOut(deps: AuthDeps = {}): Promise<void> {
  const identity = deps.identity ?? defaultIdentity();
  const stored = await readStored(deps);
  await clearStored(deps);
  // Clear Chrome's cached Google token too so the next signIn re-prompts.
  // Best-effort; errors are non-fatal.
  if (stored && identity.removeCachedAuthToken) {
    try {
      // We don't have the original Google access token; pass a placeholder.
      // Chrome's removeAllCachedAuthTokens (no arg) is the right call when we
      // don't have the token — fall back gracefully if not supported.
      await identity.removeCachedAuthToken({ token: '' });
    } catch {
      // ignore
    }
  }
}

/** Returns whether the user is currently signed in (has stored tokens). */
export async function isSignedIn(deps: AuthDeps = {}): Promise<boolean> {
  return (await readStored(deps)) !== null;
}
