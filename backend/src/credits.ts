/**
 * Credits dispatcher for /generate. Sits between request handler and Gemini.
 *
 *   - Authenticated request (Bearer JWT): decrements user's free or paid credits,
 *     enforces per-user daily cap.
 *   - Anonymous request (device_id only): decrements the device's lifetime
 *     anonymous bucket (5 free).
 *
 * Returns ok=true with structured remaining-credits hints, or ok=false with a
 * stable reason code that the client can render meaningfully.
 */

import type { DecrementResult, Db } from './db';

export type Identity =
  | { kind: 'user'; userId: string }
  | { kind: 'device'; deviceId: string };

export interface CreditsCheckOptions {
  /** Wall-clock now in epoch ms. Injected for testability. */
  now: number;
  /** Next UTC midnight in epoch ms — used to reset per-user daily counter. */
  dailyResetsAt: number;
  /** UUID for the new ledger row, when one is written. Injected for testability. */
  ledgerId: string;
}

export async function decrementForGeneration(
  db: Db,
  identity: Identity,
  opts: CreditsCheckOptions,
): Promise<DecrementResult> {
  if (identity.kind === 'user') {
    return db.decrementUserCredits({
      user_id: identity.userId,
      now: opts.now,
      daily_resets_at: opts.dailyResetsAt,
      ledger_id: opts.ledgerId,
    });
  }
  return db.decrementDeviceCredits({
    device_id: identity.deviceId,
    now: opts.now,
  });
}

/**
 * Refund a previously-decremented credit. Called when generation fails AFTER
 * a successful decrement (Gemini timeout / safety / 5xx / no_image). Best-effort:
 * we never throw out of this function — a refund failure should not turn a
 * generation error into a hard backend error for the user.
 */
export async function refundForGeneration(
  db: Db,
  identity: Identity,
  opts: { now: number; ledgerId: string },
): Promise<void> {
  try {
    if (identity.kind === 'user') {
      await db.refundUserCredits({
        user_id: identity.userId,
        now: opts.now,
        ledger_id: opts.ledgerId,
      });
    } else {
      await db.refundDeviceCredits({ device_id: identity.deviceId });
    }
  } catch (e) {
    console.error('[tryon] refund failed', e instanceof Error ? e.message : e);
  }
}

/** UTC midnight after `now` — epoch ms. */
export function nextUtcMidnightMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}
