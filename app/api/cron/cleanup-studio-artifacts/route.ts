import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cadGenerations,
  cadThreads,
  cartItems,
  fileAssets,
  files,
  printOrderItems,
  printOrders,
  projectFiles,
} from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Daily cron that closes the text-to-CAD storage leaks
 * (docs/text-to-cad/05 §E). Four sweeps:
 *
 *   1. `cad-renders/` R2 objects no cadGenerations.renderStorageKey
 *      references (deleted builds, failed persists) and older than 24h.
 *   2. `cad-topo/` R2 objects, same rule against topoStorageKey.
 *   2b. `cad-refs/` R2 objects (user reference images), same rule against
 *      the keys inside every referenceImages jsonb list.
 *   3. Stale unsaved studio drafts: files with source='studio' AND
 *      status='draft' older than CAD_DRAFT_RETENTION_DAYS (default 30)
 *      whose thread was never saved and whose assets no print order /
 *      cart item / project references — file + asset rows AND their R2
 *      objects are deleted.
 *
 * Safety rails (mirrors cleanup-orphan-uploads):
 *   - Prefix-scoped listings; nothing outside cad-renders/ / cad-topo/
 *     is ever listed or deleted by sweeps 1-2.
 *   - 24h object-age guard so in-flight generations aren't swept
 *     between the R2 write and the row update.
 *   - NEVER deletes a file whose assets are referenced by
 *     printOrders/printOrderItems/cartItems, a file bundled into a
 *     project, or any file of a thread with a savedFileId.
 *   - Batched deletes (100/batch) and a per-run cap on draft files.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/cleanup-studio-artifacts
 */

export const dynamic = "force-dynamic";

const RENDER_PREFIX = "cad-renders/";
const TOPO_PREFIX = "cad-topo/";
const REFS_PREFIX = "cad-refs/";
const ORPHAN_MIN_AGE_HOURS = 24;
const DELETE_BATCH_SIZE = 100;
const MAX_DRAFT_FILES_PER_RUN = 200;
const DEFAULT_DRAFT_RETENTION_DAYS = 30;

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

function draftRetentionDays(): number {
  const parsed = Number.parseInt(
    process.env.CAD_DRAFT_RETENTION_DAYS ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DRAFT_RETENTION_DAYS;
}

async function deleteKeys(
  s3: S3Client,
  bucket: string,
  keys: string[],
  logContext: string
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      })
    );
    deleted += res.Deleted?.length ?? 0;
    for (const err of res.Errors ?? []) {
      logError(`${logContext}.deleteError`, {
        key: err.Key,
        message: err.Message,
      });
    }
  }
  return deleted;
}

