"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { collections, collectionFiles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { z } from "zod";
import { logError } from "@/lib/logger";

const collectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val.split(",").map((t) => t.trim()).filter(Boolean)
        : []
    ),
});

export async function createCollection(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = collectionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    tags: formData.get("tags"),
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const slug = `${parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${nanoid(6)}`;

    const [collection] = await db
      .insert(collections)
      .values({
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        tags: parsed.data.tags,
        slug,
      })
      .returning();

    revalidatePath("/dashboard/uploads");
    return { collectionId: collection.id, slug: collection.slug };
  } catch (error) {
    logError("createCollection", error);
    return { error: { name: ["Failed to create collection."] } };
  }
}

export async function addFileToCollection(collectionId: string, fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Verify user owns the collection
    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)));

    if (!collection) return { error: "Collection not found" };

    // Get max sort order
    const existing = await db
      .select({ sortOrder: collectionFiles.sortOrder })
      .from(collectionFiles)
      .where(eq(collectionFiles.collectionId, collectionId));

    const maxOrder = existing.reduce((max, e) => Math.max(max, e.sortOrder), -1);

    await db.insert(collectionFiles).values({
      collectionId,
      fileId,
      sortOrder: maxOrder + 1,
    });

    revalidatePath("/dashboard/uploads");
    return { success: true };
  } catch (error) {
    logError("addFileToCollection", error);
    return { error: "Failed to add file to collection" };
  }
}

export async function removeFileFromCollection(collectionId: string, fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Verify ownership
    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)));

    if (!collection) return { error: "Collection not found" };

    await db
      .delete(collectionFiles)
      .where(
        and(
          eq(collectionFiles.collectionId, collectionId),
          eq(collectionFiles.fileId, fileId)
        )
      );

    revalidatePath("/dashboard/uploads");
    return { success: true };
  } catch (error) {
    logError("removeFileFromCollection", error);
    return { error: "Failed to remove file" };
  }
}

export async function toggleCollectionVisibility(collectionId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)));

    if (!collection) return { error: "Collection not found" };

    const newVisibility = collection.visibility === "public" ? "private" : "public";

    await db
      .update(collections)
      .set({ visibility: newVisibility })
      .where(eq(collections.id, collectionId));

    revalidatePath("/dashboard/uploads");
    return { visibility: newVisibility };
  } catch (error) {
    logError("toggleCollectionVisibility", error);
    return { error: "Failed to update visibility" };
  }
}

export async function deleteCollection(collectionId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    await db
      .delete(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)));

    revalidatePath("/dashboard/uploads");
    return { success: true };
  } catch (error) {
    logError("deleteCollection", error);
    return { error: "Failed to delete collection" };
  }
}
