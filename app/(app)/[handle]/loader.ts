import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";

/**
 * React.cache-wrapped user/org row loaders for the unified `/[handle]`
 * route.
 *
 * `generateMetadata` and the profile view body both need the row for
 * the same handle on the same request. Without caching, each call
 * issues an independent DB query — +1 redundant round-trip on the
 * site's highest-traffic page shape. `React.cache` deduplicates calls
 * within a single render pass (one RSC request), so the row is
 * fetched exactly once regardless of how many callers invoke these
 * functions. (mirrors `app/(app)/files/[slug]/loader.ts`)
 *
 * Column set is the superset of what both callers need:
 *   - user: generateMetadata needs username/displayName/bio/avatarUrl;
 *     the view body additionally needs id + socialLinks.
 *   - org: generateMetadata needs name/bio; the view body additionally
 *     needs id/slug/imageUrl.
 */
export const loadUserByHandle = cache(async function loadUserByHandle(
  handle: string
) {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
      socialLinks: users.socialLinks,
    })
    .from(users)
    .where(eq(users.username, handle));

  return row ?? null;
});

export const loadOrgByHandle = cache(async function loadOrgByHandle(
  handle: string
) {
  const [row] = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      bio: organizations.bio,
      imageUrl: organizations.imageUrl,
    })
    .from(organizations)
    .where(eq(organizations.slug, handle));

  return row ?? null;
});
