"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets, collections, collectionFiles } from "@/lib/db/schema";
import { eq, and, ne, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { createListingSchema } from "@/lib/validations/file";
import { logError } from "@/lib/logger";

export async function createFileListing(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // Design tags come as multiple form values
  const designTagValues = formData.getAll("designTags") as string[];

  const parsed = createListingSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    license: formData.get("license"),
    tags: formData.get("tags"),
    recommendedMaterialId: formData.get("recommendedMaterialId") || undefined,
    designTags: designTagValues.length > 0 ? designTagValues : undefined,
    minWallThickness: formData.get("minWallThickness") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    // Anti-piracy: check if any of the uploaded assets match files from other users
    const assetIds = formData.getAll("assetIds") as string[];
    if (assetIds.length > 0) {
      const uploadedAssets = await db
        .select({ contentHash: fileAssets.contentHash })
        .from(fileAssets)
        .where(and(inArray(fileAssets.id, assetIds), isNotNull(fileAssets.contentHash)));

      const hashes = uploadedAssets
        .map((a) => a.contentHash)
        .filter((h): h is string => h !== null);

      if (hashes.length > 0) {
        const duplicates = await db
          .select({
            id: fileAssets.id,
            fileId: fileAssets.fileId,
            contentHash: fileAssets.contentHash,
          })
          .from(fileAssets)
          .innerJoin(files, eq(fileAssets.fileId, files.id))
          .where(
            and(
              inArray(fileAssets.contentHash, hashes),
              ne(files.userId, userId)
            )
          );

        if (duplicates.length > 0) {
          return {
            error: {
              name: [
                "This file has already been listed by another creator. Re-uploading others' files is not permitted.",
              ],
            },
          };
        }
      }
    }

    const slug = `${parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${nanoid(6)}`;

    const [file] = await db
      .insert(files)
      .values({
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        slug,
        price: parsed.data.price,
        license: parsed.data.license,
        tags: parsed.data.tags,
        recommendedMaterialId: parsed.data.recommendedMaterialId,
        designTags: parsed.data.designTags,
        minWallThickness: parsed.data.minWallThickness,
      })
      .returning();

    // Link uploaded assets
    if (assetIds.length > 0) {
      for (const assetId of assetIds) {
        await db
          .update(fileAssets)
          .set({ fileId: file.id })
          .where(eq(fileAssets.id, assetId));
      }
    }

    // Optional: add to an existing collection or create a new one
    const rawCollectionId = (formData.get("collectionId") as string | null) || "";
    const newCollectionName = (
      (formData.get("newCollectionName") as string | null) || ""
    ).trim();

    let targetCollectionId: string | null = null;
    if (rawCollectionId === "__new__" && newCollectionName) {
      const slug = `${newCollectionName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${nanoid(6)}`;
      const [created] = await db
        .insert(collections)
        .values({ userId, name: newCollectionName, slug })
        .returning({ id: collections.id });
      targetCollectionId = created.id;
    } else if (rawCollectionId && rawCollectionId !== "none") {
      // Verify ownership before linking
      const [owned] = await db
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, rawCollectionId), eq(collections.userId, userId)));
      if (owned) targetCollectionId = owned.id;
    }

    if (targetCollectionId) {
      await db.insert(collectionFiles).values({
        collectionId: targetCollectionId,
        fileId: file.id,
        sortOrder: 0,
      });
    }

    revalidatePath("/dashboard/uploads");
    redirect("/dashboard/uploads");
  } catch (error) {
    // Re-throw redirect/notFound errors (Next.js uses throw for navigation)
    if (error instanceof Error && (error.message.includes("NEXT_REDIRECT") || error.message.includes("REDIRECT"))) {
      throw error;
    }
    logError("createFileListing", error);
    return { error: { name: ["Failed to create listing. Please try again."] } };
  }
}

export async function updateFileListing(fileId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  try {
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) throw new Error("Not found");

    const parsed = createListingSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      price: formData.get("price"),
      license: formData.get("license"),
      tags: formData.get("tags"),
    });

    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
    }

    await db
      .update(files)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        price: parsed.data.price,
        license: parsed.data.license,
        tags: parsed.data.tags,
      })
      .where(eq(files.id, fileId));

    revalidatePath("/dashboard/uploads");
    revalidatePath(`/files/${file.slug}`);
  } catch (error) {
    logError("updateFileListing", error);
    return { error: { name: ["Failed to update listing. Please try again."] } };
  }
}

export async function publishFileListing(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    await db
      .update(files)
      .set({ status: "published" })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
  } catch (error) {
    logError("publishFileListing", error);
  }
}

export async function archiveFileListing(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    await db
      .update(files)
      .set({ status: "archived" })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
  } catch (error) {
    logError("archiveFileListing", error);
  }
}

export async function toggleFileVisibility(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const [file] = await db
      .select({ visibility: files.visibility })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) return { error: "File not found" };

    const newVisibility = file.visibility === "public" ? "private" : "public";

    await db
      .update(files)
      .set({ visibility: newVisibility })
      .where(eq(files.id, fileId));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
    return { visibility: newVisibility };
  } catch (error) {
    logError("toggleFileVisibility", error);
    return { error: "Failed to update visibility" };
  }
}
