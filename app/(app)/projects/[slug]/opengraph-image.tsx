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
  try {
    const { slug } = await params;
    let row;
    try {
      const result = await db
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
      row = result[0];
    } catch {
      // If project query fails, return branded card
      return await renderOgCard({ title: "Materialize", subtitle: null });
    }

    if (!row || row.status !== "published" || row.visibility !== "public") {
      return await renderOgCard({ title: "Materialize", subtitle: null });
    }

    let imageUrl: string | null = null;
    const creator = row.displayName || row.username;

    // 1. Try explicit coverPhotoId pick
    if (row.coverPhotoId) {
      try {
        const [cover] = await db
          .select({
            storageKey: projectPhotos.storageKey,
            projectId: projectPhotos.projectId,
          })
          .from(projectPhotos)
          .where(eq(projectPhotos.id, row.coverPhotoId));
        if (cover && cover.projectId === row.id && cover.storageKey) {
          try {
            imageUrl = await generateDownloadUrl(cover.storageKey, 3600);
          } catch {
            imageUrl = null;
          }
          if (imageUrl) {
            return await renderOgCard({
              title: row.name,
              subtitle: creator ? `Project by ${creator}` : "Project",
              imageUrl,
            });
          }
        }
      } catch {
        // Silently fall through
      }
    }

    // 2. Try first curator photo ("Auto" cover)
    try {
      const [firstCurator] = await db
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
      if (firstCurator?.storageKey) {
        try {
          imageUrl = await generateDownloadUrl(firstCurator.storageKey, 3600);
        } catch {
          imageUrl = null;
        }
        if (imageUrl) {
          return await renderOgCard({
            title: row.name,
            subtitle: creator ? `Project by ${creator}` : "Project",
            imageUrl,
          });
        }
      }
    } catch {
      // Silently fall through
    }

    // 3. Try legacy thumbnailUrl
    if (row.thumbnailUrl) {
      try {
        if (
          row.thumbnailUrl.startsWith("http://") ||
          row.thumbnailUrl.startsWith("https://")
        ) {
          imageUrl = row.thumbnailUrl;
        } else {
          imageUrl = await generateDownloadUrl(row.thumbnailUrl, 3600);
        }
      } catch {
        imageUrl = null;
      }
      if (imageUrl) {
        return await renderOgCard({
          title: row.name,
          subtitle: creator ? `Project by ${creator}` : "Project",
          imageUrl,
        });
      }
    }

    // 4. Try first bundled file's thumbnail
    try {
      const [firstFile] = await db
        .select({ thumbnailUrl: files.thumbnailUrl })
        .from(projectFiles)
        .innerJoin(files, eq(projectFiles.fileId, files.id))
        .where(eq(projectFiles.projectId, row.id))
        .orderBy(asc(projectFiles.position))
        .limit(1);
      if (firstFile?.thumbnailUrl) {
        imageUrl = firstFile.thumbnailUrl;
      }
    } catch {
      // Silently ignore
    }

    // Final render with whatever image we found
    return await renderOgCard({
      title: row.name || "Project",
      subtitle: creator ? `Project by ${creator}` : "Project",
      imageUrl: imageUrl || null,
    });
  } catch {
    // Ultimate fallback - just render branded card
    return await renderOgCard({ title: "Materialize", subtitle: null });
  }
}
