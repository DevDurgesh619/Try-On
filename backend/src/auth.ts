/**
 * Auth — Google token validation + Worker-issued JWTs.
 *
 * Two token types:
 *   - access JWT: short-lived (1 hour), sent on every authenticated request as
 *     `Authorization: Bearer <jwt>`. Carries `sub` = user.id.
 *   - refresh JWT: long-lived (90 days), sent only to /auth/refresh. Carries
 *     `sub` = user.id and `typ` = 'refresh'. Stored in chrome.storage.local.
 *
 * Both signed with HMAC HS256 against secrets injected as Worker secrets:
 *   - JWT_SIGNING_KEY (access)
 *   - REFRESH_SIGNING_KEY (refresh)
 *
 * Two distinct secrets so a leaked access secret can't mint refresh tokens
 * (which would let an attacker silently extend their grip indefinitely).
 */

import { SignJWT, jwtVerify, errors } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

const ISSUER = 'tryon';

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
}

export interface AccessClaims {
  sub: string; // user.id
  iat: number;
  exp: number;
  iss: string;
}

export interface RefreshClaims {
  sub: string;
  typ: 'refresh';
  iat: number;
  exp: number;
  iss: string;
}

export type ValidateResult<T> =
  | { ok: true; claims: T }
  | { ok: false; reason: 'expired' | 'invalid' };

function keyFromSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Exchange a Google OAuth access token for the user's profile (sub + email).
 * Throws if the token is invalid or the call fails.
 *
 * fetchImpl is injected for tests.
 */
export async function fetchGoogleUserInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleUserInfo> {
  if (!accessToken) throw new Error('missing google access token');
  const res = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google_userinfo_${res.status}`);
  }
  const json = (await res.json()) as Partial<GoogleUserInfo>;
  if (typeof json.sub !== 'string' || typeof json.email !== 'string') {
    throw new Error('google_userinfo_malformed');
  }
  if (json.email_verified !== true) {
    // Google should only let verified accounts through OAuth, but be paranoid.
    throw new Error('google_email_unverified');
  }
  return { sub: json.sub, email: json.email, email_verified: true };
}

export async function signAccessToken(
  userId: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ACCESS_TOKEN_TTL_SECONDS)
    .sign(keyFromSecret(secret));
}

export async function signRefreshToken(
  userId: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + REFRESH_TOKEN_TTL_SECONDS)
    .sign(keyFromSecret(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<ValidateResult<AccessClaims>> {
  try {
    const { payload } = await jwtVerify(token, keyFromSecret(secret), {
      issuer: ISSUER,
    });
    if (typeof payload.sub !== 'string') return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      claims: {
        sub: payload.sub,
        iat: typeof payload.iat === 'number' ? payload.iat : 0,
        exp: typeof payload.exp === 'number' ? payload.exp : 0,
        iss: typeof payload.iss === 'string' ? payload.iss : '',
      },
    };
  } catch (e) {
    if (e instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

export async function verifyRefreshToken(
  token: string,
  secret: string,
): Promise<ValidateResult<RefreshClaims>> {
  try {
    const { payload } = await jwtVerify(token, keyFromSecret(secret), {
      issuer: ISSUER,
    });
    if (typeof payload.sub !== 'string') return { ok: false, reason: 'invalid' };
    if (payload.typ !== 'refresh') return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      claims: {
        sub: payload.sub,
        typ: 'refresh',
        iat: typeof payload.iat === 'number' ? payload.iat : 0,
        exp: typeof payload.exp === 'number' ? payload.exp : 0,
        iss: typeof payload.iss === 'string' ? payload.iss : '',
      },
    };
  } catch (e) {
    if (e instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

/** Pulls a Bearer token from an Authorization header. */
export function extractBearer(headers: Headers): string | null {
  const h = headers.get('authorization') ?? headers.get('Authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}
