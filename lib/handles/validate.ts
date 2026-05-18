import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";
import { isReservedHandle } from "./reserved";

/**
 * Validate a candidate handle against the unified `/[handle]`
 * namespace. Three checks, in order of cost:
 *
 *   1. Reserved word — every static top-level route name (see
 *      `lib/handles/reserved.ts`).
 *   2. Existing username — would collide with another user's profile.
 *   3. Existing organization slug — would collide with an org's profile.
 *
 * Returns null on success or a short, user-facing message on failure.
 * The order is "cheapest to most expensive" so the reserved check
 * short-circuits before the DB hits.
 *
 * `ignoreUserId` / `ignoreOrgId` let a caller exclude its own row —
 * useful when a user edits their own username (don't flag the
 * existing row as a conflict).
 */
export async function validateHandle(
  candidate: string,
  opts: { ignoreUserId?: string; ignoreOrgId?: string } = {}
): Promise<string | null> {
  const handle = candidate.trim().toLowerCase();
  if (!handle) return "Handle is required.";
  if (isReservedHandle(handle)) {
    return "That handle is reserved. Please choose a different one.";
  }

  const [userHit] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, handle))
    .limit(1);
  if (userHit && userHit.id !== opts.ignoreUserId) {
    return "That handle is already taken.";
  }

  const [orgHit] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, handle))
    .limit(1);
  if (orgHit && orgHit.id !== opts.ignoreOrgId) {
    return "That handle is already taken.";
  }

  return null;
}

/**
 * Build a non-colliding handle from a desired stem. Tries the stem
 * itself; if that's reserved or taken, appends `-N` and walks up
 * until something sticks. Used by the Clerk webhook when an
 * incoming org slug collides — we can't reject the Clerk-side write
 * (Clerk owns the source of truth), but we can give the local
 * mirror a unique URL while logging a warning for the admin to
 * rename in Clerk.
 *
 * Caps the suffix search at 50 so a hostile slug can't drive an
 * unbounded query loop; if we hit the cap we fall through to a
 * timestamp-suffixed handle and accept the ugly URL.
 */
export async function buildUniqueHandle(
  stem: string,
  opts: { ignoreUserId?: string; ignoreOrgId?: string } = {}
): Promise<string> {
  const base = stem.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") || "team";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const conflict = await validateHandle(candidate, opts);
    if (!conflict) return candidate;
  }
  return `${base}-${Date.now()}`;
}
