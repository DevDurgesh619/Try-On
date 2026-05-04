/**
 * Waitlist — captures emails for the "paid plans coming soon" funnel.
 * Idempotent on email.
 */

import type { Db } from './db';

export interface WaitlistInput {
  email: string;
  device_id?: string | null;
  user_id?: string | null;
  now: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (s.length > 254) return false;
  return EMAIL_RE.test(s);
}

export async function addToWaitlist(db: Db, input: WaitlistInput): Promise<void> {
  if (!isValidEmail(input.email)) {
    throw new Error('invalid_email');
  }
  await db.upsertWaitlist({
    email: input.email.toLowerCase().trim(),
    device_id: input.device_id ?? null,
    user_id: input.user_id ?? null,
    created_at: input.now,
  });
}
