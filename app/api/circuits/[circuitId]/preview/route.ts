import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projectCircuits, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { canWriteProject } from "@/lib/authorization";
import { logError } from "@/lib/logger";

/**
 * Redirects to a freshly signed R2 URL for a circuit's preview image
 * — same indirection pattern as /api/thumbnails/[fileId]. The page
 * embeds `<img src="/api/circuits/{id}/preview">` and the browser
 * gets a short-lived signed URL on each load, so the public listing
 * doesn't depend on long-lived S3 URLs.
 *
 * Visibility mirrors the project: the preview is public if the
 * project is `published` AND `visibility = 'public'`; otherwise the
 * read set mirrors the write set — owner, org members, and
 * per-project collaborators (see `canWriteProject`) — matching
 * /api/circuits/[circuitId]/source/route.ts. Keeps draft / private
 * circuit diagrams from leaking via a stolen circuitId.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ circuitId: string }> }
) {
  try {
    const { circuitId } = await context.params;
    if (!circuitId) {
      return new Response("Missing circuitId", { status: 400 });
    }

    const [row] = await db
      .select({
        previewStorageKey: projectCircuits.previewStorageKey,
        projectId: projects.id,
        projectStatus: projects.status,
        projectVisibility: projects.visibility,
        projectUserId: projects.userId,
      })
      .from(projectCircuits)
      .innerJoin(projects, eq(projectCircuits.projectId, projects.id))
      .where(eq(projectCircuits.id, circuitId));

    if (!row || !row.previewStorageKey) {
      return new Response("Not found", { status: 404 });
    }

    const publicProject =
      row.projectStatus === "published" &&
      row.projectVisibility === "public";
    if (!publicProject) {
      const { userId } = await auth();
      if (!userId || !(await canWriteProject(userId, row.projectId)).ok) {
        return new Response("Not found", { status: 404 });
      }
    }

    const signed = await generateDownloadUrl(row.previewStorageKey, 60 * 60);

    // Cache the 302 itself so repeat paints (carousels, in-list
    // previews) don't re-pay the DB lookup + signing on every render.
    // Window is well below the signed URL's 1h lifetime. Non-public
    // projects use `private` so a CDN can't fan it out to non-owners.
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": publicProject
          ? "public, max-age=300"
          : "private, max-age=60",
      },
    });
  } catch (error) {
    logError("api/circuits/[circuitId]/preview", error);
    return new Response("Failed to resolve preview", { status: 500 });
  }
}
