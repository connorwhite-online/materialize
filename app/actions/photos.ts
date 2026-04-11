"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { filePhotos, files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteObject } from "@/lib/storage";
import { logError } from "@/lib/logger";

export async function addFilePhoto(params: {
  fileId: string;
  storageKey: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

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
        caption: params.caption,
        sortOrder: maxOrder + 1,
      })
      .returning();

    revalidatePath(`/files/${file.slug}`);
    return { photoId: photo.id };
  } catch (error) {
    logError("addFilePhoto", error);
    return { error: "Failed to add photo" };
  }
}

export async function deleteFilePhoto(photoId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Get photo and verify ownership
    const [photo] = await db
      .select({
        id: filePhotos.id,
        storageKey: filePhotos.storageKey,
        fileId: filePhotos.fileId,
        fileUserId: files.userId,
        fileSlug: files.slug,
      })
      .from(filePhotos)
      .innerJoin(files, eq(filePhotos.fileId, files.id))
      .where(eq(filePhotos.id, photoId));

    if (!photo || photo.fileUserId !== userId) {
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
      .set({ caption })
      .where(eq(filePhotos.id, photoId));

    return { success: true };
  } catch (error) {
    logError("updatePhotoCaption", error);
    return { error: "Failed to update caption" };
  }
}
