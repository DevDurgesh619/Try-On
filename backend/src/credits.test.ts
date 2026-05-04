import { describe, it, expect } from 'vitest';
import { createMemoryDb } from './db.test-helpers';
import { decrementForGeneration, nextUtcMidnightMs } from './credits';
import { ANON_FREE_CREDITS, PER_USER_DAILY_CAP, SIGNUP_BONUS_CREDITS } from './db';

const NOW_MS = Date.UTC(2026, 4, 15, 12, 0, 0);
const TOMORROW_MS = nextUtcMidnightMs(new Date(NOW_MS));

describe('decrementForGeneration — anonymous device', () => {
  it('lets the device burn ANON_FREE_CREDITS, then returns out_of_credits', async () => {
    const { db } = createMemoryDb();
    for (let i = 0; i < ANON_FREE_CREDITS; i++) {
      const r = await decrementForGeneration(db, { kind: 'device', deviceId: 'd1' }, {
        now: NOW_MS,
        dailyResetsAt: TOMORROW_MS,
        ledgerId: `ldg-${i}`,
      });
      expect(r.ok).toBe(true);
    }
    const overflow = await decrementForGeneration(db, { kind: 'device', deviceId: 'd1' }, {
      now: NOW_MS,
      dailyResetsAt: TOMORROW_MS,
      ledgerId: 'ldg-overflow',
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe('out_of_credits');
  });

  it('different devices have independent budgets', async () => {
    const { db } = createMemoryDb();
    for (let i = 0; i < ANON_FREE_CREDITS; i++) {
      await decrementForGeneration(db, { kind: 'device', deviceId: 'd1' }, {
        now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: `a-${i}`,
      });
    }
    // d2 still has all 5.
    const r = await decrementForGeneration(db, { kind: 'device', deviceId: 'd2' }, {
      now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: 'b-0',
    });
    expect(r.ok).toBe(true);
  });
});

describe('decrementForGeneration — authenticated user', () => {
  async function freshUser() {
    const { db, state } = createMemoryDb();
    await db.createUserWithSignupBonus({
      id: 'u1',
      google_sub: 'sub-1',
      email: 'a@b.com',
      now: NOW_MS,
      daily_resets_at: TOMORROW_MS,
      ledger_id: 'ldg-bonus',
    });
    return { db, state };
  }

  it('uses the SIGNUP_BONUS free credits before paid', async () => {
    const { db, state } = await freshUser();
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.paid_credits_balance = 10; }
    for (let i = 0; i < SIGNUP_BONUS_CREDITS; i++) {
      const r = await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
        now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: `g-${i}`,
      });
      expect(r.ok).toBe(true);
    }
    const u = state.users.get('u1');
    expect(u?.free_credits_used).toBe(SIGNUP_BONUS_CREDITS);
    expect(u?.paid_credits_balance).toBe(10); // untouched
  });

  it('falls through to paid_credits_balance once free is exhausted', async () => {
    const { db, state } = await freshUser();
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.free_credits_used = SIGNUP_BONUS_CREDITS; } // pretend used
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.paid_credits_balance = 3; }
    for (let i = 0; i < 3; i++) {
      const r = await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
        now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: `g-${i}`,
      });
      expect(r.ok).toBe(true);
    }
    expect(state.users.get('u1')?.paid_credits_balance).toBe(0);
    const overflow = await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
      now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: 'g-x',
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe('out_of_credits');
  });

  it('enforces PER_USER_DAILY_CAP even with positive balance', async () => {
    const { db, state } = await freshUser();
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.paid_credits_balance = 1000; }
    for (let i = 0; i < PER_USER_DAILY_CAP; i++) {
      const r = await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
        now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: `g-${i}`,
      });
      expect(r.ok).toBe(true);
    }
    const overflow = await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
      now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: 'g-cap',
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe('daily_cap');
  });

  it('daily counter resets after UTC midnight', async () => {
    const { db, state } = await freshUser();
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.paid_credits_balance = 100; }
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.daily_used = PER_USER_DAILY_CAP; }
    { const _u = state.users.get("u1"); if (!_u) throw new Error("u1 missing"); _u.daily_resets_at = NOW_MS - 1; } // yesterday's window expired
    const r = await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
      now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: 'g-fresh',
    });
    expect(r.ok).toBe(true);
    expect(state.users.get('u1')?.daily_used).toBe(1);
    expect(state.users.get('u1')?.daily_resets_at).toBe(TOMORROW_MS);
  });

  it('writes a ledger row for every successful generate', async () => {
    const { db, state } = await freshUser();
    await decrementForGeneration(db, { kind: 'user', userId: 'u1' }, {
      now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: 'g-xx',
    });
    const row = state.ledger.find((r) => r.id === 'g-xx');
    expect(row).toBeDefined();
    expect(row?.delta).toBe(-1);
    expect(row?.reason).toBe('generate');
  });
});

describe('decrementForGeneration — concurrency (10 parallel with 1 credit left)', () => {
  it('exactly 1 succeeds, 9 fail', async () => {
    const { db } = createMemoryDb();
    await db.createUserWithSignupBonus({
      id: 'uc',
      google_sub: 'sub-c',
      email: 'c@b.com',
      now: NOW_MS,
      daily_resets_at: TOMORROW_MS,
      ledger_id: 'ldg-cb',
    });
    // Burn 4 of the 5 free credits sequentially so 1 remains.
    for (let i = 0; i < SIGNUP_BONUS_CREDITS - 1; i++) {
      await decrementForGeneration(db, { kind: 'user', userId: 'uc' }, {
        now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: `pre-${i}`,
      });
    }
    // Fire 10 in parallel.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        decrementForGeneration(db, { kind: 'user', userId: 'uc' }, {
          now: NOW_MS, dailyResetsAt: TOMORROW_MS, ledgerId: `par-${i}`,
        }),
      ),
    );
    const okCount = results.filter((r) => r.ok).length;
    const outCount = results.filter((r) => !r.ok && r.reason === 'out_of_credits').length;
    expect(okCount).toBe(1);
    expect(outCount).toBe(9);
  });
});

describe('createUserWithSignupBonus', () => {
  it('is idempotent on google_sub: second call returns same user, no double bonus', async () => {
    const { db, state } = createMemoryDb();
    const first = await db.createUserWithSignupBonus({
      id: 'u-a',
      google_sub: 'sub-1',
      email: 'a@b.com',
      now: NOW_MS,
      daily_resets_at: TOMORROW_MS,
      ledger_id: 'ldg-a',
    });
    const second = await db.createUserWithSignupBonus({
      id: 'u-b', // different id arg
      google_sub: 'sub-1', // same sub
      email: 'a@b.com',
      now: NOW_MS + 1000,
      daily_resets_at: TOMORROW_MS,
      ledger_id: 'ldg-b',
    });
    expect(second.id).toBe(first.id);
    const bonusRows = state.ledger.filter((r) => r.reason === 'signup_bonus');
    expect(bonusRows).toHaveLength(1);
  });
});
