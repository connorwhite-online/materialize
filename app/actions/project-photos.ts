"use server";

/**
 * Project-side photo actions — mirrors app/actions/photos.ts onto
 * the projects table. Same R2 prefix (`photos/<userId>/...`), same
 * caption rules, same 'creator' / 'build' / 'inline' kind taxonomy.
 *
 * One intentional divergence from the file side: project "builds"
 * don't fire a notification yet. Adding a `build_on_project` event
 * type alongside `build_on_file` would be the natural extension
 * when project-build activity is worth surfacing in the inbox.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projectPhotos, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteObject } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { userOwnsProject } from "@/lib/entitlement";
import { canWriteProject } from "@/lib/authorization";

const MAX_CAPTION_LENGTH = 500;

function checkStorageKey(userId: string, key: unknown): string | null {
  if (typeof key !== "string") return "Invalid storage key";
  if (!key.startsWith(`photos/${userId}/`)) return "Invalid storage key";
  return null;
}

/**
 * Add a curator-gallery photo to a project. Owner-only — used by the
 * PhotoUploader on the project detail page.
 */
export async function addProjectPhoto(params: {
  projectId: string;
  storageKey: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const keyError = checkStorageKey(userId, params.storageKey);
    if (keyError) return { error: keyError };

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

    // Owner, org member, or collaborator may add curator photos —
    // same write gate as addProjectGuideImage / BOM / circuits. The
    // direct owner-only check here locked org co-owners + collaborators
    // out of the project's own gallery.
    const access = await canWriteProject(userId, params.projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    const existing = await db
      .select({ sortOrder: projectPhotos.sortOrder })
      .from(projectPhotos)
      .where(eq(projectPhotos.projectId, params.projectId));
    const maxOrder = existing.reduce(
      (max, e) => Math.max(max, e.sortOrder),
      -1
    );

    const [photo] = await db
      .insert(projectPhotos)
      .values({
        projectId: params.projectId,
        userId,
        storageKey: params.storageKey,
        caption: trimmedCaption || null,
        sortOrder: maxOrder + 1,
        kind: "creator",
      })
      .returning();

    revalidatePath(`/projects/${project.slug}`);
    return { photoId: photo.id };
  } catch (error) {
    logError("addProjectPhoto", error);
    return { error: "Failed to add photo" };
  }
}

/**
 * Add a community "build" photo to a project. Gated to the project's
 * owner plus anyone with a completed purchase of the project. Free
 * projects: every signed-in user qualifies (userOwnsProject returns
 * true for free projects), which is the same shape the build gate
 * takes for free files.
 */
export async function addProjectBuild(params: {
  projectId: string;
  storageKey: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to share a photo" };

    const keyError = checkStorageKey(userId, params.storageKey);
    if (keyError) return { error: keyError };

    const [project] = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        ownerId: projects.userId,
      })
      .from(projects)
      .where(eq(projects.id, params.projectId));
    if (!project) return { error: "Project not found" };

    const ok = await userOwnsProject(userId, project.id);
    if (!ok) {
      return {
        error: "Purchase or own this project first to share a photo of it.",
      };
    }

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

    const [photo] = await db
      .insert(projectPhotos)
      .values({
        projectId: project.id,
        userId,
        storageKey: params.storageKey,
        caption: trimmedCaption || null,
        // Builds don't compete with curator photos for sortOrder; the
        // listing query orders by createdAt asc when interleaving
        // with comments, so any value here is fine.
        sortOrder: 0,
        kind: "build",
      })
      .returning();

    revalidatePath(`/projects/${project.slug}`);
    return { photoId: photo.id };
  } catch (error) {
    logError("addProjectBuild", error);
    return { error: "Failed to share build" };
  }
}

/**
 * Upload an image referenced inline by a project comment body. Same
 * gates as `addProjectBuild` (project owner or buyer) but writes
 * `kind = 'inline'` so the row stays out of the builds feed — the
 * image surfaces only via the comment's `![](url)` markdown.
 *
 * No notification — the postComment that follows raises its own
 * comment notification.
 */
export async function addInlineProjectCommentPhoto(params: {
  projectId: string;
  storageKey: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to attach a photo" };

    const keyError = checkStorageKey(userId, params.storageKey);
    if (keyError) return { error: keyError };

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, params.projectId));
    if (!project) return { error: "Project not found" };

    const ok = await userOwnsProject(userId, project.id);
    if (!ok) {
      return {
        error: "Purchase or own this project first to attach a photo.",
      };
    }

    const [photo] = await db
      .insert(projectPhotos)
      .values({
        projectId: project.id,
        userId,
        storageKey: params.storageKey,
        caption: null,
        sortOrder: 0,
        kind: "inline",
      })
      .returning();

    return { photoId: photo.id };
  } catch (error) {
    logError("addInlineProjectCommentPhoto", error);
    return { error: "Failed to attach photo" };
  }
}

/**
 * Upload an image referenced inline by a project's build guide. Owner-
 * only (the guide is owner-authored, unlike comment photos which buyers
 * can also attach). Writes `kind = 'inline'` so the image stays out of
 * the curator gallery and builds feed — it surfaces only via the
 * guide's `![](url)` markdown. Returns the photoId so the editor can
 * splice the `/api/thumbnails/projects/{id}?photoId=` URL into the
 * markdown body.
 */
