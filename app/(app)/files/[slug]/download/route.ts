import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  purchases,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const assetId = request.nextUrl.searchParams.get("asset");

  const { userId } = await auth();

  // Get the file
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.slug, slug), eq(files.status, "published")));

  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const isOwner = userId === file.userId;

  // Check access for paid files
  if (file.price > 0 && !isOwner) {
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const [purchase] = await db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.buyerId, userId),
          eq(purchases.fileId, file.id),
          eq(purchases.status, "completed")
        )
      );

    if (!purchase) {
      return new Response("Payment required", { status: 402 });
    }
  }

  // Get the requested asset (or first asset)
  const conditions = [eq(fileAssets.fileId, file.id)];
  if (assetId) {
    conditions.push(eq(fileAssets.id, assetId));
  }

  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(and(...conditions));

  if (!asset) {
    return new Response("Asset not found", { status: 404 });
  }

  // Increment download count
  await db
    .update(files)
    .set({ downloadCount: sql`${files.downloadCount} + 1` })
    .where(eq(files.id, file.id));

  // Generate a time-limited download URL
  const downloadUrl = await generateDownloadUrl(asset.storageKey, 300);

  return Response.redirect(downloadUrl);
}
