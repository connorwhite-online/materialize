"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { filePhotos, files, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteObject } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { userHasUsedFile } from "@/lib/entitlement";
import { notifyMakeOnFile } from "@/lib/notifications/notify";
import { makeSnippet } from "@/lib/notifications/types";

const MAX_CAPTION_LENGTH = 500;

/**
 * Add a curator gallery photo. File-owner-only — used by the existing
 * PhotoUploader on the file detail page. The community-makes counterpart
 * is `addFileMake` below; same R2 prefix, same caption rules, but a
 * different ownership check and a different `kind`.
 */
export async function addFilePhoto(params: {
  fileId: string;
  storageKey: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Reject any storageKey that isn't rooted at this user's photo
    // prefix. The photo-presign route always emits `photos/<userId>/`
    // — anything else is either spoofed (caller crafted a key for
    // another user's R2 path) or a stale model-upload key being
    // recycled. Both cases must not become a photo row.
    const expectedPrefix = `photos/${userId}/`;
    if (
      typeof params.storageKey !== "string" ||
      !params.storageKey.startsWith(expectedPrefix)
    ) {
      return { error: "Invalid storage key" };
    }

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

    // Verify user owns the file
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, params.fileId), eq(files.userId, userId)));

    if (!file) return { error: "File not found" };

    // Get max sort order
    const existing = await db
      .select({ sortOrder: filePhotos.sortOrder })
      .from(filePhotos)
      .where(eq(filePhotos.fileId, params.fileId));

    const maxOrder = existing.reduce((max, e) => Math.max(max, e.sortOrder), -1);

    const [photo] = await db
      .insert(filePhotos)
      .values({
        fileId: params.fileId,
        userId,
        storageKey: params.storageKey,
        caption: trimmedCaption || null,
        sortOrder: maxOrder + 1,
        kind: "creator",
      })
      .returning();

    revalidatePath(`/files/${file.slug}`);
    return { photoId: photo.id };
  } catch (error) {
    logError("addFilePhoto", error);
    return { error: "Failed to add photo" };
  }
}

/**
 * Add a community "make" photo. Gated to users who have actually used
 * the file (downloaded OR printed in a non-failure status). The file
 * owner can also post — they're a "user" too, just with their own copy.
 *
 * Same R2 prefix as creator photos (`photos/<userId>/...`) so cleanup
 * stays uniform; the row's `kind = 'make'` is what separates this from
 * the curator gallery.
 */
export async function addFileMake(params: {
  fileId: string;
  storageKey: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to share a photo" };

    const expectedPrefix = `photos/${userId}/`;
    if (
      typeof params.storageKey !== "string" ||
      !params.storageKey.startsWith(expectedPrefix)
    ) {
      return { error: "Invalid storage key" };
    }

    // Verify the file exists. We deliberately don't gate on owner here
    // — owners aren't the typical poster, but they can also share a
    // make of their own work without restriction.
    const [file] = await db
      .select({
        id: files.id,
        slug: files.slug,
        name: files.name,
        ownerId: files.userId,
      })
      .from(files)
      .where(eq(files.id, params.fileId));
    if (!file) return { error: "File not found" };

    // The download-or-print gate — central rule for who can post a make.
    const ok = await userHasUsedFile(userId, file.id);
    if (!ok) {
      return {
        error:
          "Print or download this file first to share a photo of it.",
      };
    }

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

    const [photo] = await db
      .insert(filePhotos)
      .values({
        fileId: file.id,
        userId,
        storageKey: params.storageKey,
        caption: trimmedCaption || null,
        // Makes don't compete with curator photos for sortOrder; the
        // listing query orders by createdAt descending, so any value
        // here is fine.
        sortOrder: 0,
        kind: "make",
      })
      .returning();

    // Notify the file owner that someone posted a make of their work.
    // Self-events (owner posts their own make) are skipped inside the
    // notify helper. Pull the actor's identity inline since the make
    // table doesn't carry user fields.
    const [actor] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (actor) {
      await notifyMakeOnFile(file.ownerId, {
        actor,
        listing: { kind: "file", name: file.name, slug: file.slug },
        makeId: photo.id,
        snippet: trimmedCaption ? makeSnippet(trimmedCaption) : null,
      });
    }

    revalidatePath(`/files/${file.slug}`);
    return { photoId: photo.id };
  } catch (error) {
    logError("addFileMake", error);
    return { error: "Failed to share make" };
  }
}

