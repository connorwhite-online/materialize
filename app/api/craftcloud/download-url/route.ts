import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const { fileAssetId } = (await request.json()) as { fileAssetId: string };
    if (!fileAssetId) {
      return Response.json({ error: "Missing fileAssetId" }, { status: 400 });
    }

    // Get asset with access check
    const [assetRow] = await db
      .select({
        storageKey: fileAssets.storageKey,
        filename: fileAssets.originalFilename,
        fileUserId: files.userId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

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
