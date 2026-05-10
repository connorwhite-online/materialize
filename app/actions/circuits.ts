"use server";

/**
 * Server actions for project circuit / wiring assets — the diagrams
 * that pair with the BOM to describe how a kit goes together
 * electrically.
 *
 * Phase 1 covers `kind: 'image'` only (PNG/SVG/JPG/WEBP). Later
 * phases will add `addProjectCircuitFritzing` (auto-extract preview
 * from .fzz), `addProjectCircuitKicad` (KiCanvas-renderable source),
 * and `addProjectCircuitWokwi` (URL embed). They'll each verify the
 * storage prefix the same way `addProjectCircuitImage` does below.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projects, projectCircuits } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteObject } from "@/lib/storage";
import { logError } from "@/lib/logger";

const MAX_CAPTION_LENGTH = 500;

async function loadOwnedProject(userId: string, projectId: string) {
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return project ?? null;
}

export async function addProjectCircuitImage(params: {
  projectId: string;
  storageKey: string;
  originalFilename?: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const expectedPrefix = `circuits/${userId}/`;
    if (
      typeof params.storageKey !== "string" ||
      !params.storageKey.startsWith(expectedPrefix)
    ) {
      return { error: "Invalid storage key" };
    }

    const project = await loadOwnedProject(userId, params.projectId);
    if (!project) return { error: "Project not found" };

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

    // Bottom of the list by default — append, don't disturb the
    // existing creator-curated order. Same approach as photo gallery.
    const existing = await db
      .select({ sortOrder: projectCircuits.sortOrder })
      .from(projectCircuits)
      .where(eq(projectCircuits.projectId, params.projectId));
    const maxOrder = existing.reduce(
      (max, e) => Math.max(max, e.sortOrder),
      -1
    );

    const [row] = await db
      .insert(projectCircuits)
      .values({
        projectId: project.id,
        kind: "image",
        sourceStorageKey: params.storageKey,
        previewStorageKey: params.storageKey,
        originalFilename: params.originalFilename ?? null,
        caption: trimmedCaption || null,
        sortOrder: maxOrder + 1,
      })
      .returning();

    revalidatePath(`/projects/${project.slug}`);
    return { circuitId: row.id };
  } catch (error) {
    logError("addProjectCircuitImage", error);
    return { error: "Failed to add diagram" };
  }
}

export async function deleteProjectCircuit(circuitId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [row] = await db
      .select({
        id: projectCircuits.id,
        projectId: projectCircuits.projectId,
        sourceStorageKey: projectCircuits.sourceStorageKey,
        previewStorageKey: projectCircuits.previewStorageKey,
        projectUserId: projects.userId,
        projectSlug: projects.slug,
      })
      .from(projectCircuits)
      .innerJoin(projects, eq(projectCircuits.projectId, projects.id))
      .where(eq(projectCircuits.id, circuitId));

    if (!row || row.projectUserId !== userId) {
      return { error: "Diagram not found" };
    }

    // Best-effort R2 cleanup. For image-kind rows source == preview,
    // so guarding against a double-delete with a Set keeps the
    // second call from racing on a key that already vanished.
    const keys = new Set<string>();
    if (row.sourceStorageKey) keys.add(row.sourceStorageKey);
    if (row.previewStorageKey) keys.add(row.previewStorageKey);
    for (const key of keys) {
      try {
        await deleteObject(key);
      } catch (e) {
        logError("deleteProjectCircuit:storage", e);
      }
    }

    await db.delete(projectCircuits).where(eq(projectCircuits.id, circuitId));

    revalidatePath(`/projects/${row.projectSlug}`);
    return { success: true };
  } catch (error) {
    logError("deleteProjectCircuit", error);
    return { error: "Failed to delete diagram" };
  }
}

export async function updateProjectCircuitCaption(
  circuitId: string,
  caption: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    if (typeof caption !== "string") {
      return { error: "Invalid caption" };
    }
    const trimmed = caption.trim().slice(0, MAX_CAPTION_LENGTH);

    const [row] = await db
      .select({
        id: projectCircuits.id,
        projectUserId: projects.userId,
        projectSlug: projects.slug,
      })
      .from(projectCircuits)
      .innerJoin(projects, eq(projectCircuits.projectId, projects.id))
      .where(eq(projectCircuits.id, circuitId));

    if (!row || row.projectUserId !== userId) {
      return { error: "Diagram not found" };
    }

    await db
      .update(projectCircuits)
      .set({ caption: trimmed || null })
      .where(eq(projectCircuits.id, circuitId));

    revalidatePath(`/projects/${row.projectSlug}`);
    return { success: true };
  } catch (error) {
    logError("updateProjectCircuitCaption", error);
    return { error: "Failed to update caption" };
  }
}
