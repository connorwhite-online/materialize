import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";

/**
 * Look up what kind of account a handle refers to in the unified
 * `/[handle]` namespace. Returns the row's id + the discriminator so
 * the catch-all page can branch to user vs org rendering with no
 * second roundtrip.
 *
 * Reserved words are blocked at write time (see
 * `lib/handles/validate.ts`), and the static routes for those words
 * win Next's routing precedence over the dynamic `[handle]`
 * segment — so we never need to filter them out here. A nonexistent
 * handle resolves to `null`, which the page renders as 404.
 *
 * Two queries instead of a union: the users + organizations indexes
 * are both on a single text column, so each lookup is one index hit.
 * Running them in parallel keeps the worst case at one round-trip.
 */
export type HandleResolution =
  | { kind: "user"; userId: string }
  | { kind: "org"; orgId: string };

export async function resolveHandle(
  rawHandle: string
): Promise<HandleResolution | null> {
  const handle = rawHandle.trim().toLowerCase();
  if (!handle) return null;

  const [userRow, orgRow] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, handle))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, handle))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  // If both somehow exist (shouldn't, given the validator), prefer
  // user — they almost certainly came first historically and the org
  // slug is the more recent assignment. The webhook would normally
  // suffix the org's local slug to dodge this case before it ships.
  if (userRow) return { kind: "user", userId: userRow.id };
  if (orgRow) return { kind: "org", orgId: orgRow.id };
  return null;
}
