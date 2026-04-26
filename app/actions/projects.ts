"use server";

/**
 * Server actions for project listings — sellable bundles of files.
 *
 * A project mirrors the "listing metadata" subset of files (price,
 * license, slug, status, visibility, tags) and references N existing
 * files via the project_files M2M join. Buying a project grants the
 * buyer access to every file inside it (see lib/entitlement.ts).
 *
 * Most actions mirror app/actions/files.ts; the project-specific bits
 * are addFilesToProject / removeFileFromProject / reorderProjectFiles.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  projects,
  projectFiles,
  files,
  purchases,
} from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import {
  createProjectSchema,
  updateProjectSchema,
  MAX_PROJECT_FILES,
} from "@/lib/validations/project";
import { buildListingSlug } from "@/lib/filenames";
import { logError, isRedirectError } from "@/lib/logger";

async function assertUserOwnsAllFiles(userId: string, fileIds: string[]) {
  if (fileIds.length === 0) return false;
  const owned = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inArray(files.id, fileIds), eq(files.userId, userId)));
  return owned.length === fileIds.length;
}

export async function createProject(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const designTagValues = formData.getAll("designTags") as string[];
  const fileIdValues = formData.getAll("fileIds") as string[];

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price: formData.get("price"),
    license: formData.get("license"),
    visibility: formData.get("visibility") || undefined,
    tags: formData.get("tags") || undefined,
    designTags: designTagValues.length > 0 ? designTagValues : undefined,
    thumbnailUrl: formData.get("thumbnailUrl") || undefined,
    fileIds: fileIdValues,
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  if (!(await assertUserOwnsAllFiles(userId, parsed.data.fileIds))) {
    return {
      error: { fileIds: ["One or more files are not yours."] },
    };
  }

  try {
    const slug = buildListingSlug(parsed.data.name, nanoid(6));
    const visibility: "public" | "private" =
      parsed.data.visibility ?? "public";

    const [project] = await db
      .insert(projects)
      .values({
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        slug,
        price: parsed.data.price,
        license: parsed.data.license,
        visibility,
        tags: parsed.data.tags,
        designTags: parsed.data.designTags,
        thumbnailUrl: parsed.data.thumbnailUrl,
        status: "published",
      })
      .returning();

    await db.insert(projectFiles).values(
      parsed.data.fileIds.map((fileId, i) => ({
        projectId: project.id,
        fileId,
        position: i,
      }))
    );

    revalidatePath("/dashboard");
    redirect(`/projects/${project.slug}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    logError("createProject", error);
    return {
      error: { name: ["Failed to create project. Please try again."] },
    };
  }
}

export async function updateProject(projectId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    if (!project) return { error: { name: ["Not found"] } };

    const designTagValues = formData.getAll("designTags") as string[];

    const parsed = updateProjectSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      price: formData.get("price"),
      license: formData.get("license"),
      visibility: formData.get("visibility") || undefined,
      tags: formData.get("tags") || undefined,
      designTags: designTagValues.length > 0 ? designTagValues : undefined,
      thumbnailUrl: formData.get("thumbnailUrl") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
    }

    await db
      .update(projects)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        price: parsed.data.price,
        license: parsed.data.license,
        visibility: parsed.data.visibility ?? project.visibility,
        tags: parsed.data.tags,
        designTags: parsed.data.designTags,
        thumbnailUrl: parsed.data.thumbnailUrl,
      })
      .where(eq(projects.id, projectId));

    revalidatePath("/dashboard");
    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("updateProject", error);
    return {
      error: { name: ["Failed to update project. Please try again."] },
    };
  }
}

export async function addFilesToProject(
  projectId: string,
  fileIds: string[]
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Dedupe + cap up front. Without this a malicious caller could
    // post a giant fileIds array that scales the DB cost of the
    // ownership join and the bulk insert.
    const sanitized = Array.from(new Set(fileIds));
    if (sanitized.length === 0) return { success: true };

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project) return { error: "Project not found" };

    if (!(await assertUserOwnsAllFiles(userId, sanitized))) {
      return { error: "One or more files are not yours." };
    }

    // Skip duplicates already linked to the project, then enforce
    // the per-project file cap on the resulting total.
    const existing = await db
      .select({ fileId: projectFiles.fileId })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const existingSet = new Set(existing.map((r) => r.fileId));
    const additions = sanitized.filter((id) => !existingSet.has(id));

    if (additions.length === 0) return { success: true };

    if (existing.length + additions.length > MAX_PROJECT_FILES) {
      return {
        error: `A project can bundle at most ${MAX_PROJECT_FILES} files.`,
      };
    }

    const startPosition = existing.length;
    await db.insert(projectFiles).values(
      additions.map((fileId, i) => ({
        projectId,
        fileId,
        position: startPosition + i,
      }))
    );

    revalidatePath("/dashboard");
    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("addFilesToProject", error);
    return { error: "Failed to add files" };
  }
}

export async function removeFileFromProject(
  projectId: string,
  fileId: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project) return { error: "Project not found" };

    await db
      .delete(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.fileId, fileId)
        )
      );

    revalidatePath("/dashboard");
    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("removeFileFromProject", error);
    return { error: "Failed to remove file" };
  }
}

export async function reorderProjectFiles(
  projectId: string,
  orderedFileIds: string[]
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project) return { error: "Project not found" };

    await Promise.all(
      orderedFileIds.map((fileId, i) =>
        db
          .update(projectFiles)
          .set({ position: i })
          .where(
            and(
              eq(projectFiles.projectId, projectId),
              eq(projectFiles.fileId, fileId)
            )
          )
      )
    );

    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("reorderProjectFiles", error);
    return { error: "Failed to reorder files" };
  }
}

export async function publishProject(projectId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    await db
      .update(projects)
      .set({ status: "published" })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    revalidatePath("/dashboard");
  } catch (error) {
    logError("publishProject", error);
  }
}

export async function archiveProject(projectId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    await db
      .update(projects)
      .set({ status: "archived" })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    revalidatePath("/dashboard");
  } catch (error) {
    logError("archiveProject", error);
  }
}

/**
 * Delete a project the owner controls.
 *
 * If anyone has purchased the project we soft-archive instead of
 * hard-deleting (matches deleteFileListing's behavior). Hard delete
 * removes the project row and the project_files links; the underlying
 * files survive — projects are bundles, not owners of files.
 */
