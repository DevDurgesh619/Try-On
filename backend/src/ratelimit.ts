// Dev override (200). Production beta limit per decisions.md D2 is 5/UTC-day —
// reset before deploy.
export const DAILY_LIMIT = 200;

export interface RateLimitStore {
  /** Atomically increment the count for the given key (UTC-day scoped). Returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  remaining: number;
  resetEpochMs: number;
}

export function utcDayKey(deviceId: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `rl:${deviceId}:${y}-${m}-${d}`;
}

export function nextUtcMidnight(now: Date = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime();
}

export async function checkAndIncrement(
  store: RateLimitStore,
  deviceId: string,
  limit = DAILY_LIMIT,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const key = utcDayKey(deviceId, now);
  const ttl = Math.max(60, Math.ceil((nextUtcMidnight(now) - now.getTime()) / 1000));
  const used = await store.incr(key, ttl);
  return {
    allowed: used <= limit,
    used,
    remaining: Math.max(0, limit - used),
    resetEpochMs: nextUtcMidnight(now),
  };
}

export class KvRateLimitStore implements RateLimitStore {
  constructor(private readonly kv: KVNamespace) {}
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = await this.kv.get(key);
    const next = (current ? Number.parseInt(current, 10) : 0) + 1;
    await this.kv.put(key, String(next), { expirationTtl: ttlSeconds });
    return next;
  }
}