export async function addProjectGuideImage(params: {
  projectId: string;
  storageKey: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const keyError = checkStorageKey(userId, params.storageKey);
    if (keyError) return { error: keyError };

    // Same write gate as updateProjectBuildGuide — owner, org member,
    // or collaborator. A guide author must be able to upload the images
    // they reference in it.
    const access = await canWriteProject(userId, params.projectId);
    if (!access.ok) return { error: "Project not found" };

    const [photo] = await db
      .insert(projectPhotos)
      .values({
        projectId: params.projectId,
        userId,
        storageKey: params.storageKey,
        caption: null,
        sortOrder: 0,
        kind: "inline",
      })
      .returning();

    return { photoId: photo.id };
  } catch (error) {
    logError("addProjectGuideImage", error);
    return { error: "Failed to upload image" };
  }
}

export async function deleteProjectPhoto(photoId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [photo] = await db
      .select({
        id: projectPhotos.id,
        storageKey: projectPhotos.storageKey,
        projectId: projectPhotos.projectId,
        authorId: projectPhotos.userId,
        projectUserId: projects.userId,
        projectSlug: projects.slug,
      })
      .from(projectPhotos)
      .innerJoin(projects, eq(projectPhotos.projectId, projects.id))
      .where(eq(projectPhotos.id, photoId));

    if (!photo) return { error: "Photo not found" };
    // The photo's author OR anyone who can write the project (owner,
    // org member, collaborator) may delete it. Owner-only locked org
    // co-owners + collaborators out of moderating the gallery.
    if (photo.authorId !== userId) {
      const access = await canWriteProject(userId, photo.projectId);
      if (!access.ok) return { error: "Photo not found" };
    }

    try {
      await deleteObject(photo.storageKey);
    } catch (e) {
      // R2 hiccup shouldn't strand the DB row — best-effort.
      logError("deleteProjectPhoto:storage", e);
    }

    await db.delete(projectPhotos).where(eq(projectPhotos.id, photoId));

    revalidatePath(`/projects/${photo.projectSlug}`);
    return { success: true };
  } catch (error) {
    logError("deleteProjectPhoto", error);
    return { error: "Failed to delete photo" };
  }
}

export async function updateProjectPhotoCaption(
  photoId: string,
  caption: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    if (typeof caption !== "string") {
      return { error: "Invalid caption" };
    }
    const trimmed = caption.trim().slice(0, MAX_CAPTION_LENGTH);

    const [photo] = await db
      .select({
        id: projectPhotos.id,
        authorId: projectPhotos.userId,
        projectId: projectPhotos.projectId,
        projectSlug: projects.slug,
      })
      .from(projectPhotos)
      .innerJoin(projects, eq(projectPhotos.projectId, projects.id))
      .where(eq(projectPhotos.id, photoId));

    if (!photo) return { error: "Photo not found" };
    // Author OR project-writer may edit — mirrors deleteProjectPhoto and
    // the file-photo fix (CON-84). Was owner-only, so build/guide photo
    // authors couldn't fix their own caption and org co-owners /
    // collaborators couldn't edit at all.
    if (photo.authorId !== userId) {
      const access = await canWriteProject(userId, photo.projectId);
      if (!access.ok) return { error: "Photo not found" };
    }

    await db
      .update(projectPhotos)
      .set({ caption: trimmed || null })
      .where(eq(projectPhotos.id, photoId));

    // Captions render on the project page (SSR) — revalidate so the
    // edit shows without a manual refresh.
    revalidatePath(`/projects/${photo.projectSlug}`);
    return { success: true };
  } catch (error) {
    logError("updateProjectPhotoCaption", error);
    return { error: "Failed to update caption" };
  }
}

/**
 * Pick a curator photo as the project's cover. Pass `null` to revert
 * to the legacy `thumbnail_url` value. Owner-only. The thumbnail
 * route JOINs to the picked row and serves a fresh signed URL on
 * each request — no need to copy bytes.
 */
export async function setProjectCoverPhoto(
  projectId: string,
  photoId: string | null
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project) return { error: "Project not found" };

    if (photoId !== null) {
      // Validate the photo exists, belongs to this project, and is a
      // curator photo. Pointing the cover at a make or inline row is
      // technically valid but would let a buyer's photo replace the
      // creator's chosen cover — that's a moderation foot-gun.
      const [photo] = await db
        .select({
          id: projectPhotos.id,
          projectId: projectPhotos.projectId,
          kind: projectPhotos.kind,
        })
        .from(projectPhotos)
        .where(eq(projectPhotos.id, photoId));
      if (
        !photo ||
        photo.projectId !== projectId ||
        photo.kind !== "creator"
      ) {
        return { error: "Invalid cover photo" };
      }
    }

    await db
      .update(projects)
      .set({ coverPhotoId: photoId })
      .where(eq(projects.id, projectId));

    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("setProjectCoverPhoto", error);
    return { error: "Failed to update cover" };
  }
}
