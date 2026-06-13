import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, filePhotos } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Matches a canonical UUID v4 string (case-insensitive).
 * Used to reject malformed fileId/photoId segments before they reach
 * the DB — Postgres throws "invalid input syntax for type uuid" for
 * any string that isn't exactly this shape, which was previously
 * surfacing as a 500 + Sentry event (sentry 7484237159).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the file's thumbnail bytes (streamed through the origin
 * after a server-side fetch of a freshly signed R2 URL). The
 * `files.thumbnailUrl` column stores `/api/thumbnails/{fileId}` as a
 * stable reference so the DB row never has to be re-written when S3's
 * 7-day signing limit elapses. Streaming bytes — rather than 302ing
 * to the signed URL — is what lets next/image's optimizer fetch the
 * source (the optimizer rejects redirect responses as "not a valid
 * image" and silently 400s). The optimizer then caches its AVIF/WebP
 * outputs in `.next/cache/images`, so the cost of streaming through
 * the origin is amortized to roughly "once per optimizer cache
 * lifetime per (fileId × size × format) triple."
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
    // Reject missing / non-UUID segments before they reach Postgres.
    // Without this, a malformed id (e.g. truncated "ba14f9ed-106b-46e3-8")
    // throws "invalid input syntax for type uuid" → 500 + Sentry noise.
    // 404 (not 400) so scrapers can't fingerprint the route.
    if (!fileId || !UUID_RE.test(fileId)) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    const requestedPhotoId = url.searchParams.get("photoId");
    // `?original=1` forces the auto-captured 3D thumbnail regardless
    // of cover_photo_id. Without this escape hatch, /api/thumbnails/{id}
    // always serves the picked cover once one is set, which makes the
    // auto-captured image unreachable — including from the cover
    // picker's "Auto" tile, which then renders the cover photo and
    // visually duplicates the curator tile next to it.
    const forceOriginal = url.searchParams.get("original") === "1";
    if (requestedPhotoId && !UUID_RE.test(requestedPhotoId)) {
      return new Response("Not found", { status: 404 });
    }

    // Single query — leftJoin folds the cover-photo row into the file
    // row for the default path (coverPhotoId set, no ?photoId param).
    // The ?photoId path still needs a second query because the requested
    // photo id is not known until after we read the file row; for the
    // default cover we DO know the id (files.coverPhotoId) at query
    // time, so we can join eagerly. (CON-142)
    const [row] = await db
      .select({
        id: files.id,
        thumbnailUrl: files.thumbnailUrl,
        status: files.status,
        userId: files.userId,
        coverPhotoId: files.coverPhotoId,
        coverStorageKey: filePhotos.storageKey,
      })
      .from(files)
      .leftJoin(filePhotos, eq(filePhotos.id, files.coverPhotoId))
      .where(eq(files.id, fileId));

    if (!row || !row.thumbnailUrl) {
      return new Response("Not found", { status: 404 });
    }

    const isDraft = row.status !== "published";
    if (isDraft) {
      const { userId } = await auth();
      if (!userId || userId !== row.userId) {
        return new Response("Not found", { status: 404 });
      }
    }

    let storageKey = `thumbnails/${fileId}.webp`;

    // Specific photo requested — verify it belongs to this file.
    // `forceOriginal` wins over both requestedPhotoId and coverPhotoId.
    if (forceOriginal) {
      // storageKey already set to the auto-captured path above; skip
      // both branches below.
    } else if (requestedPhotoId) {
      // ?photoId variant: the photo id came from the query string, so we
      // couldn't join eagerly — second query here only on this path.
      const [photo] = await db
        .select({
          storageKey: filePhotos.storageKey,
          fileId: filePhotos.fileId,
        })
        .from(filePhotos)
        .where(and(eq(filePhotos.id, requestedPhotoId), eq(filePhotos.fileId, fileId)));
      if (!photo) {
        return new Response("Not found", { status: 404 });
      }
      storageKey = photo.storageKey;
    } else if (row.coverPhotoId && row.coverStorageKey) {
      // Default cover — the leftJoin already fetched the storageKey;
      // no second query needed.
      storageKey = row.coverStorageKey;
    }

    // Short-lived — we're going to use the URL immediately to fetch
    // the bytes; the client never sees it.
    const signed = await generateDownloadUrl(storageKey, 60 * 60);

    // Stream the R2 bytes back through this origin so next/image's
    // optimizer (which doesn't follow redirects) can consume them.
    // Forwarding If-None-Match would be nice but our signed URLs
    // include unique query strings per call, so ETags from R2 are
    // stable across signings — pass it through when present.
    const upstream = await fetch(signed, {
      headers: {
        ...(request.headers.get("if-none-match")
          ? { "If-None-Match": request.headers.get("if-none-match") as string }
          : {}),
      },
    });

    if (upstream.status === 304) {
      return new Response(null, { status: 304 });
    }
    if (!upstream.ok || !upstream.body) {
      logError("api/thumbnails/[fileId].upstream", {
        status: upstream.status,
        statusText: upstream.statusText,
        fileId,
        storageKey,
      });
      return new Response("Upstream fetch failed", { status: 502 });
    }

    // Preserve the upstream content-type (R2 stores `.webp` thumbnails
    // but curator photos may be jpeg/png/webp). Default to image/webp
    // for the auto-captured path which is always .webp.
    const contentType =
      upstream.headers.get("content-type") ??
      (storageKey.endsWith(".webp") ? "image/webp" : "application/octet-stream");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      // Drafts are owner-gated above so they must not enter shared
      // caches. Published thumbnails are public — let edge + browser
      // hold onto them for a few minutes; the optimizer cache holds
      // them much longer downstream of that.
      "Cache-Control": isDraft
        ? "private, max-age=60"
        : "public, max-age=300, stale-while-revalidate=600",
    };
    const upstreamEtag = upstream.headers.get("etag");
    if (upstreamEtag) headers.ETag = upstreamEtag;
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) headers["Content-Length"] = upstreamLength;

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    logError("api/thumbnails/[fileId]", error);
    return new Response("Failed to resolve thumbnail", { status: 500 });
  }
}
