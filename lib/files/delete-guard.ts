import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cartItems,
  fileAssets,
  files,
  printOrderItems,
  printOrders,
  projectFiles,
  projects,
  purchases,
} from "@/lib/db/schema";
import { ACTIVE_ORDER_STATUSES } from "@/lib/print-statuses";

/**
 * Why a delete request must soft-archive a file instead of hard-deleting
 * it. `count` is the number of buyers (has-buyers) or in-flight rows
 * (in-flight) that would otherwise be cascaded away.
 */
export interface FileDeleteBlocker {
  reason: "has-buyers" | "in-flight";
  count: number;
}

/**
 * The one archive-vs-hard-delete decision for a file listing, shared by
 * the web `deleteFileListing` action and the MCP `materialize_delete_file`
 * tool so the two surfaces can't drift. Returns null when the file is
 * safe to hard-delete.
 *
 * - has-buyers: a completed purchase of the file, or of a project that
 *   bundles it (transitive entitlement). Cascading would revoke their
 *   download.
 * - in-flight: any version of the file is in someone's DB cart or in a
 *   print order still in ACTIVE_ORDER_STATUSES. Cascading would drop a
 *   line item from a pending Stripe session or a placed CraftCloud order.
 */
export async function findFileDeleteBlocker(
  fileId: string
): Promise<FileDeleteBlocker | null> {
  const directBuyers = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(eq(purchases.fileId, fileId), eq(purchases.status, "completed"))
    );

  const projectBuyers = await db
    .select({ id: purchases.id })
    .from(purchases)
    .innerJoin(projects, eq(purchases.projectId, projects.id))
    .innerJoin(projectFiles, eq(projectFiles.projectId, projects.id))
    .where(
      and(eq(projectFiles.fileId, fileId), eq(purchases.status, "completed"))
    );

  const totalBuyers = directBuyers.length + projectBuyers.length;
  if (totalBuyers > 0) return { reason: "has-buyers", count: totalBuyers };

  // Every version, not just the current one — an order placed against v1
  // still cascades if the file row goes.
  const fileAssetIds = (
    await db
      .select({ id: fileAssets.id })
      .from(fileAssets)
      .where(eq(fileAssets.fileId, fileId))
  ).map((r) => r.id);
  if (fileAssetIds.length === 0) return null;

  const [activeCartItems, activeOrderItems, activeSingleOrders] =
    await Promise.all([
      db
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(inArray(cartItems.fileAssetId, fileAssetIds))
        .limit(1),
      db
        .select({ id: printOrderItems.id })
        .from(printOrderItems)
        .innerJoin(printOrders, eq(printOrderItems.printOrderId, printOrders.id))
        .where(
          and(
            inArray(printOrderItems.fileAssetId, fileAssetIds),
            inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
          )
        )
        .limit(1),
      db
        .select({ id: printOrders.id })
        .from(printOrders)
        .where(
          and(
            inArray(printOrders.fileAssetId, fileAssetIds),
            inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
          )
        )
        .limit(1),
    ]);

  const inFlight =
    activeCartItems.length + activeOrderItems.length + activeSingleOrders.length;
  return inFlight > 0 ? { reason: "in-flight", count: inFlight } : null;
}

// What an owner's Delete does when the file can't be hard-deleted. It
// also clears flaggedReason: the owner library keeps auto-flagged files
// on screen (shownInOwnerLibrary) so the owner notices them, and a
// flagged file the owner then deletes must leave the library like any
// other. flaggedAt and flaggedAgainstFileId stay as the audit trail.
const OWNER_ARCHIVE = {
  status: "archived" as const,
  visibility: "private" as const,
  flaggedReason: null,
};

/** Soft-delete: the row and its storage stay, the listing goes dark. */
export async function archiveFileListingRow(fileId: string): Promise<void> {
  await db.update(files).set(OWNER_ARCHIVE).where(eq(files.id, fileId));
}
