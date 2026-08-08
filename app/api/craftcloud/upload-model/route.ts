import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { getObjectBytes } from "@/lib/storage";
import { logError } from "@/lib/logger";
import {
  CraftCloudUploadError,
  uploadModelToCraftCloud,
} from "@/lib/craftcloud/model-upload";

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
 * second call. That route still exists for any other caller.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const { fileAssetId } = (await request.json()) as {
      fileAssetId?: string;
    };
    if (!fileAssetId) {
      return Response.json({ error: "Missing fileAssetId" }, { status: 400 });
    }

    const [assetRow] = await db
      .select({
        storageKey: fileAssets.storageKey,
        filename: fileAssets.originalFilename,
        fileUnit: fileAssets.fileUnit,
        cachedModelId: fileAssets.craftCloudModelId,
        fileUserId: files.userId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

    if (!assetRow) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    // Same gate as /api/craftcloud/download-url and cache-model: the
    // owner, or anyone when the listing is published.
    const isOwner = Boolean(userId) && assetRow.fileUserId === userId;
    const isPublished = assetRow.fileStatus === "published";
    if (!isOwner && !isPublished) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const bytes = await getObjectBytes(assetRow.storageKey);
    const model = await uploadModelToCraftCloud(
      bytes,
      assetRow.filename,
      assetRow.fileUnit ?? "mm"
    );

    // Persist for next time. Non-owners may only first-capture the
    // modelId — the isNull guard means a third party can never
    // repoint an established listing at different geometry (the same
    // rule cache-model enforces).
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
