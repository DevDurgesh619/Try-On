import { describe, it, expect } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  extractBearer,
  fetchGoogleUserInfo,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './auth';

const SECRET = 'this-is-a-test-secret-do-not-use-in-prod-it-is-not-a-real-secret-okay';
const SECRET_2 = 'a-different-secret-for-the-attacker-tests-must-not-equal-the-real-one';

describe('access tokens', () => {
  it('round-trip: signed token verifies with the same secret', async () => {
    const jwt = await signAccessToken('user-1', SECRET);
    const v = await verifyAccessToken(jwt, SECRET);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.claims.sub).toBe('user-1');
  });

  it('rejects a token signed with a different secret', async () => {
    const jwt = await signAccessToken('user-1', SECRET);
    const v = await verifyAccessToken(jwt, SECRET_2);
    expect(v.ok).toBe(false);
  });

  it('rejects garbage', async () => {
    const v = await verifyAccessToken('not-a-jwt', SECRET);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('invalid');
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - ACCESS_TOKEN_TTL_SECONDS - 1000;
    const jwt = await signAccessToken('user-1', SECRET, past);
    const v = await verifyAccessToken(jwt, SECRET);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('expired');
  });
});

describe('refresh tokens', () => {
  it('round-trip works', async () => {
    const jwt = await signRefreshToken('user-r', SECRET);
    const v = await verifyRefreshToken(jwt, SECRET);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.claims.sub).toBe('user-r');
      expect(v.claims.typ).toBe('refresh');
    }
  });

  it("verifyRefreshToken rejects an access token (typ mismatch)", async () => {
    const access = await signAccessToken('u', SECRET);
    const v = await verifyRefreshToken(access, SECRET);
    expect(v.ok).toBe(false);
  });

  it("verifyAccessToken on a refresh token: signature check still passes but it's a no-op for our app code", async () => {
    // Refresh token is a valid JWT with the same algorithm but different
    // claims. verifyAccessToken doesn't enforce typ, so it'd return ok=true
    // with sub=user-r. Our auth ROUTES are responsible for using the right
    // verify function for the right header. This test pins that contract.
    const refresh = await signRefreshToken('u', SECRET);
    const v = await verifyAccessToken(refresh, SECRET);
    expect(v.ok).toBe(true); // intentional — verify functions are typ-agnostic on the access side
  });

  it('refresh tokens have a much longer lifetime than access tokens', () => {
    expect(REFRESH_TOKEN_TTL_SECONDS).toBeGreaterThan(ACCESS_TOKEN_TTL_SECONDS * 24);
  });
});

describe('extractBearer', () => {
  it('finds a Bearer token', () => {
    const h = new Headers({ Authorization: 'Bearer abc.def.ghi' });
    expect(extractBearer(h)).toBe('abc.def.ghi');
  });
  it('case-insensitive on the scheme', () => {
    const h = new Headers({ Authorization: 'bearer abc' });
    expect(extractBearer(h)).toBe('abc');
  });
  it('returns null without a header', () => {
    expect(extractBearer(new Headers())).toBeNull();
  });
  it('returns null on a non-Bearer scheme', () => {
    const h = new Headers({ Authorization: 'Basic abc' });
    expect(extractBearer(h)).toBeNull();
  });
});

describe('fetchGoogleUserInfo', () => {
  it('returns sub + email on a valid response', async () => {
    const fakeFetch = ((async () =>
      new Response(
        JSON.stringify({ sub: 'g-123', email: 'a@b.com', email_verified: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown) as typeof fetch;
    const info = await fetchGoogleUserInfo('tok', fakeFetch);
    expect(info.sub).toBe('g-123');
    expect(info.email).toBe('a@b.com');
  });

  it('rejects an unverified email', async () => {
    const fakeFetch = ((async () =>
      new Response(
        JSON.stringify({ sub: 'g-123', email: 'a@b.com', email_verified: false }),
        { status: 200 },
      )) as unknown) as typeof fetch;
    await expect(fetchGoogleUserInfo('tok', fakeFetch)).rejects.toThrow();
  });

  it('rejects a non-200 response', async () => {
    const fakeFetch = ((async () =>
      new Response('nope', { status: 401 })) as unknown) as typeof fetch;
    await expect(fetchGoogleUserInfo('tok', fakeFetch)).rejects.toThrow();
  });
});
