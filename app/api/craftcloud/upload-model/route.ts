import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { isPublicListing } from "@/lib/files/public-listing";
import { getObjectBytes, objectExists } from "@/lib/storage";
import { MAX_FILE_SIZE } from "@/lib/validations/file";
import type { FileUnit } from "@/lib/craftcloud/types";
import { logError } from "@/lib/logger";
import { invalidJsonResponse, readJsonObject } from "@/lib/http/json-body";
import {
  CraftCloudUploadError,
  uploadModelToCraftCloud,
} from "@/lib/craftcloud/model-upload";
import { consumeAnonUploadGrant } from "@/lib/uploads/anon-grants";
import {
  consumeRateLimit,
  RATE_LIMITS,
  rateLimitCallerKey,
  rateLimitedResponse,
} from "@/lib/rate-limit";

/**
 * Server-side CraftCloud model upload for a stored file asset.
 *
 * The browser used to run the upload itself (R2 proxy fetch →
 * CraftCloud), which kept large files off our server. CraftCloud's
 * replacement upload endpoints answer with
 * `Access-Control-Allow-Origin: https://craftcloud3d.com` rather than
 * `*`, so that is no longer possible: confirmed in prod as
 * `craftcloud.model-upload-unreachable` at the `initiate` leg from
 * www.materialize.cc. Running the chain here side-steps CORS
 * entirely.
 *
 * The bytes go R2 → this route → CraftCloud; they never travel via
 * the browser, so Vercel's request-body limit doesn't apply — only
 * the function's own duration/memory budget, hence `maxDuration`.
 *
 * Folds in what `/api/craftcloud/cache-model` did: on success the
 * modelId + geometry are persisted, so the client no longer makes a
 * second call. That route has since been deleted: it let any signed-in
 * user write an arbitrary modelId + geometry onto a published asset,
 * whereas here the modelId always comes from bytes we uploaded.
 */
export const maxDuration = 300;

const FILE_UNITS = new Set<FileUnit>(["mm", "cm", "in"]);

/**
 * HEAD the staged object and refuse anything over MAX_FILE_SIZE
 * before pulling it into this function's memory. The presign routes
 * sign the declared size, but objects written before that (or by any
 * other path into the bucket) were never bound by it.
 */
