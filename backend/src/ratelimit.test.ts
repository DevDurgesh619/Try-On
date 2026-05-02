import { describe, it, expect } from 'vitest';
import {
  DAILY_LIMIT,
  KvRateLimitStore,
  checkAndIncrement,
  nextUtcMidnight,
  utcDayKey,
  type RateLimitStore,
} from './ratelimit';

class MemStore implements RateLimitStore {
  private c = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const n = (this.c.get(key) ?? 0) + 1;
    this.c.set(key, n);
    return n;
  }
}

describe('ratelimit', () => {
  it('utcDayKey is stable per UTC date', () => {
    const a = utcDayKey('dev-a', new Date('2026-05-02T01:00:00Z'));
    const b = utcDayKey('dev-a', new Date('2026-05-02T23:59:59Z'));
    const c = utcDayKey('dev-a', new Date('2026-05-03T00:00:00Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('nextUtcMidnight is the next 00:00 UTC', () => {
    const t = new Date('2026-05-02T15:00:00Z').getTime();
    const next = nextUtcMidnight(new Date(t));
    expect(new Date(next).toISOString()).toBe('2026-05-03T00:00:00.000Z');
  });

  it('blocks the (limit+1)th request in a day', async () => {
    const store = new MemStore();
    const dev = 'd1';
    for (let i = 1; i <= DAILY_LIMIT; i++) {
      const r = await checkAndIncrement(store, dev);
      expect(r.allowed).toBe(true);
      expect(r.used).toBe(i);
      expect(r.remaining).toBe(DAILY_LIMIT - i);
    }
    const overflow = await checkAndIncrement(store, dev);
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
  });

  it('KvRateLimitStore wraps a KV namespace', async () => {
    const fake: KVNamespace = {
      get: async () => null,
      put: async () => undefined,
    } as unknown as KVNamespace;
    const store = new KvRateLimitStore(fake);
    const n = await store.incr('k', 60);
    expect(n).toBe(1);
  });
});
