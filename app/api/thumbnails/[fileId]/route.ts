import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, filePhotos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Redirects to a freshly signed R2 URL for the file's thumbnail. The
 * files.thumbnailUrl column stores `/api/thumbnails/{fileId}` as a
 * stable reference so that browsers get a short-lived presigned URL
 * each time they load the image — working around S3's 7-day
 * max-expiration limit without re-writing the DB row.
 *
 * Published thumbnails are public (this is how browse/search show
 * previews to anon visitors). For unpublished files (drafts), the
 * thumbnail is gated to the owner so a leaked fileId can't surface
 * work-in-progress artwork.
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
      .select({
        id: files.id,
        thumbnailUrl: files.thumbnailUrl,
        status: files.status,
        userId: files.userId,
        coverPhotoId: files.coverPhotoId,
      })
      .from(files)
      .where(eq(files.id, fileId));

    if (!file || !file.thumbnailUrl) {
      return new Response("Not found", { status: 404 });
    }

    if (file.status !== "published") {
      const { userId } = await auth();
      if (!userId || userId !== file.userId) {
        return new Response("Not found", { status: 404 });
      }
    }

    // Cover override — when the creator picked one of their curator
    // photos as the cover, redirect to that photo's signed URL
    // instead of the auto-captured thumbnail. The storage key for
    // photos lives on filePhotos; lookup is gated by fileId match
    // so a leaked photo id from another listing can't be aliased.
    let storageKey = `thumbnails/${fileId}.webp`;
    if (file.coverPhotoId) {
      const [cover] = await db
        .select({
          storageKey: filePhotos.storageKey,
          fileId: filePhotos.fileId,
        })
        .from(filePhotos)
        .where(eq(filePhotos.id, file.coverPhotoId));
      if (cover && cover.fileId === fileId) {
        storageKey = cover.storageKey;
      }
    }

    // Short-lived — 1 hour is plenty for an image that gets loaded
    // and cached by the browser immediately.
    const signed = await generateDownloadUrl(storageKey, 60 * 60);

    return Response.redirect(signed, 302);
  } catch (error) {
    logError("api/thumbnails/[fileId]", error);
    return new Response("Failed to resolve thumbnail", { status: 500 });
  }
}