async function checkStagedObject(key: string): Promise<Response | null> {
  const head = await objectExists(key);
  if (!head.exists) {
    return Response.json({ error: "Upload not found" }, { status: 404 });
  }
  if (head.sizeBytes > MAX_FILE_SIZE) {
    return Response.json(
      { error: "File exceeds 200MB limit" },
      { status: 413 }
    );
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const { fileAssetId, storageKey, fileUnit } = body as {
      fileAssetId?: string;
      storageKey?: string;
      fileUnit?: FileUnit;
    };
    if (fileUnit !== undefined && !FILE_UNITS.has(fileUnit)) {
      return Response.json(
        { error: "fileUnit must be one of mm, cm, in" },
        { status: 400 }
      );
    }

    // Anon draft mode: the visitor has no fileAssets row — their model
    // was staged in R2 via /api/upload/anon-presign. Authorization is
    // the grant itself: consumeAnonUploadGrant only returns a key we
    // issued, unconsumed and unexpired, and marks it consumed in the
    // same statement. A key that isn't ours is indistinguishable from
    // one that doesn't exist, so this can't be used to read arbitrary
    // objects out of the bucket.
    if (storageKey) {
      const grant = await consumeAnonUploadGrant(storageKey);
      if (!grant) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const rejected = await checkStagedObject(storageKey);
      if (rejected) return rejected;

      const anonBytes = await getObjectBytes(storageKey);
      const anonModel = await uploadModelToCraftCloud(
        anonBytes,
        grant.originalFilename,
        fileUnit ?? "mm"
      );

      // Nothing to persist: there is no fileAssets row yet. The client
      // holds the modelId for the quote, and the real upload happens
      // at checkout under the new owner's key.
      return Response.json({
        modelId: anonModel.modelId,
        dimensions: anonModel.dimensions,
        volume: anonModel.volume,
        isParsing: anonModel.isParsing,
      });
    }

    if (!fileAssetId) {
      return Response.json(
        { error: "Missing fileAssetId or storageKey" },
        { status: 400 }
      );
    }

    const [assetRow] = await db
      .select({
        storageKey: fileAssets.storageKey,
        filename: fileAssets.originalFilename,
        fileUnit: fileAssets.fileUnit,
        cachedModelId: fileAssets.craftCloudModelId,
        geometryData: fileAssets.geometryData,
        fileUserId: files.userId,
        fileStatus: files.status,
        fileVisibility: files.visibility,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

    if (!assetRow) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    // Same gate as /api/craftcloud/download-url: the owner, or anyone
    // when the listing is published and public.
    const isOwner = Boolean(userId) && assetRow.fileUserId === userId;
    const isPublished = isPublicListing(assetRow);
    if (!isOwner && !isPublished) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // Already uploaded (by the owner or a previous quoter): the asset's
    // geometry is immutable (a new version is a new row), so the cached
    // modelId still describes these exact bytes. Skip the R2 download
    // and the three-leg CraftCloud chain entirely.
    if (assetRow.cachedModelId) {
      return Response.json({
        modelId: assetRow.cachedModelId,
        dimensions: assetRow.geometryData?.dimensions ?? null,
        volume: assetRow.geometryData?.volume ?? null,
        isParsing: false,
      });
    }

    // Only a real upload counts against the cap: the cached path above
    // is one indexed read, and the anon path is already bounded by the
    // fail-closed grant limiter on /api/upload/anon-presign.
    const limited = await consumeRateLimit(
      RATE_LIMITS.modelUpload,
      rateLimitCallerKey(request.headers, userId)
    );
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSeconds);

    const rejected = await checkStagedObject(assetRow.storageKey);
    if (rejected) return rejected;

    const bytes = await getObjectBytes(assetRow.storageKey);
    const model = await uploadModelToCraftCloud(
      bytes,
      assetRow.filename,
      assetRow.fileUnit ?? "mm"
    );

    // Persist for next time. Non-owners may only first-capture the
    // modelId — the isNull guard means a third party can never
    // repoint an established listing at different geometry. (Rows with
    // a cached modelId return early above, so this mainly guards the
    // race of two first-time quoters.)
    //
    // Deliberately non-fatal: the caller already has the modelId in
    // the response and quotes fine without this row ever being
    // written. A failed cache costs a re-upload on the next visit,
    // which is not worth failing a working upload over — the same
    // resilience the client-side cache-model call used to have.
    try {
      await db
        .update(fileAssets)
        .set({
          craftCloudModelId: model.modelId,
          ...(model.dimensions
            ? {
                geometryData: {
                  dimensions: model.dimensions,
                  volume: model.volume ?? undefined,
                },
              }
            : {}),
        })
        .where(
          isOwner
            ? eq(fileAssets.id, fileAssetId)
            : and(
                eq(fileAssets.id, fileAssetId),
                isNull(fileAssets.craftCloudModelId)
              )
        );
    } catch (cacheError) {
      logError("api/craftcloud/upload-model:cache", cacheError);
    }

    return Response.json({
      modelId: model.modelId,
      dimensions: model.dimensions,
      volume: model.volume,
      isParsing: model.isParsing,
    });
  } catch (error) {
    logError("api/craftcloud/upload-model", error);
    // Pass CraftCloud's own failure through so the print page can show
    // something specific and the step lands in our logs, rather than a
    // flat 500 that hides which leg of the chain broke.
    if (error instanceof CraftCloudUploadError) {
      return Response.json(
        {
          error: error.message,
          step: error.step,
          craftCloudStatus: error.status,
        },
        { status: 502 }
      );
    }
    return Response.json({ error: "Failed to upload model" }, { status: 500 });
  }
}
