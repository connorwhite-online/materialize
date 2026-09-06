import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projects, projectPhotos } from "@/lib/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { isProjectListedToOthers } from "@/lib/projects/listed";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { canWriteProject } from "@/lib/authorization";
import {
  thumbnailPlaceholderResponse,
  resolveSafeImageContentType,
} from "../../placeholder";

/** Same guard as in /api/thumbnails/[fileId]/route.ts — see that file for rationale. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Streams the bytes of a project's thumbnail (after signing a
 * short-lived R2 URL server-side). Mirrors /api/thumbnails/[fileId]
 * but joined against projectPhotos for the cover override.
 *
 * Streaming, rather than 302ing to the signed URL, is what makes
 * the route consumable by next/image's optimizer — the optimizer
 * does not follow redirects and 400s on them. See the matching
 * comment in /api/thumbnails/[fileId]/route.ts for the longer
 * rationale.
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
    if (!projectId || !UUID_RE.test(projectId)) {
      return new Response("Invalid projectId", { status: 400 });
    }

    // Reject non-UUID segments before they reach Postgres (same pattern
    // as /api/thumbnails/[fileId]/route.ts — sentry 7484237159).
    if (!UUID_RE.test(projectId)) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    const requestedPhotoId = url.searchParams.get("photoId");
    if (requestedPhotoId && !UUID_RE.test(requestedPhotoId)) {
      return new Response("Invalid photoId", { status: 400 });
    }

    const [project] = await db
      .select({
        id: projects.id,
        thumbnailUrl: projects.thumbnailUrl,
        status: projects.status,
        visibility: projects.visibility,
        fileCount: sql<number>`cast((
          select count(*) from project_files pf
          where pf.project_id = ${projects.id}
        ) as int)`,
        userId: projects.userId,
        coverPhotoId: projects.coverPhotoId,
      })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      // Missing/deleted project: empty-tile placeholder, not 404
      // (issue #63 — keeps the browse grid free of network failures).
      return thumbnailPlaceholderResponse();
    }

    const publicListing = isProjectListedToOthers({
      status: project.status,
      visibility: project.visibility,
      fileCount: project.fileCount,
    });
    if (!publicListing) {
      const { userId } = await auth();
      if (!userId || !(await canWriteProject(userId, project.id)).ok) {
        // Don't leak a draft/private cover to a stolen id — placeholder
        // (reveals nothing) rather than 404, consistent with the file route.
        return thumbnailPlaceholderResponse();
      }
    }

    // Resolve storage key in priority order:
    //   1. explicit ?photoId= request (card carousels)
    //   2. project.coverPhotoId pick from the edit dialog
    //   3. first curator photo ("Auto" cover — what the owner sees
    //      until they pick an explicit one)
    //   4. legacy thumbnail_url storage key
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
        // Stale/foreign ?photoId → empty tile, not a network failure.
        return thumbnailPlaceholderResponse();
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

    // "Auto" fallback — no explicit pick, so use the first curator
    // photo the owner uploaded (sortOrder order). This is what makes
    // a freshly-photographed project show a cover without the owner
    // having to open the edit dialog and choose one. A legacy
    // thumbnail_url (if any) still wins below only when there are no
    // curator photos at all.
    if (!storageKey && !requestedPhotoId) {
      const [firstPhoto] = await db
        .select({ storageKey: projectPhotos.storageKey })
        .from(projectPhotos)
        .where(
          and(
            eq(projectPhotos.projectId, projectId),
            eq(projectPhotos.kind, "creator")
          )
        )
        .orderBy(asc(projectPhotos.sortOrder))
        .limit(1);
      if (firstPhoto) storageKey = firstPhoto.storageKey;
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
      // No cover, no curator photos, no legacy thumbnail key — there's
      // nothing to serve (a project carousel requests the bare cover
      // even when only build-guide photos exist). Empty tile, not 404.
      return thumbnailPlaceholderResponse();
    }

    const signed = await generateDownloadUrl(storageKey, 60 * 60);

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
    // Recorded storage key, missing R2 object → empty tile, not 502.
    if (upstream.status === 404) {
      return thumbnailPlaceholderResponse();
    }
    if (!upstream.ok || !upstream.body) {
      logError("api/thumbnails/projects/[projectId].upstream", {
        status: upstream.status,
        statusText: upstream.statusText,
        projectId,
        storageKey,
      });
      return new Response("Upstream fetch failed", { status: 502 });
    }

    // SEC-1 — never echo the uploader's stored Content-Type verbatim;
    // only a fixed raster-image allowlist may pass through same-origin
    // (see resolveSafeImageContentType in ../../placeholder).
    const { contentType, isAttachment } = resolveSafeImageContentType(
      upstream.headers.get("content-type"),
      false
    );
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": publicListing
        ? "public, max-age=300, stale-while-revalidate=600"
        : "private, max-age=60",
    };
    if (isAttachment) {
      headers["Content-Disposition"] = "attachment";
    }
    const upstreamEtag = upstream.headers.get("etag");
    if (upstreamEtag) headers.ETag = upstreamEtag;
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) headers["Content-Length"] = upstreamLength;

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    logError("api/thumbnails/projects/[projectId]", error);
    return new Response("Failed to resolve thumbnail", { status: 500 });
  }
}
