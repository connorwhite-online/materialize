import { eq, isNull, or, type SQL } from "drizzle-orm";
import { fileAssets, files } from "@/lib/db/schema";

/**
 * Which of a file's versions is live (docs/file-versioning.md).
 *
 * Every `file_assets` row attached to a file is one immutable version of
 * it, and `files.currentAssetId` names the live one. That version is the
 * only one the public sees, so every "the file's asset" reader resolves it
 * through here rather than taking the first asset row — which is what
 * they all did before versions existed, and why a file could only ever
 * safely hold one asset.
 *
 * Pure (no db client), so client bundles and unit tests can import it.
 */

export interface VersionedAssetLike {
  id: string;
  createdAt?: Date | string | null;
  versionNumber?: number | null;
}

function createdMs(a: VersionedAssetLike): number {
  if (!a.createdAt) return 0;
  return new Date(a.createdAt).getTime();
}

/**
 * The oldest asset — the pre-versioning pick, and the fallback when a
 * file has no pointer (no assets yet, or its current asset was deleted
 * and the FK nulled it). Ties break on id so the pick is deterministic.
 */
function oldestAsset<T extends VersionedAssetLike>(assets: T[]): T | null {
  let best: T | null = null;
  for (const a of assets) {
    if (
      !best ||
      createdMs(a) < createdMs(best) ||
      (createdMs(a) === createdMs(best) && a.id < best.id)
    ) {
      best = a;
    }
  }
  return best;
}

/**
 * Pick the live version out of one file's asset rows. A pointer that
 * names an asset not in the list (stale, or moved to another file) falls
 * back like a null one rather than returning nothing.
 */
export function pickCurrentAsset<T extends VersionedAssetLike>(
  currentAssetId: string | null | undefined,
  assets: T[]
): T | null {
  if (currentAssetId) {
    const hit = assets.find((a) => a.id === currentAssetId);
    if (hit) return hit;
  }
  return oldestAsset(assets);
}

/**
 * Batched form of `pickCurrentAsset` for readers that load the assets of
 * many files in one IN-array query: groups rows by `fileId` and returns
 * the live version per file.
 */
export function currentAssetsByFileId<
  T extends VersionedAssetLike & { fileId: string | null },
>(
  rows: T[],
  currentAssetIdByFileId: Map<string, string | null>
): Map<string, T> {
  const byFile = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.fileId) continue;
    const list = byFile.get(row.fileId);
    if (list) list.push(row);
    else byFile.set(row.fileId, [row]);
  }
  const out = new Map<string, T>();
  for (const [fileId, list] of byFile) {
    const pick = pickCurrentAsset(currentAssetIdByFileId.get(fileId), list);
    if (pick) out.set(fileId, pick);
  }
  return out;
}

/**
 * SQL filter for a `file_assets ⋈ files` join that keeps only each file's
 * live version. A file without a pointer keeps all its rows (the
 * pre-versioning behaviour) — only reachable for a file whose current
 * asset was deleted, since every writer sets the pointer.
 */
export function isCurrentAsset(): SQL {
  return or(
    eq(fileAssets.id, files.currentAssetId),
    isNull(files.currentAssetId)
  )!;
}
