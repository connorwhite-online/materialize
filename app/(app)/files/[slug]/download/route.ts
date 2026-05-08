import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  fileDownloads,
  purchases,
  projectFiles,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { ownsLoadedFile } from "@/lib/entitlement";
import { NextRequest } from "next/server";
import {
  buildWatermarkToken,
  embedWatermark,
} from "@/lib/watermark/embed";
import { logError } from "@/lib/logger";

const FORMAT_MIME: Record<string, string> = {
  stl: "model/stl",
  obj: "text/plain",
  "3mf": "model/3mf",
  step: "application/step",
  amf: "application/x-amf",
};

// Resolve the purchase id we'll embed into the watermark token. Falls
// back to synthetic ids when there's no purchase row (free files,
// creator self-downloads) so we still get a uniquely-attributable
// token in the header without making the watermark column nullable.
async function resolvePurchaseId(
  userId: string | null,
  file: { id: string; price: number; userId: string }
): Promise<string> {
  if (file.price === 0) return `free:${file.id}`;
  if (!userId) return `anon:${file.id}`;
  if (file.userId === userId) return `creator:${userId}:${file.id}`;

  const [direct] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.buyerId, userId),
        eq(purchases.fileId, file.id),
        eq(purchases.status, "completed")
      )
    )
    .limit(1);
  if (direct) return direct.id;

  const [viaProject] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .innerJoin(projectFiles, eq(projectFiles.projectId, purchases.projectId))
    .where(
      and(
        eq(purchases.buyerId, userId),
        eq(purchases.status, "completed"),
        eq(projectFiles.fileId, file.id),
        sql`${purchases.projectId} IS NOT NULL`
      )
    )
    .limit(1);
  if (viaProject) return viaProject.id;

  // Shouldn't happen — entitlement check passed but no purchase row.
  // Return a synthetic id rather than blowing up the download.
  return `unknown:${userId}:${file.id}`;
}

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

  if (!(await ownsLoadedFile(userId, file))) {
    return new Response(userId ? "Payment required" : "Unauthorized", {
      status: userId ? 402 : 401,
    });
  }

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

  await Promise.all([
    db
      .update(files)
      .set({ downloadCount: sql`${files.downloadCount} + 1` })
      .where(eq(files.id, file.id)),
    // Per-download log row, powering the activity stream on the file
    // detail page. userId is null for anon downloads of free files —
    // those still increment the counter and show up in totals, just
    // not in the per-user stream.
    db.insert(fileDownloads).values({
      fileId: file.id,
      fileAssetId: asset.id,
      userId: userId ?? null,
    }),
  ]);

  // Stream from R2, embed a watermark in the format-appropriate
  // metadata region, then serve. We have to buffer the bytes for the
  // watermark step (header rewrite for STL, line prepend for OBJ) —
  // the formats we serve here are typically a few MB to ~200MB, well
  // inside Vercel's function memory budget. If we ever start serving
  // larger files we'll want to short-circuit to the redirect path
  // for unwatermarkable formats.
  try {
    const downloadUrl = await generateDownloadUrl(asset.storageKey, 300);
    const upstream = await fetch(downloadUrl, { signal: request.signal });
    if (!upstream.ok) {
      return new Response("Upstream fetch failed", { status: 502 });
    }
    const upstreamBytes = new Uint8Array(await upstream.arrayBuffer());

    const purchaseId = await resolvePurchaseId(userId, file);
    const token = buildWatermarkToken({
      userId: userId ?? `anon:${file.id}`,
      purchaseId,
      issuedAt: Math.floor(Date.now() / 1000),
    });

    const watermarked = embedWatermark(upstreamBytes, asset.format, token);

    const headers = new Headers({
      "Content-Type":
        FORMAT_MIME[asset.format] ?? "application/octet-stream",
      "Content-Length": String(watermarked.byteLength),
      "Content-Disposition": `attachment; filename="${asset.originalFilename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    });

    // Copy into a fresh ArrayBuffer-backed Uint8Array so the runtime
    // body matches `BodyInit` under the current TS lib (which rejects
    // Uint8Array<ArrayBufferLike> because of SharedArrayBuffer).
    const body = new ArrayBuffer(watermarked.byteLength);
    new Uint8Array(body).set(watermarked);
    return new Response(body, { status: 200, headers });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    logError("files/[slug]/download", error);
    return new Response("Download failed", { status: 500 });
  }
}
