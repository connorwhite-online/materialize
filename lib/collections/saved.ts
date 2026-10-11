import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  collectionItems,
  collections,
  organizationMembers,
} from "@/lib/db/schema";

/** A file or project someone can save into a collection. */
export type SaveTarget = { kind: "file" | "project"; id: string };

/**
 * Collections the viewer can write to: their personal ones plus those
 * owned by an org they belong to. Same scope as `canWriteCollection`.
 */
export async function writableCollectionIds(viewerId: string) {
  const orgIds = (
    await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, viewerId))
  ).map((r) => r.organizationId);
  return orgIds.length > 0
    ? or(
        eq(collections.userId, viewerId),
        inArray(collections.organizationId, orgIds)
      )
    : eq(collections.userId, viewerId);
}

export function itemMatches(target: SaveTarget) {
  return target.kind === "file"
    ? eq(collectionItems.fileId, target.id)
    : eq(collectionItems.projectId, target.id);
}

/**
 * Whether the target sits in any collection the viewer can write to.
 * Drives the filled state of the Save button on file and project pages.
 */
export async function viewerHasSaved(
  viewerId: string | null,
  target: SaveTarget
): Promise<boolean> {
  if (!viewerId) return false;
  // Decorative (it only fills the icon), so a failed read shows the
  // unsaved state rather than failing the page.
  try {
    const [row] = await db
      .select({ id: collectionItems.id })
      .from(collectionItems)
      .innerJoin(collections, eq(collectionItems.collectionId, collections.id))
      .where(and(itemMatches(target), await writableCollectionIds(viewerId)))
      .limit(1);
    return !!row;
  } catch {
    return false;
  }
}
