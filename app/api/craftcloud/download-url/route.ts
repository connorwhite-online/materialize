import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logError } from "@/lib/logger";

/**
 * Resolves a same-origin URL for the asset's bytes plus its CraftCloud
 * upload metadata (filename + fileUnit).
 *
 * NB: `downloadUrl` used to be a signed R2 URL. We hand callers a
 * proxy URL instead — both `MaterialPreview` (browser STL/OBJ/3MF
 * loaders) and `uploadToCraftCloud` fetch the bytes from the browser,
 * and a cross-origin GET to R2 needs a CORS preflight that the bucket
 * doesn't grant. Same-origin proxy side-steps the issue and keeps the
 * R2 read on the server. The route still verifies access (published
 * file or owner) and only stays open for 5 minutes' worth of cache.
 *
 * Two lookup modes:
 *  - fileAssetId → `/api/files/preview/<id>`
 *  - storageKey  → `/api/files/preview/by-key?key=<key>` (owner-only,
 *    verified by the `uploads/{userId}/` prefix on the proxy side too)
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = (await request.json()) as {
      fileAssetId?: string;
      storageKey?: string;
    };

    if (body.storageKey) {
      if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!body.storageKey.startsWith(`uploads/${userId}/`)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const downloadUrl = `/api/files/preview/by-key?key=${encodeURIComponent(
        body.storageKey
      )}`;
      return Response.json({ downloadUrl });
    }

    if (!body.fileAssetId) {
      return Response.json(
        { error: "Missing fileAssetId or storageKey" },
        { status: 400 }
      );
    }

    const [assetRow] = await db
      .select({
        filename: fileAssets.originalFilename,
        fileUnit: fileAssets.fileUnit,
        fileUserId: files.userId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, body.fileAssetId));

    if (!assetRow) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const isOwner = userId && assetRow.fileUserId === userId;
    const isPublished = assetRow.fileStatus === "published";
    if (!isOwner && !isPublished) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    return Response.json({
      downloadUrl: `/api/files/preview/${body.fileAssetId}`,
      filename: assetRow.filename,
      fileUnit: assetRow.fileUnit,
    });
  } catch (error) {
    logError("api/craftcloud/download-url", error);
    return Response.json({ error: "Failed to generate URL" }, { status: 500 });
  }
}
