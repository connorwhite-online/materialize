import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, purchases } from "@/lib/db/schema";

/**
 * Completed purchases of a project. Non-zero means a delete must
 * soft-archive instead of hard-deleting: the cascade would drop the
 * buyers' purchase rows and with them their access to the bundle.
 * Shared by the web `deleteProject` action and the MCP
 * `materialize_delete_project` tool so the two surfaces can't drift.
 */
export async function countProjectBuyers(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(eq(purchases.projectId, projectId), eq(purchases.status, "completed"))
    );
  return rows.length;
}

/** Soft-delete: the row stays for its buyers, the listing goes dark. */
export async function archiveProjectRow(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ status: "archived", visibility: "private" })
    .where(eq(projects.id, projectId));
}
