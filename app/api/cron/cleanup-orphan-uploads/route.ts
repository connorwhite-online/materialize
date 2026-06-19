import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { fileAssets } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

/**
 * Daily cron that garbage-collects R2 objects under `uploads/` that no
 * `file_assets` row points to and are older than a safety threshold.
 *
 * These orphans happen when a presigned PUT to R2 succeeds but the
 * subsequent createDraftFileForPrint / createFileListing server action
 * fails — the object lands in the bucket with no DB reference, and there
 * is no foreground cleanup path.
 *
 * Safety rails:
 *   - Only touches keys with the `uploads/` prefix.
 *   - Only deletes objects older than ORPHAN_MIN_AGE_HOURS (24h) — an
 *     in-flight upload that is still being wired to its fileAssets row
 *     won't get swept out from under it.
 *   - Batched deletes (100/batch) to stay within R2 API limits.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/cleanup-orphan-uploads
 *
 * For dry-run / one-off manual sweeps use scripts/cleanup-orphan-uploads.ts.
 */

export const dynamic = "force-dynamic";

const UPLOAD_PREFIX = "uploads/";
const ORPHAN_MIN_AGE_HOURS = 24;
const DELETE_BATCH_SIZE = 100;

function getS3Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set"
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("Missing R2_BUCKET_NAME");
  }
  return bucket;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const s3 = getS3Client();
    const bucket = getBucketName();

    // Pull every storage_key currently referenced by file_assets.
    // Small table, fits in memory. A Set gives O(1) lookup during sweep.
    const referencedRows = await db
      .select({ storageKey: fileAssets.storageKey })
      .from(fileAssets);
    const referenced = new Set(referencedRows.map((r) => r.storageKey));

    const now = Date.now();
    const minAgeMs = ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000;

    // Paginated list — R2 caps at 1000 keys per response, loop with
    // ContinuationToken until the bucket is exhausted.
    let continuationToken: string | undefined;
    let scanned = 0;
    const orphans: _Object[] = [];

    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: UPLOAD_PREFIX,
          ContinuationToken: continuationToken,
        })
      );
      const contents = res.Contents ?? [];
      scanned += contents.length;

      for (const obj of contents) {
        if (!obj.Key) continue;
        // Safety: never sweep outside the uploads/ prefix.
        if (!obj.Key.startsWith(UPLOAD_PREFIX)) continue;
        // Known-good — referenced by a fileAssets row.
        if (referenced.has(obj.Key)) continue;
        // Too young — may still be mid-workflow.
        if (
          obj.LastModified &&
          now - obj.LastModified.getTime() < minAgeMs
        ) {
          continue;
        }
        orphans.push(obj);
      }

      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    let deleted = 0;
    let reclaimedBytes = 0;

    for (const o of orphans) reclaimedBytes += o.Size ?? 0;

    // Batch-delete all orphans.
    for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
      const batch = orphans.slice(i, i + DELETE_BATCH_SIZE);
      const res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch
              .map((o) => (o.Key ? { Key: o.Key } : null))
              .filter((k): k is { Key: string } => k !== null),
          },
        })
      );
      deleted += res.Deleted?.length ?? 0;
      if (res.Errors && res.Errors.length > 0) {
        for (const err of res.Errors) {
          logError("cron/cleanup-orphan-uploads.deleteError", {
            key: err.Key,
            message: err.Message,
          });
        }
      }
    }

    const result = { scanned, orphans: orphans.length, deleted, reclaimedBytes };
    console.log("[cron/cleanup-orphan-uploads] swept", result);
    return Response.json(result);
  } catch (error) {
    logError("cron/cleanup-orphan-uploads", error);
    return Response.json({ error: "Orphan upload cleanup failed" }, { status: 500 });
  }
}
