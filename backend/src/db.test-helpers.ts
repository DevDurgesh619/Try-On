/**
 * In-memory implementation of Db for tests. Mirrors the semantics of the
 * D1 implementation in db.ts but uses Maps instead of SQL.
 */

import {
  ANON_FREE_CREDITS,
  PER_USER_DAILY_CAP,
  SIGNUP_BONUS_CREDITS,
  type DecrementResult,
  type Db,
  type DeviceRow,
  type LedgerRow,
  type UserRow,
  type WaitlistRow,
} from './db';

export interface MemDbState {
  users: Map<string, UserRow>;       // by user.id
  devices: Map<string, DeviceRow>;   // by device_id
  ledger: LedgerRow[];
  waitlist: Map<string, WaitlistRow>; // by email
}

export function createMemoryDb(state?: MemDbState): { db: Db; state: MemDbState } {
  const s: MemDbState = state ?? {
    users: new Map(),
    devices: new Map(),
    ledger: [],
    waitlist: new Map(),
  };

  // Async lock to serialize critical sections — mimics SQLite's row-level
  // atomicity for the test fake. Tests that fire concurrent calls use this to
  // observe the same correctness guarantees as the real D1 impl.
  let chain: Promise<unknown> = Promise.resolve();
  function locked<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = chain.then(fn);
    chain = next.catch(() => undefined);
    return next;
  }

  function findBySub(sub: string): UserRow | null {
    for (const u of s.users.values()) {
      if (u.google_sub === sub) return u;
    }
    return null;
  }

  const db: Db = {
    async getUserBySub(sub) {
      return findBySub(sub);
    },
    async getUserById(id) {
      return s.users.get(id) ?? null;
    },

    async createUserWithSignupBonus({ id, google_sub, email, now, daily_resets_at, ledger_id }) {
      return locked(async () => {
        const existing = findBySub(google_sub);
        if (existing) return existing;
        const row: UserRow = {
          id,
          google_sub,
          email,
          created_at: now,
          free_credits_used: 0,
          paid_credits_balance: 0,
          daily_used: 0,
          daily_resets_at,
          last_generated_at: null,
        };
        s.users.set(id, row);
        s.ledger.push({
          id: ledger_id,
          user_id: id,
          delta: SIGNUP_BONUS_CREDITS,
          reason: 'signup_bonus',
          external_id: null,
          created_at: now,
        });
        return row;
      });
    },

    async decrementUserCredits({ user_id, now, daily_resets_at, ledger_id }): Promise<DecrementResult> {
      return locked(async () => {
        const u = s.users.get(user_id);
        if (!u) return { ok: false, reason: 'out_of_credits' };

        // Recompute "today" semantics.
        const isFreshDay = u.daily_resets_at <= now;
        const dailyUsedToday = isFreshDay ? 0 : u.daily_used;
        const atDailyCap = dailyUsedToday >= PER_USER_DAILY_CAP;

        const freeRemaining = SIGNUP_BONUS_CREDITS - u.free_credits_used;
        const hasCredits = freeRemaining > 0 || u.paid_credits_balance > 0;

        if (!hasCredits) return { ok: false, reason: 'out_of_credits' };
        if (atDailyCap) return { ok: false, reason: 'daily_cap' };

        const useFree = freeRemaining > 0;
        const next: UserRow = {
          ...u,
          free_credits_used: useFree ? u.free_credits_used + 1 : u.free_credits_used,
          paid_credits_balance: useFree ? u.paid_credits_balance : u.paid_credits_balance - 1,
          daily_used: dailyUsedToday + 1,
          daily_resets_at: isFreshDay ? daily_resets_at : u.daily_resets_at,
          last_generated_at: now,
        };
        s.users.set(user_id, next);
        s.ledger.push({
          id: ledger_id,
          user_id,
          delta: -1,
          reason: 'generate',
          external_id: null,
          created_at: now,
        });
        return {
          ok: true,
          free_credits_used: next.free_credits_used,
          paid_credits_balance: next.paid_credits_balance,
        };
      });
    },

    async decrementDeviceCredits({ device_id, now }): Promise<DecrementResult> {
      return locked(async () => {
        const cur = s.devices.get(device_id);
        if (!cur) {
          s.devices.set(device_id, { device_id, used: 1, created_at: now });
          return { ok: true };
        }
        if (cur.used >= ANON_FREE_CREDITS) {
          return { ok: false, reason: 'out_of_credits' };
        }
        s.devices.set(device_id, { ...cur, used: cur.used + 1 });
        return { ok: true };
      });
    },

    async upsertWaitlist(row) {
      if (s.waitlist.has(row.email)) return;
      s.waitlist.set(row.email, row);
    },
  };

  return { db, state: s };
}
