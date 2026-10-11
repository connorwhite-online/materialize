import "server-only";

import { sql } from "drizzle-orm";
import { isIP } from "node:net";

import { db } from "@/lib/db";
import { rateLimitCounters } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { clientIpFrom, hashIp } from "@/lib/uploads/anon-grants";

/**
 * Per-caller rate limits for public endpoints whose real cost lands
 * upstream: every quote start, poll, model upload and cart probe is a
 * CraftCloud call, and anon visitors can reach all of them. Without a
 * cap, one script can burn our CraftCloud standing (or get the origin
 * blocked) for every real buyer.
 *
 * Fixed-window counters in Postgres (`rate_limit_counters`), one
 * atomic upsert per request. Fixed windows allow a 2× burst across a
 * boundary; that is fine for an abuse cap and costs one round trip
 * instead of a sliding-window scan.
 *
 * Fails OPEN, unlike the anon-upload grant limiter: these caps sit in
 * front of a customer's checkout, and a database hiccup must not turn
 * into "Too many requests" for someone mid-purchase. The anon-upload
 * path, which hands out bucket writes, keeps its own fail-closed gate.
 *
 * Limits are deliberately generous — far above what the UI produces —
 * because mobile carriers put many people behind one IPv4 address.
 * Signed-in callers are keyed by user id, so NAT sharing never
 * throttles them for someone else's traffic.
 */

export interface RateLimitPolicy {
  /** Short stable name; part of the counter key. */
  name: string;
  /** Requests allowed per window, per caller. */
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

/**
 * Every limited surface, in one place so tuning is a one-file diff.
 * Each number is several times what a real session generates.
 */
export const RATE_LIMITS = {
  /** POST /api/craftcloud/quotes — a new quote per material/qty/country change (debounced). */
  quoteStart: { name: "quote-start", limit: 60, windowMs: 10 * MINUTE },
  /**
   * GET /api/craftcloud/quotes/poll — 1.5s interval, ≤90s per quote, so
   * one quote is ≤60 polls. The client treats 3 consecutive 4xx as a
   * stale priceId, so this has to stay well clear of legitimate use.
   */
  quotePoll: { name: "quote-poll", limit: 1200, windowMs: 10 * MINUTE },
  /** POST /api/craftcloud/upload-model — the expensive one (R2 read + CraftCloud upload). */
  modelUpload: { name: "model-upload", limit: 30, windowMs: 60 * MINUTE },
  /** checkCartPricing / checkVendorMinimums — each creates a disposable CraftCloud cart. */
  cartProbe: { name: "cart-probe", limit: 120, windowMs: 10 * MINUTE },
  /** GET /api/search — typeahead fires per keystroke. */
  search: { name: "search", limit: 240, windowMs: MINUTE },
} satisfies Record<string, RateLimitPolicy>;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * The address a limit is keyed on. IPv6 collapses to its /64: a single
 * host is routinely handed a whole /64 and can rotate through it for
 * free, so keying on the full address would be no limit at all. Pure.
 */
export function rateLimitAddress(ip: string): string {
  // Strip an IPv4-mapped prefix and any zone id.
  const bare = ip.replace(/%.*$/, "").replace(/^::ffff:(?=\d+\.)/i, "");
  if (isIP(bare) !== 6) return bare;
  return `${expandIpv6(bare).slice(0, 4).join(":")}::/64`;
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts =
    tail === undefined
      ? headParts
      : [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts];
  return parts.map((p) => (p || "0").toLowerCase().replace(/^0+(?=.)/, ""));
}

/**
 * The caller key: the user id when signed in, else a salted hash of the
 * (/64-collapsed) client address. Null when neither is available — no
 * proxy header at all, which only happens off-platform (local dev).
 */
export function rateLimitCallerKey(
  headers: Headers,
  userId: string | null | undefined
): string | null {
  if (userId) return `u:${userId}`;
  const ip = clientIpFrom(headers);
  return ip ? `ip:${hashIp(rateLimitAddress(ip))}` : null;
}

/** Window boundary for `now`. Pure. */
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Count one request against `policy` for `callerKey` and say whether it
 * is allowed. A null key (no attributable caller) is allowed: these
 * limits throttle abuse, they do not gate access, and failing closed
 * here would break local dev for no protection in production, where
 * Vercel always sets x-forwarded-for.
 */
export async function consumeRateLimit(
  policy: RateLimitPolicy,
  callerKey: string | null,
  now: number = Date.now()
): Promise<RateLimitResult> {
  if (!callerKey) return { ok: true };
  const windowStart = windowStartFor(now, policy.windowMs);

  try {
    const [row] = await db
      .insert(rateLimitCounters)
      .values({
        bucket: `${policy.name}:${callerKey}`,
        windowStart: new Date(windowStart),
        count: 1,
      })
      .onConflictDoUpdate({
        target: [rateLimitCounters.bucket, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + 1` },
      })
      .returning({ count: rateLimitCounters.count });

    if ((row?.count ?? 0) <= policy.limit) return { ok: true };
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowStart + policy.windowMs - now) / 1000)
      ),
    };
  } catch (error) {
    // Fail open — see the file header.
    logError(`rate-limit.${policy.name}`, error);
    return { ok: true };
  }
}

export const RATE_LIMITED_MESSAGE =
  "Too many requests. Please wait a moment and try again.";

/** Standard 429 for route handlers. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: RATE_LIMITED_MESSAGE },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/** Rows older than this are past every window above. */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * MINUTE;
