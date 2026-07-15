import "server-only";

import { db } from "@/lib/db";
import { fileAssets, files, users } from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { fingerprintFromStream, type MeshFormat } from "./mesh-fingerprint";

/**
 * Fetch the asset bytes from R2, parse + fingerprint the mesh, persist
 * the geometry/coarse/stats columns, and run the cross-user
 * geometry-hash collision check. On a hit, the listing is auto-archived
 * with a flagged_reason / flagged_at / flagged_against_file_id audit
 * trail (owner can dispute later).
 *
 * Used in two places:
 *   - `app/actions/files.ts` schedules this via Next 16 `after()` so it
 *     runs immediately after the upload response is sent.
 *   - `app/api/cron/sweep-fingerprint-stragglers/route.ts` runs it for
 *     rows whose `after()` invocation never finished (function
 *     terminated, cold-start race, etc.).
 *
 * Strictly safe to re-run on a row that was already fingerprinted —
 * the cron query filters by `geometry_hash IS NULL`, but if the row
 * raced to a partial state the UPDATE simply overwrites with the same
 * deterministic values.
 *
 * Never throws — all failures are logged and swallowed so a single bad
 * file doesn't poison the cron sweep.
 */
export async function fingerprintAndPersistAsset(params: {
  assetId: string;
  fileId: string;
  ownerUserId: string;
  storageKey: string;
  format: MeshFormat;
  fileUnit: "mm" | "cm" | "in";
}): Promise<void> {
  const { assetId, fileId, ownerUserId, storageKey, format, fileUnit } =
    params;
  try {
    const downloadUrl = await generateDownloadUrl(storageKey, 300);
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) {
      // 404 is a known, non-actionable state: the asset row exists
      // but its R2 object is gone (user deleted the listing before
      // fingerprint ran, abandoned upload, etc.). Demote to warn so
      // it stops paging Sentry. Real fetch failures (5xx, network)
      // still go through logError.
      if (res.status === 404) {
        console.warn("[fingerprintAndPersistAsset.fetch] 404", {
          assetId,
          storageKey,
        });
      } else {
        logError("fingerprintAndPersistAsset.fetch", {
          assetId,
          status: res.status,
        });
      }
      return;
    }
    const fp = await fingerprintFromStream(res.body, format, fileUnit);

    await db
      .update(fileAssets)
      .set({
        contentHash: fp.byteHash,
        geometryHash: fp.geometryHash,
        geometryHashVersion: fp.geometryHashVersion,
        coarseFingerprint: fp.coarseFingerprint,
        volumeUm3: fp.volumeUm3,
        triangleCount: fp.triangleCount,
        bboxXUm: fp.bboxXUm,
        bboxYUm: fp.bboxYUm,
        bboxZUm: fp.bboxZUm,
      })
      .where(eq(fileAssets.id, assetId));

    if (fp.geometryHash) {
      const [hit] = await db
        .select({ fileId: fileAssets.fileId })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(
          and(
            eq(fileAssets.geometryHash, fp.geometryHash),
            ne(files.userId, ownerUserId),
            ne(fileAssets.id, assetId)
          )
        )
        .limit(1);
      if (hit && hit.fileId) {
        await db
          .update(files)
          .set({
            status: "archived",
            flaggedReason: "geometry_collision",
            flaggedAt: new Date(),
            flaggedAgainstFileId: hit.fileId,
          })
          .where(eq(files.id, fileId));
        logError("fingerprintAndPersistAsset.autoArchive", {
          fileId,
          ownerUserId,
          collidedWithFileId: hit.fileId,
        });
      }
    }

    if (fp.coarseFingerprint) {
      const coarseDup = await db
        .select({ id: fileAssets.id, fileId: fileAssets.fileId })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(
          and(
            eq(fileAssets.coarseFingerprint, fp.coarseFingerprint),
            ne(files.userId, ownerUserId),
            ne(fileAssets.id, assetId)
          )
        )
        .limit(5);
      if (coarseDup.length > 0) {
        logError("fingerprintAndPersistAsset.coarseSoftMatch", {
          fileId,
          coarseFingerprint: fp.coarseFingerprint,
          matchedAssetIds: coarseDup.map((r) => r.id),
        });
      }
    }
  } catch (err) {
    logError("fingerprintAndPersistAsset", err);
  }
}

export interface SameUserAssetHit {
  assetId: string;
  fileId: string;
  fileSlug: string;
  fileName: string;
}

export interface DuplicateFileSummary {
  fileId: string;
  fileName: string | null;
  fileSlug: string | null;
  thumbnailUrl: string | null;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
}

/**
 * Batched cross-user byte-hash collision check for a multi-asset
 * upload. Returns one incumbent listing per matching hash. Public listing
 * metadata is included for the duplicate-intent UI; private/draft listings
 * are deliberately redacted while still blocking the duplicate.
 */
