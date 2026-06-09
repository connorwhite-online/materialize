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

    // Resolve the cover to an absolute, fetchable URL for the card.
    // Try multiple sources with graceful fallbacks to ensure OG generation
    // doesn't fail if any step encounters an error.
    let imageUrl: string | null = null;

    try {
      // 1. Try explicit coverPhotoId pick
      if (row.coverPhotoId) {
        const [cover] = await db
          .select({
            storageKey: projectPhotos.storageKey,
            projectId: projectPhotos.projectId,
          })
          .from(projectPhotos)
          .where(eq(projectPhotos.id, row.coverPhotoId));
        if (cover && cover.projectId === row.id && cover.storageKey) {
          imageUrl = await generateDownloadUrl(cover.storageKey, 3600);
          if (imageUrl) {
            const creator = row.displayName || row.username;
            return renderOgCard({
              title: row.name,
              subtitle: creator ? `Project by ${creator}` : "Project",
              imageUrl,
            });
          }
        }
      }

      // 2. Try first curator photo ("Auto" cover)
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
        imageUrl = await generateDownloadUrl(firstCurator.storageKey, 3600);
        if (imageUrl) {
          const creator = row.displayName || row.username;
          return renderOgCard({
            title: row.name,
            subtitle: creator ? `Project by ${creator}` : "Project",
            imageUrl,
          });
        }
      }
    } catch {
      // Silently fall through to legacy thumbnail if photo resolution fails
    }

    // 3. Try legacy thumbnailUrl
    if (row.thumbnailUrl) {
      if (
        row.thumbnailUrl.startsWith("http://") ||
        row.thumbnailUrl.startsWith("https://")
      ) {
        imageUrl = row.thumbnailUrl;
      } else {
        try {
          imageUrl = await generateDownloadUrl(row.thumbnailUrl, 3600);
        } catch {
          // If signing fails, fall through to bundled files
        }
      }
      if (imageUrl) {
        const creator = row.displayName || row.username;
        return renderOgCard({
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
      // Silently ignore if bundled file fetch fails
    }

    // Render with whatever image we found, or null for a placeholder
    const creator = row.displayName || row.username;
    return renderOgCard({
      title: row.name,
      subtitle: creator ? `Project by ${creator}` : "Project",
      imageUrl,
    });
  } catch {
    // Fallback for any unexpected errors during OG generation
    return renderOgCard({ title: "Materialize", subtitle: null });
  }
}
