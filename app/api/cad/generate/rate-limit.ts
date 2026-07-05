import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";

/**
 * Per-user sliding-window throttle for POST /api/cad/generate (MTR-169).
 *
 * A single generate request can chain a plan-step model call, a concept
 * image, up to ~4 generate/repair model calls, an aesthetic-judge call, and
 * (routed generative) a $0.16–$2 fal.ai mesh — all uncapped per request and,
 * before this, with no frequency cap either. The client's single-flight
 * `abortRef` is not a server-side backstop: a retry loop, a stale tab, or a
 * compromised owner session can fire many in parallel.
 *
 * We count the caller's `cad_generations` rows in the trailing window and
 * reject once they exceed the cap. This is deliberately PERSISTENT (a DB
 * count, not an in-memory counter): the route runs on serverless instances
 * that don't share memory and cold-start freely, so an in-memory limiter
 * would reset constantly and under-count. The count rides the existing
 * `cad_generations_user_created_idx` (user_id, created_at) composite — no
 * migration, no new table.
 *
 * The window is tuned GENEROUSLY so it never fires on legitimate iterative
 * use (rapid revise/repair turns are normal). It is an abuse/runaway
 * backstop, not a product limit. Both knobs are env-overridable.
 *
 * NOTE: this is a frequency backstop, not a per-request cost cap. A true
 * spend ceiling (aborting mid-request when the fal.ai/model spend crosses a
 * threshold) lives inside the harness, which this PR does not own — see
 * MTR-169 for the follow-up.
 */

/** Max generate requests per user per window before a 429. */
const DEFAULT_MAX_PER_WINDOW = 40;
/** Trailing window length, in minutes. */
const DEFAULT_WINDOW_MINUTES = 10;

export interface CadRateLimitConfig {
  /** Max generations allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Resolve the cap + window from env, falling back to generous defaults.
 * Invalid/non-positive values fall back rather than disable the cap, so a
 * typo can't silently remove the backstop. Pure — safe to unit-test.
 */
export function resolveCadRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env
): CadRateLimitConfig {
  const limit = positiveIntOr(
    env.CAD_GENERATE_MAX_PER_WINDOW,
    DEFAULT_MAX_PER_WINDOW
  );
  const windowMinutes = positiveIntOr(
    env.CAD_GENERATE_WINDOW_MINUTES,
    DEFAULT_WINDOW_MINUTES
  );
  return { limit, windowMs: windowMinutes * 60_000 };
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export type CadRateLimitResult =
  | { ok: true }
  | {
      ok: false;
      /** How many the user has in-window (>= limit). */
      count: number;
      limit: number;
      windowMinutes: number;
      /** Seconds until the oldest in-window request ages out (>= 1). */
      retryAfterSeconds: number;
    };

/**
 * Decide whether `userId` may start another generation right now. Counts the
 * user's rows created within the window and, when at/over the cap, computes a
 * precise `retryAfterSeconds` from the oldest in-window row so the client can
 * back off exactly as long as needed.
 *
 * Fails OPEN: any DB error returns `{ ok: true }`. This is a guardrail on an
 * owner-only surface, not an auth boundary — a transient count failure must
 * never block a legitimate build (the auth + feature gate already ran).
 */
export async function checkCadGenerateRateLimit(
  userId: string,
  now: number = Date.now(),
  config: CadRateLimitConfig = resolveCadRateLimitConfig()
): Promise<CadRateLimitResult> {
  const { limit, windowMs } = config;
  const since = new Date(now - windowMs);

  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${cadGenerations.createdAt})`,
      })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.userId, userId),
          gte(cadGenerations.createdAt, since)
        )
      );

    const count = row?.count ?? 0;
    if (count < limit) return { ok: true };

    // Oldest in-window row exits the window at oldest + windowMs; that's when
    // a slot frees up. Fall back to the full window if we can't read it.
    const oldestMs = row?.oldest ? new Date(row.oldest).getTime() : now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestMs + windowMs - now) / 1000)
    );

    return {
      ok: false,
      count,
      limit,
      windowMinutes: Math.round(windowMs / 60_000),
      retryAfterSeconds,
    };
  } catch {
    // Fail open — never let a counting hiccup block a real generation.
    return { ok: true };
  }
}
