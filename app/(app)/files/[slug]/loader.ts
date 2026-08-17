import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";

/**
 * React.cache-wrapped file row loader.
 *
 * Both `generateMetadata` and the page body need the file row for the
 * same slug on the same request. Without caching, each call issues an
 * independent DB query — +1 redundant round-trip on the hottest content
 * route. `React.cache` deduplicates calls within a single render pass
 * (one RSC request), so the row is fetched exactly once regardless of
 * how many callers invoke this function. (CON-141)
 *
 * Column set is the superset of what both callers need:
 *   - generateMetadata: name, description, thumbnailUrl, status,
 *     displayName, username
 *   - page body: all of the above + every other column on the files
 *     row plus the joined user columns
 */
export const loadFileBySlug = cache(async function loadFileBySlug(slug: string) {
  const [row] = await db
    .select({
      // Metadata fields
      name: files.name,
      description: files.description,
      thumbnailUrl: files.thumbnailUrl,
      status: files.status,
      // Page body fields
      id: files.id,
      slug: files.slug,
      price: files.price,
      license: files.license,
      tags: files.tags,
      category: files.category,
      designTags: files.designTags,
      recommendedMaterialId: files.recommendedMaterialId,
      recommendedCcMaterialId: files.recommendedCcMaterialId,
      recommendedCcFinishGroupId: files.recommendedCcFinishGroupId,
      minWallThickness: files.minWallThickness,
      visibility: files.visibility,
      coverPhotoId: files.coverPhotoId,
      // Owner-chosen preview camera — the viewer opens on it.
      previewDirX: files.previewDirX,
      previewDirY: files.previewDirY,
      previewDirZ: files.previewDirZ,
      previewFraming: files.previewFraming,
      downloadCount: files.downloadCount,
      viewCount: files.viewCount,
      createdAt: files.createdAt,
      flaggedReason: files.flaggedReason,
      flaggedAt: files.flaggedAt,
      userId: files.userId,
      organizationId: files.organizationId,
      // Joined user columns
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      ownerOnboarded: users.stripeOnboardingComplete,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(files.slug, slug));

  return row ?? null;
});
