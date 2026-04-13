import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Redirects to a freshly signed R2 URL for the file's thumbnail. The
 * files.thumbnailUrl column stores `/api/thumbnails/{fileId}` as a
 * stable reference so that browsers get a short-lived presigned URL
 * each time they load the image — working around S3's 7-day
 * max-expiration limit without re-writing the DB row.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await context.params;
    if (!fileId) {
      return new Response("Missing fileId", { status: 400 });
    }

    const [file] = await db
      .select({ id: files.id, thumbnailUrl: files.thumbnailUrl })
      .from(files)
      .where(eq(files.id, fileId));

    if (!file || !file.thumbnailUrl) {
      return new Response("Not found", { status: 404 });
    }

    const storageKey = `thumbnails/${fileId}.webp`;
    // Short-lived — 1 hour is plenty for an image that gets loaded
    // and cached by the browser immediately.
    const signed = await generateDownloadUrl(storageKey, 60 * 60);

    return Response.redirect(signed, 302);
  } catch (error) {
    logError("api/thumbnails/[fileId]", error);
    return new Response("Failed to resolve thumbnail", { status: 500 });
  }
}
