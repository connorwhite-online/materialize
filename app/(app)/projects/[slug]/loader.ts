import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, users } from "@/lib/db/schema";

/**
 * React.cache-wrapped project row loader.
 *
 * Both `generateMetadata` and the page body need the project row for
 * the same slug on the same request. `React.cache` deduplicates within
 * a single render pass so the DB is only hit once. (CON-141)
 *
 * Column set is the superset of what both callers need:
 *   - generateMetadata: name, description, thumbnailUrl, status,
 *     visibility, displayName, username
 *   - page body: all above + every other column on the projects row
 *     plus joined user columns
 */
export const loadProjectBySlug = cache(async function loadProjectBySlug(slug: string) {
  const [row] = await db
    .select({
      // Metadata fields
      name: projects.name,
      description: projects.description,
      thumbnailUrl: projects.thumbnailUrl,
      status: projects.status,
      visibility: projects.visibility,
      // Page body fields
      id: projects.id,
      buildGuide: projects.buildGuide,
      slug: projects.slug,
      price: projects.price,
      license: projects.license,
      tags: projects.tags,
      category: projects.category,
      designTags: projects.designTags,
      repoUrl: projects.repoUrl,
      coverPhotoId: projects.coverPhotoId,
      downloadCount: projects.downloadCount,
      createdAt: projects.createdAt,
      userId: projects.userId,
      organizationId: projects.organizationId,
      // Joined user columns
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      ownerOnboarded: users.stripeOnboardingComplete,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  return row ?? null;
});
