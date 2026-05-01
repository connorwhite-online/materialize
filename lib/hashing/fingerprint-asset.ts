import "server-only";

import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
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
      logError("fingerprintAndPersistAsset.fetch", {
        assetId,
        status: res.status,
      });
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
