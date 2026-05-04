import type { ErrorResponse } from '@/lib/types';

type Code = ErrorResponse['code'];

const HUMAN: Partial<Record<Code, string>> = {
  gemini_safety_block: 'This image triggered the safety filter. Try a different photo.',
  gemini_timeout: 'The model is taking longer than usual. Please try again.',
  backend_error: 'Something went wrong on our end. Try again in a moment.',
  auth_required: 'Please sign in to continue.',
  auth_expired: 'Your session expired. Sign in again.',
  rate_limited: 'Too many requests. Wait a few seconds and retry.',
  invalid_email: 'Please enter a valid email.',
  auth_failed: 'Sign-in failed. Please try again.',
};

export function humanizeError(code: Code | undefined, fallback?: string): string {
  if (code && HUMAN[code]) return HUMAN[code] as string;
  if (fallback) return fallback;
  return 'Something went wrong. Please try again.';
}
