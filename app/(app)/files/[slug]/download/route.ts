import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { userOwnsFile } from "@/lib/entitlement";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const assetId = request.nextUrl.searchParams.get("asset");

  const { userId } = await auth();

  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.slug, slug), eq(files.status, "published")));

  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  if (!(await userOwnsFile(userId, file.id))) {
    return new Response(userId ? "Payment required" : "Unauthorized", {
      status: userId ? 402 : 401,
    });
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
