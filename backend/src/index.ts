import { RestGeminiClient, handleGenerate, type GenerateDeps } from './generate';
import { createD1Db, type Db } from './db';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  extractBearer,
  fetchGoogleUserInfo,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './auth';
import { addToWaitlist, isValidEmail } from './waitlist';
import { nextUtcMidnightMs } from './credits';

export interface Env {
  GEMINI_API_KEY?: string;
  /** D1 binding — owns users, ledger, device_free_credits, waitlist. */
  DB?: D1Database;
  /** Worker secret for signing access JWTs. */
  JWT_SIGNING_KEY?: string;
  /** Worker secret for signing refresh JWTs. */
  REFRESH_SIGNING_KEY?: string;
}

/**
 * Test-time overrides. Extends Partial<GenerateDeps> (so existing /generate
 * tests can pass `gemini`, `db`, `now`, `uuid`, `timeoutMs` directly), plus
 * `fetchImpl` for mocking Google's userinfo endpoint.
 */
export interface RouteOverrides extends Partial<GenerateDeps> {
  /** When set, replaces global fetch (used to mock Google's /userinfo endpoint). */
  fetchImpl?: typeof fetch;
}

function jsonErr(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, code, message }, { status });
}

function getDb(env: Env, overrides?: RouteOverrides): Db | null {
  if (overrides && 'db' in overrides) return (overrides.db as Db | null | undefined) ?? null;
  return env.DB ? createD1Db(env.DB) : null;
}

function corsHeaders(): Record<string, string> {
  // Extension calls hit this Worker from chrome-extension://… origins. Allow
  // cross-origin so DevTools doesn't show CORS errors during dev.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TryOn-Build',
    'Access-Control-Max-Age': '86400',
  };
}

export async function handle(
  request: Request,
  env: Env,
  overrides?: RouteOverrides,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health -------------------------------------------------------------
  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json({ ok: true }, { headers: corsHeaders() });
  }

  // Auth: Google sign-in ----------------------------------------------
  if (request.method === 'POST' && url.pathname === '/auth/google') {
    return wrapCors(await handleAuthGoogle(request, env, overrides));
  }

  // Auth: refresh -----------------------------------------------------
  if (request.method === 'POST' && url.pathname === '/auth/refresh') {
    return wrapCors(await handleAuthRefresh(request, env));
  }

  // /me ---------------------------------------------------------------
  if (request.method === 'GET' && url.pathname === '/me') {
    return wrapCors(await handleMe(request, env, overrides));
  }

  // Waitlist ----------------------------------------------------------
  if (request.method === 'POST' && url.pathname === '/waitlist') {
    return wrapCors(await handleWaitlist(request, env, overrides));
  }

  // Generate ----------------------------------------------------------
  if (request.method === 'POST' && url.pathname === '/generate') {
    if (!env.GEMINI_API_KEY && !overrides?.gemini) {
      return wrapCors(jsonErr('backend_error', 'GEMINI_API_KEY not configured', 500));
    }
    const deps: GenerateDeps = {
      gemini: overrides?.gemini ?? new RestGeminiClient(env.GEMINI_API_KEY ?? ''),
      db: overrides && 'db' in overrides ? (overrides.db ?? null) : getDb(env, overrides),
      jwtSecret: env.JWT_SIGNING_KEY ?? '',
      ...(overrides?.now ? { now: overrides.now } : {}),
      ...(overrides?.uuid ? { uuid: overrides.uuid } : {}),
      ...(overrides?.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
    };
    return wrapCors(await handleGenerate(request, env, deps));
  }

  return wrapCors(new Response('Not found', { status: 404 }));
}

function wrapCors(res: Response): Response {
  // Response headers are immutable when constructed from Response.json — copy.
  const merged = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) merged.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}

// ---------- /auth/google ----------

