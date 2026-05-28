"use server";

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { projectBomItems } from "@/lib/db/schema";
import { replaceBomSchema, type BomItemInput } from "@/lib/validations/bom";
import { canWriteProject } from "@/lib/authorization";
import { logError } from "@/lib/logger";

type Result = { ok: true } | { error: string };

/**
 * Replace a project's entire BOM in one transaction.
 *
 * Bulk-replace fits the editor UX: the user adds/removes/reorders
 * rows in a dialog and saves once. Per-item CRUD would require client-
 * side row identity tracking; bulk is simpler and atomic. Items are
 * inserted with sequential `sortOrder` matching the array index.
 */
export async function replaceProjectBom(
  projectId: string,
  items: BomItemInput[]
): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const parsed = replaceBomSchema.safeParse(items);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid BOM",
      };
    }

    // Owner, org members, AND per-project collaborators can all edit a
    // project's BOM — the same write set as circuits / projects.ts.
    // (CON-83: previously owner-only, locking out org/collab editors who
    // had write access everywhere else.)
    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    await db.transaction(async (tx) => {
      await tx
        .delete(projectBomItems)
        .where(eq(projectBomItems.projectId, project.id));
      if (parsed.data.length > 0) {
        await tx.insert(projectBomItems).values(
          parsed.data.map((item, i) => ({
            projectId: project.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit ?? null,
            notes: item.notes ?? null,
            sourceUrl: item.sourceUrl ?? null,
            sortOrder: i,
          }))
        );
      }
    });

    revalidatePath(`/projects/${project.slug}`);
    return { ok: true };
  } catch (error) {
    logError("replaceProjectBom", error);
    return { error: "Failed to save BOM" };
  }
}
