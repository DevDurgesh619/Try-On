/**
 * Db — high-level abstraction over the user / credits / waitlist tables.
 *
 * This is intentionally a small set of operations rather than raw SQL helpers.
 * Two reasons:
 *   1. Tests can substitute an in-memory implementation that mirrors the same
 *      semantics without spinning up SQLite.
 *   2. Atomicity contracts (e.g. credit decrement = single transaction) live
 *      INSIDE each method, so callers can't accidentally split them.
 *
 * Real implementation (createD1Db) is at the bottom; in-memory implementation
 * lives in db.test-helpers.ts.
 */

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  created_at: number;
  free_credits_used: number;
  paid_credits_balance: number;
  daily_used: number;
  daily_resets_at: number;
  last_generated_at: number | null;
}

export interface LedgerRow {
  id: string;
  user_id: string;
  delta: number;
  reason: 'signup_bonus' | 'generate' | 'purchase' | 'refund' | 'admin_grant';
  external_id: string | null;
  created_at: number;
}

export interface DeviceRow {
  device_id: string;
  used: number;
  created_at: number;
}

export interface WaitlistRow {
  email: string;
  device_id: string | null;
  user_id: string | null;
  created_at: number;
}

export interface DecrementResult {
  ok: boolean;
  reason?: 'out_of_credits' | 'daily_cap' | undefined;
  free_credits_used?: number | undefined;
  paid_credits_balance?: number | undefined;
}

/** Free credits given to anonymous devices. Hard-coded; see plan. */
export const ANON_FREE_CREDITS = 5;
/** Bonus credits granted on first Google sign-in. Hard-coded; see plan. */
export const SIGNUP_BONUS_CREDITS = 5;
/** Hard daily ceiling per authenticated user, even with positive balance. */
export const PER_USER_DAILY_CAP = 50;

export interface Db {
  /** Look up a user by their Google `sub` (subject) claim. */
  getUserBySub(sub: string): Promise<UserRow | null>;

  /** Look up a user by internal id. */
  getUserById(id: string): Promise<UserRow | null>;

  /**
   * First-time sign-in: create the user row AND grant the signup bonus in a
   * single atomic operation. If a row with the same google_sub already exists,
   * returns that existing row WITHOUT granting another bonus (idempotent).
   */
  createUserWithSignupBonus(input: {
    id: string;
    google_sub: string;
    email: string;
    now: number;
    daily_resets_at: number;
    ledger_id: string;
  }): Promise<UserRow>;

  /**
   * Atomic credit decrement for an authenticated user. Decrements free_credits_used
   * if any free remain, otherwise paid_credits_balance. Also enforces the per-user
   * daily cap. Writes a ledger row when successful.
   *
   * Returns ok=false with reason='out_of_credits' if neither free nor paid have
   * room, or reason='daily_cap' if the user has hit PER_USER_DAILY_CAP today.
   */
  decrementUserCredits(input: {
    user_id: string;
    now: number;
    daily_resets_at: number;
    ledger_id: string;
  }): Promise<DecrementResult>;

  /**
   * Atomic credit decrement for an anonymous device. Returns ok=false when the
   * device has already used its ANON_FREE_CREDITS. Creates the device row if
   * it didn't exist.
   */
  decrementDeviceCredits(input: {
    device_id: string;
    now: number;
  }): Promise<DecrementResult>;

  /** Idempotent on email; second insert is a no-op. */
  upsertWaitlist(row: WaitlistRow): Promise<void>;
}

// ---------- D1 implementation ----------

