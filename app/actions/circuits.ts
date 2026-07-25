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
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteObject } from "@/lib/storage";
import { canWriteProject } from "@/lib/authorization";
import { logError } from "@/lib/logger";

const MAX_CAPTION_LENGTH = 500;

/**
 * Parse a Wokwi project URL into its canonical embed shape. Accepts:
 *   - https://wokwi.com/projects/123456789
 *   - https://wokwi.com/projects/123456789/share/<token>
 *   - https://wokwi.com/share/<token>
 * Returns the URL we should store (the public project URL) on
 * success, or null if the URL doesn't look like a Wokwi link.
 *
 * Plain helper — file is "use server" so it cannot be exported, but
 * the addProjectCircuitWokwi action below is the only caller.
 */
function normalizeWokwiUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.hostname !== "wokwi.com" && parsed.hostname !== "www.wokwi.com") {
    return null;
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.hostname = "wokwi.com";
  return parsed.toString();
}

// Owner, org members, AND per-project collaborators can all edit a
// project's circuits — the same write set as the rest of projects.ts.
// (CON-83: previously owner-only, so org/collab editors were locked out
// of circuits while having write access everywhere else.)
async function loadWritableProject(userId: string, projectId: string) {
  const access = await canWriteProject(userId, projectId);
  if (!access.ok) return null;
  return { id: access.resource.id, slug: access.resource.slug };
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

    const project = await loadWritableProject(userId, params.projectId);
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

export async function addProjectCircuitWokwi(params: {
  projectId: string;
  url: string;
  caption?: string;
}) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const normalized = normalizeWokwiUrl(params.url);
    if (!normalized) {
      return { error: "Paste a Wokwi project URL (wokwi.com/projects/…)" };
    }

    const project = await loadWritableProject(userId, params.projectId);
    if (!project) return { error: "Project not found" };

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

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
        kind: "wokwi_url",
        externalUrl: normalized,
        caption: trimmedCaption || null,
        sortOrder: maxOrder + 1,
      })
      .returning();

    revalidatePath(`/projects/${project.slug}`);
    return { circuitId: row.id };
  } catch (error) {
    logError("addProjectCircuitWokwi", error);
    return { error: "Failed to add Wokwi link" };
  }
}

/**
 * Add a KiCad source file (schematic, PCB, or project bundle) to a
 * project. No preview is captured at upload time — the lightbox
 * renders the schematic / PCB live through KiCanvas, which streams
 * the source bytes from /api/circuits/{id}/source on demand.
 *
 * The kind argument distinguishes schematic vs PCB so the gallery
 * tile can label the placeholder accurately ("KiCad schematic" vs
 * "KiCad PCB") even before the lightbox is opened.
 */
export async function addProjectCircuitKicad(params: {
  projectId: string;
  storageKey: string;
  kind: "kicad_sch" | "kicad_pcb";
  originalFilename: string;
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
    if (params.kind !== "kicad_sch" && params.kind !== "kicad_pcb") {
      return { error: "Invalid kind" };
    }

    const project = await loadWritableProject(userId, params.projectId);
    if (!project) return { error: "Project not found" };

    const trimmedCaption = params.caption?.trim().slice(0, MAX_CAPTION_LENGTH);

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
        kind: params.kind,
        sourceStorageKey: params.storageKey,
        previewStorageKey: null,
        originalFilename: params.originalFilename,
        caption: trimmedCaption || null,
        sortOrder: maxOrder + 1,
      })
      .returning();

    revalidatePath(`/projects/${project.slug}`);
    return { circuitId: row.id };
  } catch (error) {
    logError("addProjectCircuitKicad", error);
    return { error: "Failed to add KiCad file" };
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

    if (!row) return { error: "Diagram not found" };
    if (!(await canWriteProject(userId, row.projectId)).ok) {
      return { error: "Diagram not found" };
    }

    // Row first: a DB failure leaves nothing changed (safe to retry).
    // Deleting the R2 objects first risked a DB failure stranding a
    // row that points at missing bytes — the circuit-source serving
    // route hard-502s on that.
    await db.delete(projectCircuits).where(eq(projectCircuits.id, circuitId));

    // Best-effort R2 cleanup, each key guarded independently. For
    // image-kind rows source == preview, so de-duping with a Set keeps
    // the second delete from racing on a key that already vanished.
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
        projectId: projectCircuits.projectId,
        projectSlug: projects.slug,
      })
      .from(projectCircuits)
      .innerJoin(projects, eq(projectCircuits.projectId, projects.id))
      .where(eq(projectCircuits.id, circuitId));

    if (!row) return { error: "Diagram not found" };
    if (!(await canWriteProject(userId, row.projectId)).ok) {
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
