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

/** UTC midnight after `now` — epoch ms. */
export function nextUtcMidnightMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}
