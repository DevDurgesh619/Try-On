import { describe, it, expect } from 'vitest';
import { handle, type Env } from './index';

const env: Env = {};

describe('worker router', () => {
  it('returns ok on /health', async () => {
    const res = await handle(new Request('https://x.test/health'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('404s unknown routes', async () => {
    const res = await handle(new Request('https://x.test/nope'), env);
    expect(res.status).toBe(404);
  });
});