export async function checkByteHashCollisionBatch(
  byteHashes: string[],
  userId: string,
  organizationId: string | null = null
): Promise<Map<string, DuplicateFileSummary>> {
  if (byteHashes.length === 0) return new Map();
  const hits = await db
    .select({
      contentHash: fileAssets.contentHash,
      fileId: files.id,
      fileName: files.name,
      fileSlug: files.slug,
      thumbnailUrl: files.thumbnailUrl,
      status: files.status,
      visibility: files.visibility,
      ownerUsername: users.username,
      ownerDisplayName: users.displayName,
      ownerAvatarUrl: users.avatarUrl,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .innerJoin(users, eq(files.userId, users.id))
    .where(
      and(
        inArray(fileAssets.contentHash, byteHashes),
        ne(files.userId, userId),
        ...(organizationId
          ? [
              or(
                isNull(files.organizationId),
                ne(files.organizationId, organizationId)
              ),
            ]
          : [])
      )
    )
    .orderBy(asc(fileAssets.createdAt));

  const collisions = new Map<string, DuplicateFileSummary>();
  for (const hit of hits) {
    if (!hit.contentHash) continue;
    const isPublic =
      hit.status === "published" && hit.visibility === "public";
    const summary: DuplicateFileSummary = {
      fileId: hit.fileId,
      fileName: isPublic ? hit.fileName : null,
      fileSlug: isPublic ? hit.fileSlug : null,
      thumbnailUrl: isPublic ? hit.thumbnailUrl : null,
      ownerUsername: isPublic ? hit.ownerUsername : null,
      ownerDisplayName: isPublic ? hit.ownerDisplayName : null,
      ownerAvatarUrl: isPublic ? hit.ownerAvatarUrl : null,
    };
    // Query order makes the earliest asset the canonical incumbent.
    if (!collisions.has(hit.contentHash)) {
      collisions.set(hit.contentHash, summary);
    }
  }
  return collisions;
}

/**
 * Batched same-user dedup check for a multi-asset upload, mirroring
 * `app/actions/files.ts`'s per-asset `findExistingSameUserAsset` two
 * signals (byte-hash match, then filename+size fallback) in a single
 * query for the whole batch instead of up to 2 queries per asset.
 *
 * Returns two lookup maps so the caller can replay the same
 * hash-first-then-filename/size priority per asset in memory:
 *   - `byHash` keyed by `contentHash`
 *   - `byNameSize` keyed by `${originalFilename}::${fileSize}`
 */
export async function findExistingSameUserAssetsBatch(
  userId: string,
  items: Array<{
    byteHash: string | null;
    originalFilename: string;
    fileSize: number;
  }>
): Promise<{
  byHash: Map<string, SameUserAssetHit>;
  byNameSize: Map<string, SameUserAssetHit>;
}> {
  const byHash = new Map<string, SameUserAssetHit>();
  const byNameSize = new Map<string, SameUserAssetHit>();

  const hashes = Array.from(
    new Set(items.map((i) => i.byteHash).filter((h): h is string => !!h))
  );
  // Filename+size fallback only applies to non-empty filenames with a
  // real size, same guard as the serial version.
  const nameSizePairs = items.filter(
    (i) => i.originalFilename && i.fileSize > 0
  );

  if (hashes.length === 0 && nameSizePairs.length === 0) {
    return { byHash, byNameSize };
  }

  const matchConditions = [
    ...(hashes.length > 0 ? [inArray(fileAssets.contentHash, hashes)] : []),
    ...nameSizePairs.map(({ originalFilename, fileSize }) =>
      and(
        eq(fileAssets.originalFilename, originalFilename),
        eq(fileAssets.fileSize, fileSize)
      )
    ),
  ];

  const rows = await db
    .select({
      assetId: fileAssets.id,
      fileId: files.id,
      fileSlug: files.slug,
      fileName: files.name,
      contentHash: fileAssets.contentHash,
      originalFilename: fileAssets.originalFilename,
      fileSize: fileAssets.fileSize,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(and(eq(files.userId, userId), or(...matchConditions)));

  for (const row of rows) {
    const hit: SameUserAssetHit = {
      assetId: row.assetId,
      fileId: row.fileId,
      fileSlug: row.fileSlug,
      fileName: row.fileName,
    };
    if (row.contentHash && !byHash.has(row.contentHash)) {
      byHash.set(row.contentHash, hit);
    }
    if (row.originalFilename && row.fileSize) {
      const key = `${row.originalFilename}::${row.fileSize}`;
      if (!byNameSize.has(key)) byNameSize.set(key, hit);
    }
  }

  return { byHash, byNameSize };
}
