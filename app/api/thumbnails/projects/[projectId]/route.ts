import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projects, projectPhotos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/** Same guard as in /api/thumbnails/[fileId]/route.ts — see that file for rationale. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Redirects to a freshly signed R2 URL for a project's thumbnail.
 * Mirrors /api/thumbnails/[fileId] but joined against projectPhotos
 * for the cover override.
 *
 * Access patterns:
 *   - GET /api/thumbnails/projects/{projectId}                 → cover
 *   - GET /api/thumbnails/projects/{projectId}?photoId={id}    → a
 *     specific curator/build photo on the project. Used by card
 *     carousels to surface additional author-uploaded images.
 *
 * Visibility: public when the project is `published` + `public`;
 * owner-only otherwise. Keeps draft / private project covers from
 * leaking via a stolen ID.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    if (!projectId) {
      return new Response("Missing projectId", { status: 400 });
    }

    // Reject non-UUID segments before they reach Postgres (same pattern
    // as /api/thumbnails/[fileId]/route.ts — sentry 7484237159).
    if (!UUID_RE.test(projectId)) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    const requestedPhotoId = url.searchParams.get("photoId");

    const [project] = await db
      .select({
        id: projects.id,
        thumbnailUrl: projects.thumbnailUrl,
        status: projects.status,
        visibility: projects.visibility,
        userId: projects.userId,
        coverPhotoId: projects.coverPhotoId,
      })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      return new Response("Not found", { status: 404 });
    }

    const publicListing =
      project.status === "published" && project.visibility === "public";
    if (!publicListing) {
      const { userId } = await auth();
      if (!userId || userId !== project.userId) {
        return new Response("Not found", { status: 404 });
      }
    }

    // Resolve storage key in priority order:
    //   1. explicit ?photoId= request (card carousels)
    //   2. project.coverPhotoId pick from the edit dialog
    //   3. legacy thumbnail_url storage key
    let storageKey: string | null = null;

    if (requestedPhotoId) {
      const [photo] = await db
        .select({
          storageKey: projectPhotos.storageKey,
          projectId: projectPhotos.projectId,
        })
        .from(projectPhotos)
        .where(eq(projectPhotos.id, requestedPhotoId));
      if (!photo || photo.projectId !== projectId) {
        return new Response("Not found", { status: 404 });
      }
      storageKey = photo.storageKey;
    } else if (project.coverPhotoId) {
      const [cover] = await db
        .select({
          storageKey: projectPhotos.storageKey,
          projectId: projectPhotos.projectId,
        })
        .from(projectPhotos)
        .where(eq(projectPhotos.id, project.coverPhotoId));
      if (cover && cover.projectId === projectId) {
        storageKey = cover.storageKey;
      }
    }

    if (!storageKey) {
      // Fall back to the legacy thumbnail_url. May be a full URL (older
      // rows) or a storage key (newer); only the storage-key path is
      // valid for signing, so we just 404 if it looks like an absolute
      // URL — the cover picker is the supported way to set this now.
      if (
        project.thumbnailUrl &&
        !project.thumbnailUrl.startsWith("http://") &&
        !project.thumbnailUrl.startsWith("https://")
      ) {
        storageKey = project.thumbnailUrl;
      }
    }

    if (!storageKey) {
      return new Response("Not found", { status: 404 });
    }

    const signed = await generateDownloadUrl(storageKey, 60 * 60);

    // Cache the 302 itself so repeat navigations don't re-pay the DB
    // lookup + signing on every paint. Window is well below the signed
    // URL's 1h lifetime. Non-public projects use `private` so a CDN
    // can't fan the redirect out to non-owners.
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": publicListing
          ? "public, max-age=300"
          : "private, max-age=60",
      },
    });
  } catch (error) {
    logError("api/thumbnails/projects/[projectId]", error);
    return new Response("Failed to resolve thumbnail", { status: 500 });
  }
}
