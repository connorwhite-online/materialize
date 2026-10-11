import "server-only";

import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time comparison of the emailed confirm/cancel capability token
 * on agent-initiated orders. Shared by the server actions in
 * app/actions/agent-orders.ts and the /orders/[id]/confirm + /cancel pages
 * (which can't import it from a "use server" file — every export there
 * must be an async action).
 *
 * Hashing first equalizes length (timingSafeEqual throws on length
 * mismatch) and a null/absent stored token never matches.
 */
export function confirmationTokenMatches(
  stored: string | null | undefined,
  provided: string | null | undefined
): boolean {
  if (!stored || !provided) return false;
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}
