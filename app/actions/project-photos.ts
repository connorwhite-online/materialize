"use server";

/**
 * Project-side photo actions — mirrors app/actions/photos.ts onto
 * the projects table. Same R2 prefix (`photos/<userId>/...`), same
 * caption rules, same 'creator' / 'make' / 'inline' kind taxonomy.
 *
 * One intentional divergence from the file side: project "makes"
 * don't fire a notification yet. The deferred event-type rename
 * (make_on_file → make_on_listing) is where that gets unified;
 * notifying on a project-make today would either double the event-
 * type matrix or shoehorn a project listing into the make_on_file
 * payload. Better to wait.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projectPhotos, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteObject } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { userOwnsProject } from "@/lib/entitlement";

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

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, params.projectId), eq(projects.userId, userId)));
    if (!project) return { error: "Project not found" };

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
 * Add a community "make" photo to a project. Gated to the project's
 * owner plus anyone with a completed purchase of the project. Free
 * projects: every signed-in user qualifies (userOwnsProject returns
 * true for free projects), which is the same shape the make gate
 * takes for free files.
 */
export async function addProjectMake(params: {
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
        // Makes don't compete with curator photos for sortOrder; the
        // listing query orders by createdAt asc when interleaving
        // with comments, so any value here is fine.
        sortOrder: 0,
        kind: "make",
      })
      .returning();

    revalidatePath(`/projects/${project.slug}`);
    return { photoId: photo.id };
  } catch (error) {
    logError("addProjectMake", error);
    return { error: "Failed to share make" };
  }
}

/**
 * Upload an image referenced inline by a project comment body. Same
 * gates as `addProjectMake` (project owner or buyer) but writes
 * `kind = 'inline'` so the row stays out of the makes feed — the
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

    if (
      !photo ||
      (photo.authorId !== userId && photo.projectUserId !== userId)
    ) {
      return { error: "Photo not found" };
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
        projectUserId: projects.userId,
      })
      .from(projectPhotos)
      .innerJoin(projects, eq(projectPhotos.projectId, projects.id))
      .where(eq(projectPhotos.id, photoId));

    if (!photo || photo.projectUserId !== userId) {
      return { error: "Photo not found" };
    }

    await db
      .update(projectPhotos)
      .set({ caption: trimmed || null })
      .where(eq(projectPhotos.id, photoId));

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
