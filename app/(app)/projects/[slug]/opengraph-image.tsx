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
import {
  chooseProjectCard,
  MAX_STACK_TILES,
  type ProjectCardFile,
} from "@/lib/og/project-card";

export const alt = "Materialize project";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Project link previews.
 *
 * A project is a bundle, so its card has three shapes depending on
 * what the author has given it — see `lib/og/project-card.ts` for the
 * decision, which is unit tested:
 *
 *   - **cover art** → full-bleed. Whatever the author picked wins;
 *     nothing derived beats a deliberate choice.
 *   - **exactly one file** → that file's art, full-bleed. A stack of
 *     one reads as a mistake, and the file deserves the frame.
 *   - **two or more files** → the file previews fanned across the
 *     frame, which is the only shape that says "this is a bundle" at
 *     a glance.
 *   - **nothing** → the split card, which at least names the link.
 */
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
      return await renderOgCard({ title: "Materialize", subtitle: null });
    }

    if (!row || row.status !== "published" || row.visibility !== "public") {
      return await renderOgCard({ title: "Materialize", subtitle: null });
    }

    const creator = row.displayName || row.username;
    const subtitle = creator ? `Project by ${creator}` : "Project";

    const coverImageUrl = await resolveProjectCover(row);
    const bundled = coverImageUrl ? [] : await loadBundledFiles(row.id);

    const choice = chooseProjectCard({ coverImageUrl, files: bundled });

    switch (choice.kind) {
      case "cover":
        return await renderOgCard({
          title: row.name || "Project",
          subtitle,
          layout: "full",
          fit: "cover",
          imageUrl: choice.imageUrl,
        });
      case "single":
        return await renderOgCard({
          title: row.name || "Project",
          subtitle,
          layout: "full",
          fit: choice.fit,
          imageUrl: choice.imageUrl,
        });
      case "stack":
        return await renderOgCard({
          title: row.name || "Project",
          subtitle,
          layout: "stack",
          images: choice.imageUrls,
        });
      case "none":
        return await renderOgCard({ title: row.name || "Project", subtitle });
    }
  } catch {
    return await renderOgCard({ title: "Materialize", subtitle: null });
  }
}

/**
 * The project's own cover art: the curator-picked cover, else the
 * first curator photo ("Auto"), else the legacy thumbnail column.
 * Returns a fetchable URL, or null when the project has none.
 */
async function resolveProjectCover(row: {
  id: string;
  coverPhotoId: string | null;
  thumbnailUrl: string | null;
}): Promise<string | null> {
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
        return await generateDownloadUrl(cover.storageKey, 3600);
      }
    } catch {
      // Fall through to the next candidate.
    }
  }

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
      return await generateDownloadUrl(firstCurator.storageKey, 3600);
    }
  } catch {
    // Fall through.
  }

  if (row.thumbnailUrl) {
    try {
      if (
        row.thumbnailUrl.startsWith("http://") ||
        row.thumbnailUrl.startsWith("https://")
      ) {
        return row.thumbnailUrl;
      }
      // A legacy value here is a storage key, not a route path.
      return await generateDownloadUrl(row.thumbnailUrl, 3600);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * The project's bundled files, in display order.
 *
 * `hasCoverPhoto` decides how a single file's art fills the frame:
 * `/api/thumbnails/{fileId}` serves the curator cover when one is set
 * and the auto-captured 3D render otherwise, and those want opposite
 * fits — a photograph should fill, a transparent square capture must
 * not be cropped.
 */
async function loadBundledFiles(
  projectId: string
): Promise<ProjectCardFile[]> {
  try {
    const rows = await db
      .select({
        thumbnailUrl: files.thumbnailUrl,
        coverPhotoId: files.coverPhotoId,
      })
      .from(projectFiles)
      .innerJoin(files, eq(projectFiles.fileId, files.id))
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(asc(projectFiles.position))
      // One more than we can show, so "is there more than one?" stays
      // correct without loading a whole bundle.
      .limit(MAX_STACK_TILES + 1);

    return rows.map((r) => ({
      thumbnailUrl: r.thumbnailUrl,
      hasCoverPhoto: !!r.coverPhotoId,
    }));
  } catch {
    return [];
  }
}
