import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = (await request.json()) as {
      fileAssetId?: string;
      storageKey?: string;
    };

    // Two lookup modes:
    // - fileAssetId: looks up the asset in DB and checks ownership/published
    // - storageKey: direct lookup, only allowed for the owner of that key
    //   (verified via the uploads/{userId}/ prefix)
    if (body.storageKey) {
      if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!body.storageKey.startsWith(`uploads/${userId}/`)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const downloadUrl = await generateDownloadUrl(body.storageKey, 300);
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
        storageKey: fileAssets.storageKey,
        filename: fileAssets.originalFilename,
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

    const downloadUrl = await generateDownloadUrl(assetRow.storageKey, 300);

    return Response.json({
      downloadUrl,
      filename: assetRow.filename,
    });
  } catch (error) {
    logError("api/craftcloud/download-url", error);
    return Response.json({ error: "Failed to generate URL" }, { status: 500 });
  }
}