/** Sweep one prefix: delete objects older than the age guard that no row references. */
async function sweepPrefix(
  s3: S3Client,
  bucket: string,
  prefix: string,
  referenced: Set<string>
): Promise<{ scanned: number; deleted: number }> {
  const now = Date.now();
  const minAgeMs = ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000;

  let continuationToken: string | undefined;
  let scanned = 0;
  const orphans: string[] = [];

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const contents: _Object[] = res.Contents ?? [];
    scanned += contents.length;

    for (const obj of contents) {
      if (!obj.Key) continue;
      // Safety: never sweep outside the given prefix.
      if (!obj.Key.startsWith(prefix)) continue;
      if (referenced.has(obj.Key)) continue;
      if (obj.LastModified && now - obj.LastModified.getTime() < minAgeMs) {
        continue;
      }
      orphans.push(obj.Key);
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  const deleted = await deleteKeys(
    s3,
    bucket,
    orphans,
    "cron/cleanup-studio-artifacts"
  );
  return { scanned, deleted };
}

/**
 * Sweep stale unsaved studio drafts: file + asset rows and their R2
 * objects. Returns counts for the response body.
 */
async function sweepStaleDrafts(
  s3: S3Client,
  bucket: string
): Promise<{ candidates: number; deletedFiles: number; deletedObjects: number }> {
  const cutoff = new Date(
    Date.now() - draftRetentionDays() * 24 * 60 * 60 * 1000
  );

  const candidates = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.source, "studio"),
        eq(files.status, "draft"),
        lt(files.createdAt, cutoff)
      )
    )
    .limit(MAX_DRAFT_FILES_PER_RUN);
  if (candidates.length === 0) {
    return { candidates: 0, deletedFiles: 0, deletedObjects: 0 };
  }
  const candidateIds = candidates.map((c) => c.id);

  const assets = await db
    .select({
      id: fileAssets.id,
      fileId: fileAssets.fileId,
      storageKey: fileAssets.storageKey,
      // Editable STEP source (MTR-196) rides the asset's lifecycle — it must
      // be swept with the STL, not orphaned in R2 when the draft is deleted.
      stepStorageKey: fileAssets.stepStorageKey,
    })
    .from(fileAssets)
    .where(inArray(fileAssets.fileId, candidateIds));
  const assetIds = assets.map((a) => a.id);
  const fileIdByAssetId = new Map(
    assets
      .filter((a): a is typeof a & { fileId: string } => !!a.fileId)
      .map((a) => [a.id, a.fileId])
  );

  const protectedFileIds = new Set<string>();

  if (assetIds.length > 0) {
    // Guard rail: order/cart references pin the file forever.
    const [orderRefs, itemRefs, cartRefs] = await Promise.all([
      db
        .select({ fileAssetId: printOrders.fileAssetId })
        .from(printOrders)
        .where(inArray(printOrders.fileAssetId, assetIds)),
      db
        .select({ fileAssetId: printOrderItems.fileAssetId })
        .from(printOrderItems)
        .where(inArray(printOrderItems.fileAssetId, assetIds)),
      db
        .select({ fileAssetId: cartItems.fileAssetId })
        .from(cartItems)
        .where(inArray(cartItems.fileAssetId, assetIds)),
    ]);
    for (const ref of [...orderRefs, ...itemRefs, ...cartRefs]) {
      const fileId = ref.fileAssetId
        ? fileIdByAssetId.get(ref.fileAssetId)
        : undefined;
      if (fileId) protectedFileIds.add(fileId);
    }

    // Guard rail: files of a SAVED thread stay (they're this design's
    // version history); only never-saved threads' drafts are stale.
    const gens = await db
      .select({
        fileAssetId: cadGenerations.fileAssetId,
        threadId: cadGenerations.threadId,
      })
      .from(cadGenerations)
      .where(
        and(
          inArray(cadGenerations.fileAssetId, assetIds),
          isNotNull(cadGenerations.threadId)
        )
      );
    const threadIds = [
      ...new Set(gens.map((g) => g.threadId).filter((t): t is string => !!t)),
    ];
    if (threadIds.length > 0) {
      const savedThreads = await db
        .select({ id: cadThreads.id })
        .from(cadThreads)
        .where(
          and(
            inArray(cadThreads.id, threadIds),
            isNotNull(cadThreads.savedFileId)
          )
        );
      const savedThreadIds = new Set(savedThreads.map((t) => t.id));
      for (const g of gens) {
        if (!g.threadId || !savedThreadIds.has(g.threadId)) continue;
        const fileId = g.fileAssetId
          ? fileIdByAssetId.get(g.fileAssetId)
          : undefined;
        if (fileId) protectedFileIds.add(fileId);
      }
    }
  }

  // Guard rail: project-bundled files stay (assembly parts live under
  // their auto-created Project until the project itself is deleted).
  const projectRefs = await db
    .select({ fileId: projectFiles.fileId })
    .from(projectFiles)
    .where(inArray(projectFiles.fileId, candidateIds));
  for (const ref of projectRefs) protectedFileIds.add(ref.fileId);

  const deletableFileIds = candidateIds.filter(
    (id) => !protectedFileIds.has(id)
  );
  if (deletableFileIds.length === 0) {
    return { candidates: candidates.length, deletedFiles: 0, deletedObjects: 0 };
  }

  // R2 first (the DB rows are what makes the keys discoverable), then the
  // file rows — fileAssets cascade via their FK, and
  // cadGenerations.fileAssetId is SET NULL so build history survives.
  const deletableFileIdSet = new Set(deletableFileIds);
  const keys = assets
    .filter((a) => a.fileId && deletableFileIdSet.has(a.fileId))
    .flatMap((a) =>
      [a.storageKey, a.stepStorageKey].filter((k): k is string => !!k)
    );
  const deletedObjects = await deleteKeys(
    s3,
    bucket,
    keys,
    "cron/cleanup-studio-artifacts.drafts"
  );

  await db.delete(files).where(inArray(files.id, deletableFileIds));

  return {
    candidates: candidates.length,
    deletedFiles: deletableFileIds.length,
    deletedObjects,
  };
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logError(
      "cron/cleanup-studio-artifacts.auth",
      new Error("CRON_SECRET not configured")
    );
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    logError(
      "cron/cleanup-studio-artifacts.auth",
      new Error("Unauthorized cron request")
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const s3 = getS3Client();
    const bucket = getBucketName();

    const [renderRefs, topoRefs, imageRefs] = await Promise.all([
      db
        .select({ key: cadGenerations.renderStorageKey })
        .from(cadGenerations)
        .where(isNotNull(cadGenerations.renderStorageKey)),
      db
        .select({ key: cadGenerations.topoStorageKey })
        .from(cadGenerations)
        .where(isNotNull(cadGenerations.topoStorageKey)),
      db
        .select({ refs: cadGenerations.referenceImages })
        .from(cadGenerations)
        .where(isNotNull(cadGenerations.referenceImages)),
    ]);

    const renders = await sweepPrefix(
      s3,
      bucket,
      RENDER_PREFIX,
      new Set(renderRefs.map((r) => r.key).filter((k): k is string => !!k))
    );
    const topo = await sweepPrefix(
      s3,
      bucket,
      TOPO_PREFIX,
      new Set(topoRefs.map((r) => r.key).filter((k): k is string => !!k))
    );
    // Reference images: a key is live while ANY row lists it — revisions
    // share their ancestors' keys (lib/cad/reference-images.ts), so the set
    // is flattened across every row's jsonb list.
    const refImages = await sweepPrefix(
      s3,
      bucket,
      REFS_PREFIX,
      new Set(
        imageRefs
          .flatMap((r) => r.refs ?? [])
          .map((r) => r?.key)
          .filter((k): k is string => typeof k === "string" && k.length > 0)
      )
    );
    const drafts = await sweepStaleDrafts(s3, bucket);

    const result = { renders, topo, refImages, drafts };
    console.log("[cron/cleanup-studio-artifacts] swept", result);
    return Response.json(result);
  } catch (error) {
    logError("cron/cleanup-studio-artifacts", error);
    return Response.json(
      { error: "Studio artifact cleanup failed" },
      { status: 500 }
    );
  }
}
