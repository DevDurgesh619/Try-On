import { describe, it, expect } from 'vitest';
import { handle, type Env, type RouteOverrides } from './index';
import { createMemoryDb } from './db.test-helpers';
import { extractBearer, signAccessToken } from './auth';

const SECRET = 'test-jwt-signing-key-must-be-long-enough-for-hs256-tests-here-okay';
const REFRESH_SECRET = 'test-refresh-signing-key-different-from-the-access-secret-yes-okay';

function envWithSecrets(): Env {
  return {
    GEMINI_API_KEY: 'k',
    JWT_SIGNING_KEY: SECRET,
    REFRESH_SIGNING_KEY: REFRESH_SECRET,
  };
}

function googleUserInfoFetch(
  body: Partial<{ sub: string; email: string; email_verified: boolean }> = {},
): typeof fetch {
  const full = { sub: 'g-123', email: 'a@b.com', email_verified: true, ...body };
  return ((async (input: string) => {
    if (typeof input === 'string' && input.includes('userinfo')) {
      return new Response(JSON.stringify(full), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not-mocked', { status: 500 });
  }) as unknown) as typeof fetch;
}

describe('POST /auth/google', () => {
  it('first sign-in creates user, grants signup bonus, returns access+refresh JWTs', async () => {
    const { db, state } = createMemoryDb();
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch(),
      uuid: ((): () => string => {
        let n = 0;
        return () => `uuid-${n++}`;
      })(),
    };
    const req = new Request('https://x.test/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_access_token: 'g-tok', device_id: 'd1' }),
    });
    const res = await handle(req, envWithSecrets(), overrides);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      access_jwt: string;
      refresh_jwt: string;
      user: { email: string; credits_remaining: number; free_credits_remaining: number };
    };
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('a@b.com');
    expect(body.user.free_credits_remaining).toBe(5); // signup bonus
    expect(body.user.credits_remaining).toBe(5);
    expect(state.users.size).toBe(1);
  });

  it('is idempotent on google_sub: second sign-in returns the same user, NOT a fresh bonus', async () => {
    const { db } = createMemoryDb();
    let counter = 0;
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch(),
      uuid: () => `uuid-${counter++}`,
    };
    const env = envWithSecrets();
    const req = (): Request =>
      new Request('https://x.test/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_access_token: 'g-tok' }),
      });
    await handle(req(), env, overrides);
    const second = await handle(req(), env, overrides);
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      user: { free_credits_remaining: number };
    };
    expect(body.user.free_credits_remaining).toBe(5); // same as before; no double bonus
  });

  it('rejects an unverified Google email', async () => {
    const { db } = createMemoryDb();
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch({ email_verified: false }),
    };
    const req = new Request('https://x.test/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_access_token: 'g-tok' }),
    });
    const res = await handle(req, envWithSecrets(), overrides);
    expect(res.status).toBe(401);
  });

  it('rejects when google_access_token is missing', async () => {
    const { db } = createMemoryDb();
    const req = new Request('https://x.test/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handle(req, envWithSecrets(), { db, fetchImpl: googleUserInfoFetch() });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/refresh', () => {
  it('valid refresh token returns a new access token', async () => {
    const { db } = createMemoryDb();
    let counter = 0;
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch(),
      uuid: () => `uuid-${counter++}`,
    };
    const env = envWithSecrets();
    const signin = await handle(
      new Request('https://x.test/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_access_token: 'g-tok' }),
      }),
      env,
      overrides,
    );
    const { refresh_jwt } = (await signin.json()) as { refresh_jwt: string };
    const refresh = await handle(
      new Request('https://x.test/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_jwt }),
      }),
      env,
    );
    expect(refresh.status).toBe(200);
    const body = (await refresh.json()) as { ok: boolean; access_jwt: string };
    expect(body.ok).toBe(true);
    expect(typeof body.access_jwt).toBe('string');
  });

  it('rejects a malformed refresh token', async () => {
    const res = await handle(
      new Request('https://x.test/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_jwt: 'not.a.token' }),
      }),
      envWithSecrets(),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /me', () => {
  it('returns the user record for a valid access token', async () => {
    const { db } = createMemoryDb();
    let counter = 0;
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch(),
      uuid: () => `uuid-${counter++}`,
    };
    const env = envWithSecrets();
    const signin = await handle(
      new Request('https://x.test/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_access_token: 'g-tok' }),
      }),
      env,
      overrides,
    );
    const { access_jwt } = (await signin.json()) as { access_jwt: string };
    const me = await handle(
      new Request('https://x.test/me', {
        headers: { Authorization: `Bearer ${access_jwt}` },
      }),
      env,
      overrides,
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      user: { email: string; credits_remaining: number; daily_used: number; daily_limit: number };
    };
    expect(body.user.email).toBe('a@b.com');
    expect(body.user.credits_remaining).toBe(5);
    expect(body.user.daily_limit).toBe(50);
  });

  it('rejects /me without an Authorization header', async () => {
    const res = await handle(
      new Request('https://x.test/me'),
      envWithSecrets(),
      { db: createMemoryDb().db },
    );
    expect(res.status).toBe(401);
  });

  it('rejects a forged token (different secret)', async () => {
    const forged = await signAccessToken('u-forge', 'totally-different-secret-xxxxx');
    const res = await handle(
      new Request('https://x.test/me', {
        headers: { Authorization: `Bearer ${forged}` },
      }),
      envWithSecrets(),
      { db: createMemoryDb().db },
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /waitlist', () => {
  it('inserts a row and is idempotent on email', async () => {
    const { db, state } = createMemoryDb();
    const env = envWithSecrets();
    const overrides: RouteOverrides = { db };
    const req = (): Request =>
      new Request('https://x.test/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'pinky@gmail.com', device_id: 'd9' }),
      });
    const r1 = await handle(req(), env, overrides);
    expect(r1.status).toBe(200);
    const r2 = await handle(req(), env, overrides);
    expect(r2.status).toBe(200);
    expect(state.waitlist.size).toBe(1);
    const row = state.waitlist.get('pinky@gmail.com');
    expect(row?.device_id).toBe('d9');
  });

  it('rejects an invalid email', async () => {
    const { db } = createMemoryDb();
    const res = await handle(
      new Request('https://x.test/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
      envWithSecrets(),
      { db },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /generate — auth + credits integration', () => {
  it('Bearer JWT path: decrements user credits, succeeds, returns image', async () => {
    const { db, state } = createMemoryDb();
    let counter = 0;
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch(),
      uuid: () => `uuid-${counter++}`,
      gemini: { generate: async () => [{ inlineData: { mimeType: 'image/png', data: 'PNG' } }] },
    };
    const env = envWithSecrets();
    const signin = await handle(
      new Request('https://x.test/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_access_token: 'g-tok' }),
      }),
      env,
      overrides,
    );
    const { access_jwt } = (await signin.json()) as { access_jwt: string };
    const userIdBefore = Array.from(state.users.values())[0];
    expect(userIdBefore?.free_credits_used).toBe(0);

    const gen = await handle(
      new Request('https://x.test/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_jwt}`,
        },
        body: JSON.stringify({
          device_id: 'd-irrelevant',
          mode: 'outfit',
          reference_photo: 'AA',
          reference_mime: 'image/jpeg',
          garments: [{ slot: 'full', image: 'BB', mime: 'image/jpeg' }],
          accessoriesMode: 'off',
        }),
      }),
      env,
      overrides,
    );
    expect(gen.status).toBe(200);
    const userAfter = Array.from(state.users.values())[0];
    expect(userAfter?.free_credits_used).toBe(1);
  });

  it('Bearer JWT path: 6th sign-in-bonus generation returns 402 out_of_credits', async () => {
    const { db } = createMemoryDb();
    let counter = 0;
    const overrides: RouteOverrides = {
      db,
      fetchImpl: googleUserInfoFetch(),
      uuid: () => `uuid-${counter++}`,
      gemini: { generate: async () => [{ inlineData: { mimeType: 'image/png', data: 'PNG' } }] },
    };
    const env = envWithSecrets();
    const signin = await handle(
      new Request('https://x.test/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_access_token: 'g-tok' }),
      }),
      env,
      overrides,
    );
    const { access_jwt } = (await signin.json()) as { access_jwt: string };
    const generate = (): Request =>
      new Request('https://x.test/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_jwt}`,
        },
        body: JSON.stringify({
          device_id: 'd',
          mode: 'outfit',
          reference_photo: 'AA',
          reference_mime: 'image/jpeg',
          garments: [{ slot: 'full', image: 'BB', mime: 'image/jpeg' }],
          accessoriesMode: 'off',
        }),
      });
    for (let i = 0; i < 5; i++) {
      const r = await handle(generate(), env, overrides);
      expect(r.status).toBe(200);
    }
    const overflow = await handle(generate(), env, overrides);
    expect(overflow.status).toBe(402);
    const j = (await overflow.json()) as { code: string };
    expect(j.code).toBe('out_of_credits');
  });

  it('expired Bearer JWT returns 401 auth_expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 99999;
    const expired = await signAccessToken('u-expired', SECRET, past);
    const env = envWithSecrets();
    const overrides: RouteOverrides = {
      db: createMemoryDb().db,
      gemini: { generate: async () => [] },
    };
    const res = await handle(
      new Request('https://x.test/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${expired}`,
        },
        body: JSON.stringify({
          device_id: 'd',
          mode: 'outfit',
          reference_photo: 'AA',
          reference_mime: 'image/jpeg',
          garments: [{ slot: 'full', image: 'BB', mime: 'image/jpeg' }],
          accessoriesMode: 'off',
        }),
      }),
      env,
      overrides,
    );
    expect(res.status).toBe(401);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe('auth_expired');
  });
});

// Sanity guard: the auth module's extractBearer is exported; these tests
// exercise its integration via /me header, so a quick unit check here too.
describe('extractBearer (smoke)', () => {
  it('returns the token after Bearer', () => {
    const h = new Headers({ Authorization: 'Bearer xyz' });
    expect(extractBearer(h)).toBe('xyz');
  });
});
