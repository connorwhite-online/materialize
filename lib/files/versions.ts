import "server-only";

import { and, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";

/**
 * The one writer for file versions (docs/file-versioning.md).
 *
 * Attaches an existing asset row to `fileId` as that file's next version
 * and, by default, makes it the live one. Used by studio re-save today and
 * by "upload new version" next. The asset's geometry is never touched —
 * versions are immutable, so moving the pointer is the whole update, and
 * print orders keep referencing exactly the geometry they ordered.
 *
 * If the asset was attached to another file (a studio generation's
 * invisible draft file), that file's pointer is cleared when it named this
 * asset, so no file ever points at an asset that isn't its own.
 *
 * No transaction on neon-http, so statement order is the crash story:
 * attach first, then move the pointer. A crash between the two leaves the
 * new version in the history but not live — readers keep resolving the
 * previous version, and retrying completes the update.
 */
export async function attachAssetAsVersion(params: {
  fileId: string;
  assetId: string;
  note?: string | null;
  makeCurrent?: boolean;
}): Promise<{ versionNumber: number }> {
  const { fileId, assetId, note = null, makeCurrent = true } = params;

  const [asset] = await db
    .select({
      fileId: fileAssets.fileId,
      versionNumber: fileAssets.versionNumber,
    })
    .from(fileAssets)
    .where(eq(fileAssets.id, assetId))
    .limit(1);
  if (!asset) throw new Error(`attachAssetAsVersion: asset ${assetId} not found`);

  let versionNumber: number;
  if (asset.fileId === fileId && asset.versionNumber != null) {
    // Already a version of this file (a retry after a crash, or a re-save
    // of the version that's already there): keep its number.
    versionNumber = asset.versionNumber;
  } else {
    const [row] = await db
      .select({ top: max(fileAssets.versionNumber) })
      .from(fileAssets)
      .where(eq(fileAssets.fileId, fileId));
    versionNumber = (row?.top ?? 0) + 1;
    await db
      .update(fileAssets)
      .set({ fileId, versionNumber, versionNote: note })
      .where(eq(fileAssets.id, assetId));

    if (asset.fileId && asset.fileId !== fileId) {
      await db
        .update(files)
        .set({ currentAssetId: null })
        .where(
          and(eq(files.id, asset.fileId), eq(files.currentAssetId, assetId))
        );
    }
  }

  if (makeCurrent) {
    await db
      .update(files)
      .set({ currentAssetId: assetId, updatedAt: new Date() })
      .where(eq(files.id, fileId));
  }

  return { versionNumber };
}
