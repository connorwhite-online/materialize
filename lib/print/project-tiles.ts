import { db } from "@/lib/db";
import { files, fileAssets, projects, projectFiles } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { withDbRetry } from "@/lib/db/retry";
import { isOrgMember } from "@/lib/authorization";
import type { LibraryTile } from "./library-tiles";

export interface ProjectPrintContext {
  projectName: string;
  projectSlug: string;
  /** Bundled files, in project order, that the viewer may print. */
  tiles: LibraryTile[];
}

/**
 * Loads the print-hub tiles for a project's bundled files — the data
 * behind the "Print this project" button. Each tile resolves to a
 * primary file asset so the print hub can link straight into the
 * per-file QuoteConfigurator (`/print/[fileAssetId]`), exactly like
 * the personal-library grid does.
 *
 * Returns null when the project doesn't exist or the viewer isn't
 * allowed to see it (so the caller can fall back to the normal print
 * page rather than leaking a draft/private project's existence). The
 * visibility gate mirrors the project detail page: owners (creator or
 * org member) see everything; everyone else only the published-public
 * form.
 *
 * Files are filtered to what the viewer may actually print — owners get
 * every bundled file, non-owners only published listings. Ordering
 * follows `projectFiles.position` so the hub matches the project page's
 * "Files" tab.
 */
export async function loadProjectPrintTiles(
  slug: string,
  userId: string | null
): Promise<ProjectPrintContext | null> {
  return withDbRetry(() => loadProjectPrintTilesOnce(slug, userId), {
    retries: 1,
  });
}

async function loadProjectPrintTilesOnce(
  slug: string,
  userId: string | null
): Promise<ProjectPrintContext | null> {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      status: projects.status,
      visibility: projects.visibility,
      userId: projects.userId,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.slug, slug));

  if (!project) return null;

  const isOwner =
    !!userId &&
    (project.userId === userId ||
      (project.organizationId !== null &&
        (await isOrgMember(userId, project.organizationId)).member));

  if (
    !isOwner &&
    (project.status !== "published" || project.visibility !== "public")
  ) {
    return null;
  }

  const bundled = await db
    .select({
      id: files.id,
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
      status: files.status,
      position: projectFiles.position,
    })
    .from(projectFiles)
    .innerJoin(files, eq(projectFiles.fileId, files.id))
    .where(eq(projectFiles.projectId, project.id))
    .orderBy(asc(projectFiles.position));

  // Non-owners can only print published listings — a draft bundled
  // into an otherwise-public project stays hidden from the hub (and
  // `addToCart` would reject it server-side anyway via
  // userCanPrintAsset). Owners print everything.
  const printable = isOwner
    ? bundled
    : bundled.filter((f) => f.status === "published");

  const fileIds = printable.map((f) => f.id);
  if (fileIds.length === 0) {
    return { projectName: project.name, projectSlug: project.slug, tiles: [] };
  }

  // Primary asset per file = first by createdAt, mirroring
  // loadLibraryTiles and the project detail page's asset pick.
  const assetRows = await db
    .select({
      id: fileAssets.id,
      fileId: fileAssets.fileId,
      format: fileAssets.format,
      createdAt: fileAssets.createdAt,
    })
    .from(fileAssets)
    .where(inArray(fileAssets.fileId, fileIds))
    .orderBy(asc(fileAssets.createdAt));

  const primaryByFileId = new Map<string, { id: string; format: string }>();
  for (const row of assetRows) {
    if (!row.fileId || primaryByFileId.has(row.fileId)) continue;
    primaryByFileId.set(row.fileId, { id: row.id, format: row.format });
  }

  // Preserve project order — iterate `printable` (position-sorted), not
  // the asset rows (createdAt-sorted).
  const tiles: LibraryTile[] = [];
  for (const f of printable) {
    const asset = primaryByFileId.get(f.id);
    if (!asset) continue;
    tiles.push({
      fileAssetId: asset.id,
      name: f.name,
      thumbnailUrl: f.thumbnailUrl,
      format: asset.format,
      source: "owned",
    });
  }

  return { projectName: project.name, projectSlug: project.slug, tiles };
}
