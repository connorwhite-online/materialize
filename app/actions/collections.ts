"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  collections,
  collectionItems,
  organizationMembers,
  projects,
} from "@/lib/db/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { z } from "zod";
import { logError } from "@/lib/logger";
import {
  canWriteCollection,
  resolveOwnerForCreate,
} from "@/lib/authorization";

const collectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val.split(",").map((t) => t.trim()).filter(Boolean)
        : []
    ),
});

/**
 * Lists every collection the viewer can add things to — personal
 * collections AND collections owned by any org the viewer is a member
 * of. Used by the "Add to collection" dropdown in upload flows; the
 * dropdown shows them all so a user can drop a new upload into either
 * personal or team-shared curation lists in one click.
 */
export async function listMyCollections(): Promise<
  Array<{ id: string; name: string; organizationId: string | null }>
> {
  try {
    const { userId } = await auth();
    if (!userId) return [];
    const myOrgIds = (
      await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, userId))
    ).map((r) => r.organizationId);

    const ownerFilter =
      myOrgIds.length > 0
        ? or(
            eq(collections.userId, userId),
            // drizzle's `inArray` would work but `or` keeps the SQL
            // symmetrical with the userId branch and the planner can
            // hit the same composite index either way.
            ...myOrgIds.map((orgId) =>
              eq(collections.organizationId, orgId)
            )
          )
        : eq(collections.userId, userId);

    const rows = await db
      .select({
        id: collections.id,
        name: collections.name,
        organizationId: collections.organizationId,
      })
      .from(collections)
      .where(ownerFilter)
      .orderBy(desc(collections.updatedAt));
    return rows;
  } catch (error) {
    logError("listMyCollections", error);
    return [];
  }
}

export async function createCollection(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const rawOrgIdForCreate = formData.get("organizationId");
  const requestedOrgId =
    typeof rawOrgIdForCreate === "string" && rawOrgIdForCreate.length > 0
      ? rawOrgIdForCreate
      : null;
  const ownerResolution = await resolveOwnerForCreate(userId, requestedOrgId);
  if (!ownerResolution.ok) {
    return { error: { name: ["You're not a member of that organization."] } };
  }
  const organizationId = ownerResolution.organizationId;

  const parsed = collectionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    visibility: formData.get("visibility") || undefined,
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
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        visibility: parsed.data.visibility ?? "public",
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

async function nextSortOrder(collectionId: string) {
  const existing = await db
    .select({ sortOrder: collectionItems.sortOrder })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));
  return existing.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;
}

export async function addFileToCollection(collectionId: string, fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };

    await db.insert(collectionItems).values({
      collectionId,
      fileId,
      sortOrder: await nextSortOrder(collectionId),
    });

    revalidatePath("/dashboard/uploads");
    return { success: true };
  } catch (error) {
    logError("addFileToCollection", error);
    return { error: "Failed to add file to collection" };
  }
}

export async function addProjectToCollection(
  collectionId: string,
  projectId: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };
    const collection = access.resource;

    // Verify project exists (any user's published project can be
    // collected — same as files. Visibility check happens at render).
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) return { error: "Project not found" };

    await db.insert(collectionItems).values({
      collectionId,
      projectId,
      sortOrder: await nextSortOrder(collectionId),
    });

    revalidatePath("/dashboard/uploads");
    revalidatePath(`/collections/${collection.slug}`);
    return { success: true };
  } catch (error) {
    logError("addProjectToCollection", error);
    return { error: "Failed to add project to collection" };
  }
}

export async function removeFileFromCollection(collectionId: string, fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };

    await db
      .delete(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, collectionId),
          eq(collectionItems.fileId, fileId)
        )
      );

    revalidatePath("/dashboard/uploads");
    return { success: true };
  } catch (error) {
    logError("removeFileFromCollection", error);
    return { error: "Failed to remove file" };
  }
}

export async function removeProjectFromCollection(
  collectionId: string,
  projectId: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };
    const collection = access.resource;

    await db
      .delete(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, collectionId),
          eq(collectionItems.projectId, projectId)
        )
      );

    revalidatePath("/dashboard/uploads");
    revalidatePath(`/collections/${collection.slug}`);
    return { success: true };
  } catch (error) {
    logError("removeProjectFromCollection", error);
    return { error: "Failed to remove project" };
  }
}

const updateCollectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(["public", "private"]),
});

export async function updateCollection(
  collectionId: string,
  formData: FormData
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };
    const collection = access.resource;

    const parsed = updateCollectionSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      visibility: formData.get("visibility"),
    });
    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
    }

    await db
      .update(collections)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        visibility: parsed.data.visibility,
      })
      .where(eq(collections.id, collectionId));

    revalidatePath("/dashboard/uploads");
    revalidatePath(`/collections/${collection.slug}`);
    return { success: true };
  } catch (error) {
    logError("updateCollection", error);
    return { error: "Failed to update collection" };
  }
}

export async function toggleCollectionVisibility(collectionId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };
    const collection = access.resource;

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

    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found" };

    await db
      .delete(collections)
      .where(eq(collections.id, collectionId));

    revalidatePath("/dashboard/uploads");
    return { success: true };
  } catch (error) {
    logError("deleteCollection", error);
    return { error: "Failed to delete collection" };
  }
}
