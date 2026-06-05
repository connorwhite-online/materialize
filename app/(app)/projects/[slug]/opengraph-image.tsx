import { db } from "@/lib/db";
import {
  projects,
  projectPhotos,
  projectFiles,
  files,
  users,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";

export const alt = "Materialize project";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      thumbnailUrl: projects.thumbnailUrl,
      coverPhotoId: projects.coverPhotoId,
      status: projects.status,
      visibility: projects.visibility,
      displayName: users.displayName,
      username: users.username,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  if (!row || row.status !== "published" || row.visibility !== "public") {
    return renderOgCard({ title: "Materialize", subtitle: null });
  }

  // Resolve the cover to an absolute, fetchable URL for the card —
  // same priority order as the /api/thumbnails/projects route (the OG
  // renderer can't call that proxy, so we sign the R2 key directly):
  //   1. explicit coverPhotoId pick
  //   2. first curator photo ("Auto" cover)
  //   3. legacy thumbnailUrl (full URL, or a storage key we sign)
  //   4. first bundled file's thumbnail
  let coverKey: string | null = null;
  if (row.coverPhotoId) {
    const [cover] = await db
      .select({
        storageKey: projectPhotos.storageKey,
        projectId: projectPhotos.projectId,
      })
      .from(projectPhotos)
      .where(eq(projectPhotos.id, row.coverPhotoId));
    if (cover && cover.projectId === row.id) coverKey = cover.storageKey;
  }
  if (!coverKey) {
    const [first] = await db
      .select({ storageKey: projectPhotos.storageKey })
      .from(projectPhotos)
      .where(
        and(
          eq(projectPhotos.projectId, row.id),
          eq(projectPhotos.kind, "creator")
        )
      )
      .orderBy(asc(projectPhotos.sortOrder))
      .limit(1);
    if (first) coverKey = first.storageKey;
  }

  let imageUrl: string | null = null;
  if (coverKey) {
    imageUrl = await generateDownloadUrl(coverKey, 3600);
  } else if (row.thumbnailUrl) {
    imageUrl =
      row.thumbnailUrl.startsWith("http://") ||
      row.thumbnailUrl.startsWith("https://")
        ? row.thumbnailUrl
        : await generateDownloadUrl(row.thumbnailUrl, 3600);
  } else {
    const [firstFile] = await db
      .select({ thumbnailUrl: files.thumbnailUrl })
      .from(projectFiles)
      .innerJoin(files, eq(projectFiles.fileId, files.id))
      .where(eq(projectFiles.projectId, row.id))
      .orderBy(asc(projectFiles.position))
      .limit(1);
    if (firstFile?.thumbnailUrl) imageUrl = firstFile.thumbnailUrl;
  }

  const creator = row.displayName || row.username;
  return renderOgCard({
    title: row.name,
    subtitle: creator ? `Project by ${creator}` : "Project",
    imageUrl,
  });
}