export function createD1Db(d1: D1Database): Db {
  return {
    async getUserBySub(sub) {
      const row = await d1
        .prepare('SELECT * FROM users WHERE google_sub = ?')
        .bind(sub)
        .first<UserRow>();
      return row ?? null;
    },

    async getUserById(id) {
      const row = await d1
        .prepare('SELECT * FROM users WHERE id = ?')
        .bind(id)
        .first<UserRow>();
      return row ?? null;
    },

    async createUserWithSignupBonus({ id, google_sub, email, now, daily_resets_at, ledger_id }) {
      // Idempotent: if user already exists, return them without a second bonus.
      const existing = await this.getUserBySub(google_sub);
      if (existing) return existing;

      // Two statements committed together. If the INSERT users races against
      // a concurrent first sign-in for the same sub, the second one fails on
      // the UNIQUE constraint and we re-read.
      try {
        await d1.batch([
          d1
            .prepare(
              `INSERT INTO users (id, google_sub, email, created_at, free_credits_used, paid_credits_balance, daily_used, daily_resets_at, last_generated_at)
               VALUES (?, ?, ?, ?, 0, 0, 0, ?, NULL)`,
            )
            .bind(id, google_sub, email, now, daily_resets_at),
          d1
            .prepare(
              `INSERT INTO ledger (id, user_id, delta, reason, external_id, created_at)
               VALUES (?, ?, ?, 'signup_bonus', NULL, ?)`,
            )
            .bind(ledger_id, id, SIGNUP_BONUS_CREDITS, now),
        ]);
      } catch {
        // Likely a UNIQUE clash on google_sub — another concurrent sign-in won.
        // Re-read and return whichever row exists.
        const winner = await this.getUserBySub(google_sub);
        if (winner) return winner;
        throw new Error('createUserWithSignupBonus: insert failed and no row found');
      }
      const created = await this.getUserBySub(google_sub);
      if (!created) throw new Error('createUserWithSignupBonus: row vanished after insert');
      return created;
    },

    async decrementUserCredits({ user_id, now, daily_resets_at, ledger_id }) {
      // Single conditional UPDATE — atomic in SQLite.
      //
      // Decrements free_credits_used FIRST (if room). If free is exhausted but
      // paid balance > 0, decrement paid. The CASE expressions encode the
      // choice. The WHERE clause guards against running out entirely or
      // hitting the daily cap.
      //
      // We model "remaining free credits" as (SIGNUP_BONUS_CREDITS - free_credits_used).
      const stmt = d1
        .prepare(
          `UPDATE users
           SET
             free_credits_used = free_credits_used + (CASE WHEN free_credits_used < ? THEN 1 ELSE 0 END),
             paid_credits_balance = paid_credits_balance - (CASE WHEN free_credits_used >= ? THEN 1 ELSE 0 END),
             daily_used = (CASE WHEN daily_resets_at <= ? THEN 1 ELSE daily_used + 1 END),
             daily_resets_at = (CASE WHEN daily_resets_at <= ? THEN ? ELSE daily_resets_at END),
             last_generated_at = ?
           WHERE id = ?
             AND (free_credits_used < ? OR paid_credits_balance > 0)
             AND (daily_resets_at <= ? OR daily_used < ?)`,
        )
        .bind(
          SIGNUP_BONUS_CREDITS,
          SIGNUP_BONUS_CREDITS,
          now,
          now,
          daily_resets_at,
          now,
          user_id,
          SIGNUP_BONUS_CREDITS,
          now,
          PER_USER_DAILY_CAP,
        );
      const res = await stmt.run();
      if (!res.meta.changes || res.meta.changes < 1) {
        // Disambiguate: was it out_of_credits or daily_cap?
        const after = await this.getUserById(user_id);
        if (!after) return { ok: false, reason: 'out_of_credits' };
        const free_remaining = SIGNUP_BONUS_CREDITS - after.free_credits_used;
        const has_credits = free_remaining > 0 || after.paid_credits_balance > 0;
        const at_daily_cap = after.daily_resets_at > now && after.daily_used >= PER_USER_DAILY_CAP;
        if (!has_credits) return { ok: false, reason: 'out_of_credits' };
        if (at_daily_cap) return { ok: false, reason: 'daily_cap' };
        return { ok: false, reason: 'out_of_credits' };
      }

      // Successful decrement — write the ledger row. Fire-and-await: we accept
      // a microsecond window where the credit moved but the ledger row hasn't
      // landed yet. Acceptable for beta.
      await d1
        .prepare(
          `INSERT INTO ledger (id, user_id, delta, reason, external_id, created_at)
           VALUES (?, ?, -1, 'generate', NULL, ?)`,
        )
        .bind(ledger_id, user_id, now)
        .run();

      const fresh = await this.getUserById(user_id);
      return {
        ok: true,
        free_credits_used: fresh?.free_credits_used,
        paid_credits_balance: fresh?.paid_credits_balance,
      };
    },

    async decrementDeviceCredits({ device_id, now }) {
      // INSERT-or-UPDATE pattern. Single round-trip via UPSERT.
      const stmt = d1
        .prepare(
          `INSERT INTO device_free_credits (device_id, used, created_at)
           VALUES (?, 1, ?)
           ON CONFLICT(device_id) DO UPDATE SET used = used + 1
             WHERE used < ?`,
        )
        .bind(device_id, now, ANON_FREE_CREDITS);
      const res = await stmt.run();
      if (!res.meta.changes || res.meta.changes < 1) {
        return { ok: false, reason: 'out_of_credits' };
      }
      return { ok: true };
    },

    async upsertWaitlist(row) {
      await d1
        .prepare(
          `INSERT INTO waitlist (email, device_id, user_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email) DO NOTHING`,
        )
        .bind(row.email, row.device_id, row.user_id, row.created_at)
        .run();
    },
  };
}
