import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import {
  savedPreviewView,
  type PreviewView,
} from "@/components/viewer/preview-camera";

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

/**
 * The owner-chosen preview camera, loaded separately and never allowed
 * to take the page down with it.
 *
 * These four columns arrived in migration 0063, and they drive a
 * purely cosmetic enhancement: which angle the 3D viewer opens on. The
 * page's own content does not depend on them at all. Folding them into
 * `loadFileBySlug` welded that enhancement to the primary query, so a
 * database that hadn't yet taken the migration failed the whole file
 * detail page — and `generateMetadata` with it — rather than just
 * declining to rotate a camera.
 *
 * Production can't normally get into that state (the build runs
 * `db:migrate` before `next build`, so code cannot land ahead of its
 * schema), but preview branch databases and rollbacks can, and the
 * blast radius was the single most important page in the product. An
 * optional column belongs behind an optional query.
 *
 * Errors are logged, not swallowed silently: a persistent failure here
 * means the migration really is missing somewhere and should be
 * visible in Sentry rather than showing up as thumbnails that never
 * quite open at the right angle.
 */
export const loadPreviewView = cache(async function loadPreviewView(
  fileId: string
): Promise<PreviewView | null> {
  try {
    const [row] = await db
      .select({
        previewDirX: files.previewDirX,
        previewDirY: files.previewDirY,
        previewDirZ: files.previewDirZ,
        previewFraming: files.previewFraming,
      })
      .from(files)
      .where(eq(files.id, fileId));
    return row ? savedPreviewView(row) : null;
  } catch (error) {
    logError("files/[slug]/loader:loadPreviewView", error);
    return null;
  }
});
