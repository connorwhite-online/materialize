import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = (await request.json()) as {
      fileAssetId: string;
      modelId: string;
      geometry?: {
        dimensions?: { x: number; y: number; z: number };
        volume?: number;
        triangleCount?: number;
      };
    };

    if (!body.fileAssetId || !body.modelId) {
      return Response.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify access
    const [assetRow] = await db
      .select({
        id: fileAssets.id,
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

    await db
      .update(fileAssets)
      .set({
        craftCloudModelId: body.modelId,
        geometryData: body.geometry || undefined,
      })
      .where(eq(fileAssets.id, body.fileAssetId));

    return Response.json({ cached: true });
  } catch (error) {
    logError("api/craftcloud/cache-model", error);
    return Response.json({ error: "Failed to cache model" }, { status: 500 });
  }
}
