import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projectCircuits, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Stream the raw source bytes of a circuit asset (KiCad schematic /
 * PCB / project, Fritzing .fzz, Gerber zip — anything stored in
 * `source_storage_key`).
 *
 * Returns the bytes through OUR origin instead of redirecting to a
 * signed R2 URL because KiCanvas (the in-browser KiCad renderer)
 * does an XHR to load the file and a cross-origin redirect target
 * fails CORS unless R2 is explicitly configured for it. Streaming
 * through here is one extra hop but bytes are small (KiCad source
 * is typically tens of KB) and we avoid having to publish a CORS
 * policy on the bucket.
 *
 * Visibility mirrors the project — public when published+public,
 * else owner-only.
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
        sourceStorageKey: projectCircuits.sourceStorageKey,
        originalFilename: projectCircuits.originalFilename,
        projectStatus: projects.status,
        projectVisibility: projects.visibility,
        projectUserId: projects.userId,
      })
      .from(projectCircuits)
      .innerJoin(projects, eq(projectCircuits.projectId, projects.id))
      .where(eq(projectCircuits.id, circuitId));

    if (!row || !row.sourceStorageKey) {
      return new Response("Not found", { status: 404 });
    }

    const publicProject =
      row.projectStatus === "published" &&
      row.projectVisibility === "public";
    if (!publicProject) {
      const { userId } = await auth();
      if (!userId || userId !== row.projectUserId) {
        return new Response("Not found", { status: 404 });
      }
    }

    const signed = await generateDownloadUrl(row.sourceStorageKey, 60 * 5);
    const upstream = await fetch(signed);
    if (!upstream.ok || !upstream.body) {
      return new Response("Failed to fetch source", { status: 502 });
    }

    const filename = row.originalFilename || "circuit.bin";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        // octet-stream so the browser doesn't try to render the file;
        // KiCanvas reads the bytes regardless of declared MIME.
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `inline; filename="${filename.replace(
          /["\\]/g,
          ""
        )}"`,
        // Same-origin lets KiCanvas's fetch succeed without R2 CORS.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    logError("api/circuits/[circuitId]/source", error);
    return new Response("Failed to resolve source", { status: 500 });
  }
}
