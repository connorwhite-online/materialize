import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for shared secrets (e.g. `CRON_SECRET`
 * bearer tokens). A plain `!==` comparison short-circuits on the first
 * differing byte, which leaks a timing side-channel an attacker can use to
 * recover the secret one byte at a time. `node:crypto`'s `timingSafeEqual`
 * only accepts equal-length buffers (it throws otherwise), so we check
 * lengths first and bail out — a length mismatch can never be a valid
 * secret match anyway, and the secret's length isn't itself sensitive (the
 * operator picks it and stores it in env), so a short-circuit here doesn't
 * leak anything worth protecting. Same rationale as the hand-rolled
 * constant-time compare in `app/api/internal/sentry-trigger/route.ts`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
