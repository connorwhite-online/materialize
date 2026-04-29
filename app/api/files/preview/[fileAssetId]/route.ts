import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Same-origin streaming proxy for the 3D model preview on file pages.
 *
 * `STLLoader` (and the other three.js loaders) does a browser `fetch()`
 * for the model bytes — which means a cross-origin GET to R2 needs a
 * CORS preflight that allows our origin + the GET method. Bucket-side
 * CORS is configured for uploads (PUT) but not for previews, and we
 * don't want to keep that surface in lockstep with every new origin
 * (preview deploys, custom domains, etc.).
 *
 * Streaming through this route side-steps the issue entirely: the
 * client fetches `/api/files/preview/<assetId>` (same origin, no
 * preflight), and the server pipes the R2 GET response body straight
 * back. The signed-URL step still happens, just server-side where
 * CORS doesn't apply.
 *
 * Access policy mirrors the existing `/api/craftcloud/download-url`
 * route: published files are previewable by anyone; draft files are
 * only previewable by their creator.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ fileAssetId: string }> }
) {
  const { fileAssetId } = await props.params;

  try {
    const { userId } = await auth();

    const [assetRow] = await db
      .select({
        storageKey: fileAssets.storageKey,
        format: fileAssets.format,
        fileUserId: files.userId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

    if (!assetRow) {
      return new Response("Not found", { status: 404 });
    }

    const isOwner = userId && assetRow.fileUserId === userId;
    const isPublished = assetRow.fileStatus === "published";
    if (!isOwner && !isPublished) {
      return new Response("Forbidden", { status: 403 });
    }

    const downloadUrl = await generateDownloadUrl(assetRow.storageKey, 300);
    const upstream = await fetch(downloadUrl);
    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream fetch failed", { status: 502 });
    }

    // Pass the bytes through. Cache for a few minutes — the asset is
    // immutable for a given fileAssetId (storage keys are content-
    // addressed at upload time), so the browser/CDN can hold onto it.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    logError("api/files/preview", error);
    return new Response("Preview failed", { status: 500 });
  }
}