/**
 * Upload an image referenced inline by a comment body. Same gates as
 * `addFileMake` (signed-in viewer who has actually used the file)
 * but writes `kind = 'inline'` so the row stays out of the legacy
 * "makes" feed — the image surfaces only via the comment's
 * `![](/api/thumbnails/...?photoId=...)` markdown.
 *
 * Notification deliberately not fired here — the postComment that
 * follows raises its own comment notification; firing both would
 * double-ping the file owner for one post.
 */
export async function addInlineCommentPhoto(params: {
  fileId: string;
  storageKey: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to attach a photo" };

    const expectedPrefix = `photos/${userId}/`;
    if (
      typeof params.storageKey !== "string" ||
      !params.storageKey.startsWith(expectedPrefix)
    ) {
      return { error: "Invalid storage key" };
    }

    const [file] = await db
      .select({ id: files.id, slug: files.slug })
      .from(files)
      .where(eq(files.id, params.fileId));
    if (!file) return { error: "File not found" };

    const ok = await userHasUsedFile(userId, file.id);
    if (!ok) {
      return {
        error:
          "Print or download this file first to attach a photo.",
      };
    }

    const [photo] = await db
      .insert(filePhotos)
      .values({
        fileId: file.id,
        userId,
        storageKey: params.storageKey,
        caption: null,
        sortOrder: 0,
        kind: "inline",
      })
      .returning();

    return { photoId: photo.id };
  } catch (error) {
    logError("addInlineCommentPhoto", error);
    return { error: "Failed to attach photo" };
  }
}

/**
 * Delete a photo (creator or make). The author can always remove their
 * own; the file owner can additionally remove any photo on their file
 * (moderation against off-topic makes).
 */
export async function deleteFilePhoto(photoId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [photo] = await db
      .select({
        id: filePhotos.id,
        storageKey: filePhotos.storageKey,
        fileId: filePhotos.fileId,
        authorId: filePhotos.userId,
        fileUserId: files.userId,
        fileSlug: files.slug,
      })
      .from(filePhotos)
      .innerJoin(files, eq(filePhotos.fileId, files.id))
      .where(eq(filePhotos.id, photoId));

    if (
      !photo ||
      (photo.authorId !== userId && photo.fileUserId !== userId)
    ) {
      return { error: "Photo not found" };
    }

    // Delete from storage
    await deleteObject(photo.storageKey);

    // Delete from DB
    await db.delete(filePhotos).where(eq(filePhotos.id, photoId));

    revalidatePath(`/files/${photo.fileSlug}`);
    return { success: true };
  } catch (error) {
    logError("deleteFilePhoto", error);
    return { error: "Failed to delete photo" };
  }
}

export async function updatePhotoCaption(photoId: string, caption: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    if (typeof caption !== "string") {
      return { error: "Invalid caption" };
    }
    const trimmed = caption.trim().slice(0, MAX_CAPTION_LENGTH);

    // Verify ownership via file
    const [photo] = await db
      .select({
        id: filePhotos.id,
        fileUserId: files.userId,
      })
      .from(filePhotos)
      .innerJoin(files, eq(filePhotos.fileId, files.id))
      .where(eq(filePhotos.id, photoId));

    if (!photo || photo.fileUserId !== userId) {
      return { error: "Photo not found" };
    }

    await db
      .update(filePhotos)
      .set({ caption: trimmed || null })
      .where(eq(filePhotos.id, photoId));

    return { success: true };
  } catch (error) {
    logError("updatePhotoCaption", error);
    return { error: "Failed to update caption" };
  }
}
