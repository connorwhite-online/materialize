"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { createListingSchema, fileExtensionToFormat } from "@/lib/validations/file";

export async function createFileListing(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

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
    })
    .returning();

  // Link any uploaded assets from the session
  const assetIds = formData.getAll("assetIds") as string[];
  if (assetIds.length > 0) {
    for (const assetId of assetIds) {
      await db
        .update(fileAssets)
        .set({ fileId: file.id })
        .where(eq(fileAssets.id, assetId));
    }
  }

  revalidatePath("/dashboard/uploads");
  redirect(`/dashboard/uploads`);
}

export async function updateFileListing(fileId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

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
}

export async function publishFileListing(fileId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  await db
    .update(files)
    .set({ status: "published" })
    .where(and(eq(files.id, fileId), eq(files.userId, userId)));

  revalidatePath("/dashboard/uploads");
  revalidatePath("/files");
}

export async function archiveFileListing(fileId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  await db
    .update(files)
    .set({ status: "archived" })
    .where(and(eq(files.id, fileId), eq(files.userId, userId)));

  revalidatePath("/dashboard/uploads");
  revalidatePath("/files");
}