export async function deleteProject(
  projectId: string
): Promise<
  | { archived: true; reason: "has-buyers"; buyerCount: number }
  | { deleted: true }
  | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [project] = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        userId: projects.userId,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    if (!project) return { error: "Project not found" };

    const buyerRows = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.projectId, projectId),
          eq(purchases.status, "completed")
        )
      );

    if (buyerRows.length > 0) {
      await db
        .update(projects)
        .set({ status: "archived", visibility: "private" })
        .where(eq(projects.id, projectId));
      revalidatePath(`/projects/${project.slug}`);
      revalidatePath("/dashboard");
      return {
        archived: true,
        reason: "has-buyers",
        buyerCount: buyerRows.length,
      };
    }

    await db.delete(projects).where(eq(projects.id, projectId));

    revalidatePath(`/projects/${project.slug}`);
    revalidatePath("/dashboard");
    return { deleted: true };
  } catch (error) {
    logError("deleteProject", error);
    return { error: "Failed to delete project" };
  }
}

export async function toggleProjectVisibility(projectId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const [project] = await db
      .select({ visibility: projects.visibility })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    if (!project) return { error: "Project not found" };

    const newVisibility =
      project.visibility === "public" ? "private" : "public";

    await db
      .update(projects)
      .set({ visibility: newVisibility })
      .where(eq(projects.id, projectId));

    revalidatePath("/dashboard");
    return { visibility: newVisibility };
  } catch (error) {
    logError("toggleProjectVisibility", error);
    return { error: "Failed to update visibility" };
  }
}

