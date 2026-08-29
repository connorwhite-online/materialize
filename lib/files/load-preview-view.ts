import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import {
  savedPreviewView,
  type PreviewView,
} from "@/components/viewer/preview-camera";

/**
 * The owner-chosen preview camera, loaded separately and never allowed
 * to take a page down with it.
 *
 * These four columns arrived in migration 0063, and they drive a
 * purely cosmetic enhancement: which angle a 3D viewer opens on. The
 * page's own content does not depend on them at all. Folding them into
 * a primary row query welds that enhancement to the page, so a
 * database that hasn't yet taken the migration fails the whole route
 * rather than just declining to rotate a camera.
 *
 * Production can't normally get into that state (the build runs
 * `db:migrate` before `next build`, so code cannot land ahead of its
 * schema), but preview branch databases and rollbacks can. An
 * optional column belongs behind an optional query.
 *
 * Errors are logged, not swallowed silently: a persistent failure here
 * means the migration really is missing somewhere and should be
 * visible in Sentry rather than showing up as models that never quite
 * open at the right angle.
 *
 * Every 3D viewer of a listed file must go through this (or
 * `savedPreviewView` on a row already in hand). Call sites today:
 * file detail, `/print/[fileAssetId]`, and the order-detail preview.
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
    logError("loadPreviewView", error);
    return null;
  }
});
