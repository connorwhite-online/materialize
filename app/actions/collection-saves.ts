"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { collectionItems, collections, files, projects } from "@/lib/db/schema";
import {
  canWriteCollection,
  canWriteFile,
  canWriteProject,
} from "@/lib/authorization";
import {
  itemMatches,
  writableCollectionIds,
  type SaveTarget,
} from "@/lib/collections/saved";
import { logError } from "@/lib/logger";

export type SaveOption = {
  id: string;
  name: string;
  slug: string;
  organizationId: string | null;
  saved: boolean;
};

const MAX_NAME = 100;

function isTarget(t: unknown): t is SaveTarget {
  const v = t as SaveTarget | null;
  return (
    !!v &&
    (v.kind === "file" || v.kind === "project") &&
    typeof v.id === "string" &&
    v.id.length > 0
  );
}

/**
 * Anyone signed in can save a published public file or project; private
 * or draft ones only by people who can already edit them (collection
 * pages only render published public items to others anyway).
 */
async function canSave(viewerId: string, target: SaveTarget) {
  const table = target.kind === "file" ? files : projects;
  const [row] = await db
    .select({ status: table.status, visibility: table.visibility })
    .from(table)
    .where(eq(table.id, target.id))
    .limit(1);
  if (!row) return false;
  if (row.status === "published" && row.visibility === "public") return true;
  const write =
    target.kind === "file"
      ? await canWriteFile(viewerId, target.id)
      : await canWriteProject(viewerId, target.id);
  return write.ok;
}

/** The viewer's collections, each marked with whether it holds the target. */
export async function listSaveOptions(
  target: SaveTarget
): Promise<{ collections: SaveOption[] } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to save." };
  if (!isTarget(target)) return { error: "Nothing to save." };
  try {
    const writable = await writableCollectionIds(userId);
    const [rows, holding] = await Promise.all([
      db
        .select({
          id: collections.id,
          name: collections.name,
          slug: collections.slug,
          organizationId: collections.organizationId,
        })
        .from(collections)
        .where(writable)
        .orderBy(desc(collections.updatedAt)),
      db
        .select({ collectionId: collectionItems.collectionId })
        .from(collectionItems)
        .innerJoin(collections, eq(collectionItems.collectionId, collections.id))
        .where(and(itemMatches(target), writable)),
    ]);
    const held = new Set(holding.map((h) => h.collectionId));
    return {
      collections: rows.map((r) => ({ ...r, saved: held.has(r.id) })),
    };
  } catch (error) {
    logError("listSaveOptions", error);
    return { error: "Couldn't load your collections." };
  }
}

async function insertItem(collectionId: string, target: SaveTarget) {
  // collection_items has no unique index, so check first: saving twice
  // must not show the item twice.
  const [existing] = await db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(
      and(eq(collectionItems.collectionId, collectionId), itemMatches(target))
    )
    .limit(1);
  if (existing) return;
  const orders = await db
    .select({ sortOrder: collectionItems.sortOrder })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));
  const sortOrder = orders.reduce((m, o) => Math.max(m, o.sortOrder), -1) + 1;
  await db.insert(collectionItems).values({
    collectionId,
    sortOrder,
    ...(target.kind === "file"
      ? { fileId: target.id }
      : { projectId: target.id }),
  });
  await db
    .update(collections)
    .set({ updatedAt: new Date() })
    .where(eq(collections.id, collectionId));
}

/** Put the target in, or take it out of, one of the viewer's collections. */
export async function setCollectionSaved(
  collectionId: string,
  target: SaveTarget,
  saved: boolean
): Promise<{ saved: boolean } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to save." };
  if (!isTarget(target)) return { error: "Nothing to save." };
  try {
    const access = await canWriteCollection(userId, collectionId);
    if (!access.ok) return { error: "Collection not found." };
    if (saved) {
      if (!(await canSave(userId, target))) return { error: "Can't save this." };
      await insertItem(collectionId, target);
    } else {
      await db
        .delete(collectionItems)
        .where(
          and(
            eq(collectionItems.collectionId, collectionId),
            itemMatches(target)
          )
        );
    }
    revalidatePath(`/collections/${access.resource.slug}`);
    return { saved };
  } catch (error) {
    logError("setCollectionSaved", error);
    return { error: "Couldn't update the collection." };
  }
}

/** Start a personal collection with the target already in it. */
export async function createCollectionWithItem(
  name: string,
  target: SaveTarget
): Promise<{ collection: SaveOption } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to save." };
  if (!isTarget(target)) return { error: "Nothing to save." };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { error: "Name the collection." };
  if (trimmed.length > MAX_NAME) return { error: "That name is too long." };
  try {
    if (!(await canSave(userId, target))) return { error: "Can't save this." };
    const stem = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const slug = `${stem || "collection"}-${nanoid(6)}`;
    const [created] = await db
      .insert(collections)
      .values({ userId, name: trimmed, slug })
      .returning({
        id: collections.id,
        name: collections.name,
        slug: collections.slug,
        organizationId: collections.organizationId,
      });
    await insertItem(created.id, target);
    return { collection: { ...created, saved: true } };
  } catch (error) {
    logError("createCollectionWithItem", error);
    return { error: "Couldn't create the collection." };
  }
}
