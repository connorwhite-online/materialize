import { db } from "@/lib/db";
import { files, fileAssets, projects, projectFiles, projectPhotos, users } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { withDbRetry } from "@/lib/db/retry";
import { isOrgMember } from "@/lib/authorization";
import { generateDownloadUrl } from "@/lib/storage";
import type { LibraryTile } from "./library-tiles";

export interface ProjectPrintContext {
  projectName: string;
  projectSlug: string;
  projectThumbnailUrl: string | null;
  author: { username: string | null; displayName: string | null };
  /** Sum of all bundled asset file sizes in bytes. */
  totalFileSizeBytes: number;
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
      thumbnailUrl: projects.thumbnailUrl,
      coverPhotoId: projects.coverPhotoId,
      authorUsername: users.username,
      authorDisplayName: users.displayName,
    })
    .from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
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
      slug: files.slug,
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
  // Resolve project cover photo using the same priority order as the OG
  // image renderer:
  //   1. Explicit coverPhotoId → get storageKey from projectPhotos → sign
  //   2. First creator-kind photo (auto cover) → storageKey → sign
  //   3. Legacy thumbnailUrl (full URL pass-through or storage key sign)
  //   4. Falls back to first bundled file's thumbnail after tiles are built
  let resolvedThumbnailUrl: string | null = null;
  let coverStorageKey: string | null = null;
  if (project.coverPhotoId) {
    const [cover] = await db
      .select({ storageKey: projectPhotos.storageKey })
      .from(projectPhotos)
      .where(eq(projectPhotos.id, project.coverPhotoId));
    if (cover) coverStorageKey = cover.storageKey;
  }
  if (!coverStorageKey) {
    const [firstPhoto] = await db
      .select({ storageKey: projectPhotos.storageKey })
      .from(projectPhotos)
      .where(
        eq(projectPhotos.projectId, project.id)
      )
      .orderBy(asc(projectPhotos.sortOrder))
      .limit(1);
    if (firstPhoto) coverStorageKey = firstPhoto.storageKey;
  }
  if (coverStorageKey) {
    resolvedThumbnailUrl = await generateDownloadUrl(coverStorageKey, 3600);
  } else if (project.thumbnailUrl) {
    resolvedThumbnailUrl =
      project.thumbnailUrl.startsWith("http://") ||
      project.thumbnailUrl.startsWith("https://")
        ? project.thumbnailUrl
        : await generateDownloadUrl(project.thumbnailUrl, 3600);
  }

  const projectMeta = {
    projectName: project.name,
    projectSlug: project.slug,
    projectThumbnailUrl: resolvedThumbnailUrl,
    author: {
      username: project.authorUsername ?? null,
      displayName: project.authorDisplayName ?? null,
    },
  };

  if (fileIds.length === 0) {
    return { ...projectMeta, totalFileSizeBytes: 0, tiles: [] };
  }

  // Primary asset per file = first by createdAt, mirroring
  // loadLibraryTiles and the project detail page's asset pick.
  const assetRows = await db
    .select({
      id: fileAssets.id,
      fileId: fileAssets.fileId,
      format: fileAssets.format,
      createdAt: fileAssets.createdAt,
      originalFilename: fileAssets.originalFilename,
      fileSize: fileAssets.fileSize,
    })
    .from(fileAssets)
    .where(inArray(fileAssets.fileId, fileIds))
    .orderBy(asc(fileAssets.createdAt));

  const primaryByFileId = new Map<
    string,
    { id: string; format: string; originalFilename: string; fileSize: number }
  >();
  for (const row of assetRows) {
    if (!row.fileId || primaryByFileId.has(row.fileId)) continue;
    primaryByFileId.set(row.fileId, {
      id: row.id,
      format: row.format,
      originalFilename: row.originalFilename,
      fileSize: row.fileSize,
    });
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
      slug: f.slug,
      thumbnailUrl: f.thumbnailUrl,
      format: asset.format,
      source: "owned",
      originalFilename: asset.originalFilename,
      fileSizeBytes: asset.fileSize,
    });
  }

  const totalFileSizeBytes = tiles.reduce(
    (sum, t) => sum + (t.fileSizeBytes ?? 0),
    0
  );

  // Fall back to first file's thumbnail if project has no resolved thumbnail
  const projectThumbnailUrl =
    projectMeta.projectThumbnailUrl ?? tiles[0]?.thumbnailUrl ?? null;

  return {
    ...projectMeta,
    projectThumbnailUrl,
    totalFileSizeBytes,
    tiles,
  };
}
