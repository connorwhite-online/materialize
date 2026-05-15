import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, filePhotos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Matches a canonical UUID v4 string (case-insensitive).
 * Used to reject malformed fileId segments before they reach the DB —
 * Postgres throws "invalid input syntax for type uuid" for any string
 * that isn't exactly this shape, which was previously surfacing as a
 * 500 + Sentry event (sentry 7484237159).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Redirects to a freshly signed R2 URL for the file's thumbnail. The
 * files.thumbnailUrl column stores `/api/thumbnails/{fileId}` as a
 * stable reference so that browsers get a short-lived presigned URL
 * each time they load the image — working around S3's 7-day
 * max-expiration limit without re-writing the DB row.
 *
 * Two access patterns:
 *   - GET /api/thumbnails/{fileId}                 → the cover
 *     (auto-captured thumbnail by default, or the curator photo
 *     pointed at by files.coverPhotoId when set)
 *   - GET /api/thumbnails/{fileId}?photoId={id}    → a specific
 *     curator photo. Used by card carousels to surface additional
 *     author-uploaded images without pre-signing URLs server-side.
 *     The photoId must belong to this file or the route 404s.
 *
 * Published thumbnails are public (this is how browse/search show
 * previews to anon visitors). For unpublished files (drafts), the
 * thumbnail is gated to the owner so a leaked fileId can't surface
 * work-in-progress artwork.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await context.params;
    if (!fileId) {
      return new Response("Missing fileId", { status: 400 });
    }

    // Guard: reject non-UUID segments before they reach Postgres.
    // Without this check, a malformed id (e.g. a truncated UUID such as
    // "ba14f9ed-106b-46e3-8") causes Postgres to throw
    // "invalid input syntax for type uuid" — previously caught by the
    // outer try-catch and returned as a 500 with a Sentry event fired.
    if (!UUID_RE.test(fileId)) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    const requestedPhotoId = url.searchParams.get("photoId");

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

    const isDraft = file.status !== "published";
    if (isDraft) {
      const { userId } = await auth();
      if (!userId || userId !== file.userId) {
        return new Response("Not found", { status: 404 });
      }
    }

    let storageKey = `thumbnails/${fileId}.webp`;

    // Specific photo requested — verify it belongs to this file and
    // redirect to its storage key.
    if (requestedPhotoId) {
      const [photo] = await db
        .select({
          storageKey: filePhotos.storageKey,
          fileId: filePhotos.fileId,
        })
        .from(filePhotos)
        .where(eq(filePhotos.id, requestedPhotoId));
      if (!photo || photo.fileId !== fileId) {
        return new Response("Not found", { status: 404 });
      }
      storageKey = photo.storageKey;
    } else if (file.coverPhotoId) {
      // Default cover — when the creator picked one of their curator
      // photos as the cover, redirect to that photo's signed URL
      // instead of the auto-captured thumbnail.
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

    // Cache the 302 itself so repeat navigations don't re-pay the DB
    // lookup + signing on every paint. Window is well below the signed
    // URL's 1h lifetime so we never serve an expired Location. Drafts
    // use `private` so a CDN can't fan the redirect out to non-owners.
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": isDraft
          ? "private, max-age=60"
          : "public, max-age=300",
      },
    });
  } catch (error) {
    logError("api/thumbnails/[fileId]", error);
    return new Response("Failed to resolve thumbnail", { status: 500 });
  }
}
