import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { anonUploadGrants } from "@/lib/db/schema";

/**
 * Issuing + redeeming presigned R2 uploads for UNAUTHENTICATED
 * visitors on the anon print flow.
 *
 * Handing an anonymous caller a write into our bucket is a real
 * abuse surface, so it is fenced on three sides:
 *
 *   - a per-IP sliding-window cap (this file),
 *   - a dedicated `anon-uploads/` key prefix nobody else writes to,
 *   - single-use redemption: the upload route will only read a key
 *     that was granted here and not yet consumed.
 *
 * Contrast with the CAD generate throttle, which fails OPEN on a DB
 * error because it guards an owner-only surface that auth already
 * gated. This one fails CLOSED — it IS the gate, and a limiter that
 * evaporates whenever the database hiccups is not a limiter.
 */

/** Prefix every anon-granted key lives under. Nothing else writes here. */
export const ANON_UPLOAD_PREFIX = "anon-uploads/";

/** Max grants per IP per window before a 429. */
const DEFAULT_MAX_PER_WINDOW = 20;
/** Trailing window length, in minutes. */
const DEFAULT_WINDOW_MINUTES = 60;
/** How long a grant stays redeemable. */
export const GRANT_TTL_MS = 60 * 60 * 1000;

export interface AnonUploadLimitConfig {
  limit: number;
  windowMs: number;
}

/**
 * Cap + window from env, falling back to defaults. Invalid or
 * non-positive values fall back rather than disabling the cap, so a
 * typo can't silently remove the gate. Pure — safe to unit-test.
 */
export function resolveAnonUploadLimitConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env
): AnonUploadLimitConfig {
  const limit = positiveIntOr(
    env.ANON_UPLOAD_MAX_PER_WINDOW,
    DEFAULT_MAX_PER_WINDOW
  );
  const windowMinutes = positiveIntOr(
    env.ANON_UPLOAD_WINDOW_MINUTES,
    DEFAULT_WINDOW_MINUTES
  );
  return { limit, windowMs: windowMinutes * 60_000 };
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Salted SHA-256 of the caller's IP. We need to correlate requests
 * from one address over an hour; we do not need to know the address,
 * and storing visitor IPs in plaintext to achieve rate limiting would
 * be a poor trade.
 *
 * The salt makes the digest useless outside our system (an unsalted
 * IP hash is trivially reversible — the whole v4 space brute-forces in
 * seconds). It falls back to a constant when unset so the limiter
 * still functions in dev; production should set ANON_UPLOAD_IP_SALT.
 */
export function hashIp(
  ip: string,
  env: Partial<NodeJS.ProcessEnv> = process.env
): string {
  const salt = env.ANON_UPLOAD_IP_SALT || "materialize-anon-upload";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Best-effort client IP from proxy headers. Vercel sets
 * `x-forwarded-for`; the left-most entry is the original client.
 *
 * Returns null when no address can be determined, and callers treat
 * that as a refusal — an unauthenticated write we cannot attribute to
 * anything is exactly what the cap exists to prevent, so an attacker
 * must not be able to opt out of it by stripping a header.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

export type AnonUploadLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Whether this IP may be granted another upload right now.
 *
 * Fails CLOSED: a DB error refuses the grant. See the file header.
 */
export async function checkAnonUploadLimit(
  ipHash: string,
  now: number = Date.now(),
  config: AnonUploadLimitConfig = resolveAnonUploadLimitConfig()
): Promise<AnonUploadLimitResult> {
  const { limit, windowMs } = config;
  const since = new Date(now - windowMs);

  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${anonUploadGrants.createdAt})`,
      })
      .from(anonUploadGrants)
      .where(
        and(
          eq(anonUploadGrants.ipHash, ipHash),
          gte(anonUploadGrants.createdAt, since)
        )
      );

    const count = row?.count ?? 0;
    if (count < limit) return { ok: true };

    const oldestMs = row?.oldest ? new Date(row.oldest).getTime() : now;
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldestMs + windowMs - now) / 1000)
      ),
    };
  } catch {
    // Fail closed — this limiter is the gate, not a guardrail behind one.
    return { ok: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
}

/**
 * Redeem a granted key. Returns the grant when the key was issued by
 * us, is unconsumed, and hasn't aged out — and marks it consumed in
 * the same statement so two concurrent calls can't both win.
 *
 * Returns null in every other case, which callers must treat as
 * "not authorized to read this key" rather than "not found".
 */
export async function consumeAnonUploadGrant(
  storageKey: string,
  now: number = Date.now()
): Promise<{ originalFilename: string } | null> {
  const notExpiredBefore = new Date(now - GRANT_TTL_MS);

  const [row] = await db
    .update(anonUploadGrants)
    .set({ consumedAt: new Date(now) })
    .where(
      and(
        eq(anonUploadGrants.storageKey, storageKey),
        isNull(anonUploadGrants.consumedAt),
        gte(anonUploadGrants.createdAt, notExpiredBefore)
      )
    )
    .returning({ originalFilename: anonUploadGrants.originalFilename });

  return row ?? null;
}