async function handleAuthGoogle(
  request: Request,
  env: Env,
  overrides?: RouteOverrides,
): Promise<Response> {
  const db = getDb(env, overrides);
  if (!db) return jsonErr('backend_error', 'DB not configured', 500);
  if (!env.JWT_SIGNING_KEY || !env.REFRESH_SIGNING_KEY) {
    return jsonErr('backend_error', 'auth secrets not configured', 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErr('invalid_body', 'Body must be JSON', 400);
  }
  const b = body as { google_access_token?: unknown; device_id?: unknown };
  if (typeof b.google_access_token !== 'string' || b.google_access_token.length === 0) {
    return jsonErr('invalid_body', 'google_access_token required', 400);
  }

  const fetchImpl = overrides?.fetchImpl ?? fetch;
  let info;
  try {
    info = await fetchGoogleUserInfo(b.google_access_token, fetchImpl);
  } catch (e) {
    return jsonErr('auth_required', e instanceof Error ? e.message : 'google_auth_failed', 401);
  }

  const nowDate = (overrides?.now ?? ((): Date => new Date()))();
  const nowMs = nowDate.getTime();
  const nowSec = Math.floor(nowMs / 1000);
  const uuid = overrides?.uuid ?? crypto.randomUUID.bind(crypto);

  const user = await db.createUserWithSignupBonus({
    id: uuid(),
    google_sub: info.sub,
    email: info.email,
    now: nowMs,
    daily_resets_at: nextUtcMidnightMs(nowDate),
    ledger_id: uuid(),
  });

  const accessJwt = await signAccessToken(user.id, env.JWT_SIGNING_KEY, nowSec);
  const refreshJwt = await signRefreshToken(user.id, env.REFRESH_SIGNING_KEY, nowSec);

  const free_remaining = Math.max(0, 5 - user.free_credits_used);
  return Response.json({
    ok: true,
    access_jwt: accessJwt,
    refresh_jwt: refreshJwt,
    access_expires_at: nowSec + ACCESS_TOKEN_TTL_SECONDS,
    user: {
      email: user.email,
      free_credits_remaining: free_remaining,
      paid_credits_balance: user.paid_credits_balance,
      credits_remaining: free_remaining + user.paid_credits_balance,
    },
  });
}

// ---------- /auth/refresh ----------

async function handleAuthRefresh(request: Request, env: Env): Promise<Response> {
  if (!env.JWT_SIGNING_KEY || !env.REFRESH_SIGNING_KEY) {
    return jsonErr('backend_error', 'auth secrets not configured', 500);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErr('invalid_body', 'Body must be JSON', 400);
  }
  const b = body as { refresh_jwt?: unknown };
  if (typeof b.refresh_jwt !== 'string') {
    return jsonErr('invalid_body', 'refresh_jwt required', 400);
  }
  const verified = await verifyRefreshToken(b.refresh_jwt, env.REFRESH_SIGNING_KEY);
  if (!verified.ok) {
    return jsonErr(
      verified.reason === 'expired' ? 'auth_expired' : 'auth_required',
      verified.reason === 'expired' ? 'Refresh token expired' : 'Invalid refresh token',
      401,
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const accessJwt = await signAccessToken(verified.claims.sub, env.JWT_SIGNING_KEY, nowSec);
  return Response.json({
    ok: true,
    access_jwt: accessJwt,
    access_expires_at: nowSec + ACCESS_TOKEN_TTL_SECONDS,
  });
}

// ---------- /me ----------

async function handleMe(
  request: Request,
  env: Env,
  overrides?: RouteOverrides,
): Promise<Response> {
  const db = getDb(env, overrides);
  if (!db) return jsonErr('backend_error', 'DB not configured', 500);
  if (!env.JWT_SIGNING_KEY) {
    return jsonErr('backend_error', 'auth not configured', 500);
  }
  const bearer = extractBearer(request.headers);
  if (!bearer) return jsonErr('auth_required', 'Bearer token required', 401);
  const verified = await verifyAccessToken(bearer, env.JWT_SIGNING_KEY);
  if (!verified.ok) {
    return jsonErr(
      verified.reason === 'expired' ? 'auth_expired' : 'auth_required',
      verified.reason === 'expired' ? 'Access token expired' : 'Invalid auth token',
      401,
    );
  }
  const user = await db.getUserById(verified.claims.sub);
  if (!user) return jsonErr('auth_required', 'user not found', 401);
  const free_remaining = Math.max(0, 5 - user.free_credits_used);
  return Response.json({
    ok: true,
    user: {
      email: user.email,
      free_credits_remaining: free_remaining,
      paid_credits_balance: user.paid_credits_balance,
      credits_remaining: free_remaining + user.paid_credits_balance,
      daily_used: user.daily_used,
      daily_limit: 50,
    },
  });
}

// ---------- /waitlist ----------

async function handleWaitlist(
  request: Request,
  env: Env,
  overrides?: RouteOverrides,
): Promise<Response> {
  const db = getDb(env, overrides);
  if (!db) return jsonErr('backend_error', 'DB not configured', 500);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErr('invalid_body', 'Body must be JSON', 400);
  }
  const b = body as { email?: unknown; device_id?: unknown; user_id?: unknown };
  if (typeof b.email !== 'string' || !isValidEmail(b.email)) {
    return jsonErr('invalid_body', 'valid email required', 400);
  }
  const nowMs = (overrides?.now ?? ((): Date => new Date()))().getTime();
  await addToWaitlist(db, {
    email: b.email,
    device_id: typeof b.device_id === 'string' ? b.device_id : null,
    user_id: typeof b.user_id === 'string' ? b.user_id : null,
    now: nowMs,
  });
  return Response.json({ ok: true });
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
