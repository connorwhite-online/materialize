import "server-only";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  fileDownloads,
  organizationMembers,
  printOrders,
  printOrderItems,
  projectCollaborators,
  projects,
  projectFiles,
  purchases,
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { PRINTED_STATUSES } from "@/lib/print-statuses";

/**
 * Internal helper — does the viewer belong to the given org? Returns
 * false for anonymous viewers or null orgs without a DB roundtrip.
 *
 * Inlined here (rather than imported from lib/authorization) because
 * entitlement.ts is on the file-download / page-render hot path and
 * we want a single-purpose query that hits the
 * organization_members_org_user_uniq index.
 */
async function viewerIsOrgMember(
  userId: string | null,
  organizationId: string | null
): Promise<boolean> {
  if (!userId || !organizationId) return false;
  const [row] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Does the viewer own this file? "Own" means any of:
 *   - the file is free (price === 0)
 *   - viewer is the file's creator
 *   - viewer is a member of the org that owns the file (org-owned
 *     rows treat every member as a co-creator for entitlement purposes)
 *   - viewer has a completed purchase row pointing at this fileId
 *   - viewer has a completed purchase row for ANY project that contains
 *     this file (project ownership transitively grants its files)
 *
 * `userId` may be null for anonymous viewers — only the "free" branch
 * resolves true in that case.
 *
 * Prefer `ownsLoadedFile` when the caller already has the file row in
 * hand (e.g. the download route or detail page) — saves a redundant
 * `files` lookup on the hot path.
 */
export async function userOwnsFile(
  userId: string | null,
  fileId: string
): Promise<boolean> {
  const [file] = await db
    .select({
      id: files.id,
      price: files.price,
      userId: files.userId,
      organizationId: files.organizationId,
    })
    .from(files)
    .where(eq(files.id, fileId));
  if (!file) return false;
  return ownsLoadedFile(userId, file);
}

/**
 * Same logic as `userOwnsFile` but takes the already-loaded file row,
 * skipping the initial `files` SELECT. Use this when the caller has
 * just looked up the file by slug for an unrelated reason.
 *
 * The optional `organizationId` field, when set, opts every member
 * of that org into the "creator" branch of the entitlement check.
 * Callers that omit the field (legacy code paths that haven't been
 * updated) get the original user-only behavior.
 */
export async function ownsLoadedFile(
  userId: string | null,
  file: { id: string; price: number; userId: string; organizationId?: string | null }
): Promise<boolean> {
  if (file.price === 0) return true;
  if (!userId) return false;
  if (file.userId === userId) return true;
  if (file.organizationId && (await viewerIsOrgMember(userId, file.organizationId))) {
    return true;
  }

  // Project-collaborator transitive read access: if the viewer is a
  // collaborator on ANY project that bundles this file, they get
  // download access to it. Mirrors the existing "buyer of project
  // also gets files" branch below — same join shape, different
  // membership table.
  const [viaCollaboration] = await db
    .select({ id: projectCollaborators.id })
    .from(projectCollaborators)
    .innerJoin(projectFiles, eq(projectFiles.projectId, projectCollaborators.projectId))
    .where(
      and(
        eq(projectCollaborators.userId, userId),
        eq(projectFiles.fileId, file.id)
      )
    )
    .limit(1);
  if (viaCollaboration) return true;

  const [direct] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.buyerId, userId),
        eq(purchases.fileId, file.id),
        eq(purchases.status, "completed")
      )
    )
    .limit(1);
  if (direct) return true;

  // EXISTS (purchase of project P, where project_files links P → fileId)
  const [viaProject] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .innerJoin(projectFiles, eq(projectFiles.projectId, purchases.projectId))
    .where(
      and(
        eq(purchases.buyerId, userId),
        eq(purchases.status, "completed"),
        eq(projectFiles.fileId, file.id),
        sql`${purchases.projectId} IS NOT NULL`
      )
    )
    .limit(1);
  return !!viaProject;
}

/**
 * Same shape for projects — simpler since there's no transitive
 * relation. A project is owned if it's free, the viewer created it,
 * the viewer is a member of the org that owns it, or the viewer has
 * a completed purchase of it.
 */
export async function userOwnsProject(
  userId: string | null,
  projectId: string
): Promise<boolean> {
  const [project] = await db
    .select({
      price: projects.price,
      userId: projects.userId,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return false;
  if (project.price === 0) return true;
  if (!userId) return false;
  if (project.userId === userId) return true;
  if (
    project.organizationId &&
    (await viewerIsOrgMember(userId, project.organizationId))
  ) {
    return true;
  }

  // Direct collaborator on this specific project — full download
  // access. Same shape as the org-member branch above.
  const [collaboration] = await db
    .select({ id: projectCollaborators.id })
    .from(projectCollaborators)
    .where(
      and(
        eq(projectCollaborators.userId, userId),
        eq(projectCollaborators.projectId, projectId)
      )
    )
    .limit(1);
  if (collaboration) return true;

  const [purchase] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.buyerId, userId),
        eq(purchases.projectId, projectId),
        eq(purchases.status, "completed")
      )
    )
    .limit(1);
  return !!purchase;
}

/**
 * Can this user start a print / cart line for the given file asset?
 * Printing is allowed for the asset's owner OR any published listing
 * (the public "Print with X" path). Blocks ordering / carting another
 * user's private or draft asset by a guessed id. Mirrors the gate in
 * `app/api/craftcloud/quotes/route.ts`.
 */
export async function userCanPrintAsset(
  userId: string | null,
  fileAssetId: string
): Promise<boolean> {
  const [row] = await db
    .select({ fileUserId: files.userId, fileStatus: files.status })
    .from(fileAssets)
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, fileAssetId))
    .limit(1);
  if (!row) return false;
  return (!!userId && row.fileUserId === userId) || row.fileStatus === "published";
}

/**
 * Has the user actually used this file? "Used" means either:
 *   - they downloaded it (a `fileDownloads` row exists with their userId)
 *   - they have a print order in PRINTED_STATUSES touching one of the
 *     file's assets (legacy single-item `printOrders.fileAssetId` OR
 *     multi-item `printOrderItems.fileAssetId`).
 *
 * Used to gate the "share your make" affordance — only users who have
 * a credible reason to have a printed copy can post a community make.
 *
 * Anonymous viewers (no userId) → false. The file owner is treated like
 * any other user; if they want a make on their own file, they can post
 * via the curator gallery instead.
 */
export async function userHasUsedFile(
  userId: string | null,
  fileId: string
): Promise<boolean> {
  if (!userId) return false;

  // Cheapest check first — single index hit on (file_id, created_at)
  // and a userId equality.
  const [downloaded] = await db
    .select({ id: fileDownloads.id })
    .from(fileDownloads)
    .where(
      and(
        eq(fileDownloads.fileId, fileId),
        eq(fileDownloads.userId, userId)
      )
    )
    .limit(1);
  if (downloaded) return true;

  // Resolve asset ids once for both print-order paths. Files routinely
  // have one asset; the IN list stays small.
  const assetIds = (
    await db
      .select({ id: fileAssets.id })
      .from(fileAssets)
      .where(eq(fileAssets.fileId, fileId))
  ).map((r) => r.id);
  if (assetIds.length === 0) return false;

  // Legacy single-item path — `printOrders.fileAssetId` set on parent.
  const [legacy] = await db
    .select({ id: printOrders.id })
    .from(printOrders)
    .where(
      and(
        eq(printOrders.userId, userId),
        inArray(printOrders.fileAssetId, assetIds),
        inArray(printOrders.status, [...PRINTED_STATUSES])
      )
    )
    .limit(1);
  if (legacy) return true;

  // Multi-item path — items live in `printOrderItems`, status hangs
  // off the parent printOrders row.
  const [item] = await db
    .select({ id: printOrderItems.id })
    .from(printOrderItems)
    .innerJoin(
      printOrders,
      eq(printOrderItems.printOrderId, printOrders.id)
    )
    .where(
      and(
        eq(printOrders.userId, userId),
        inArray(printOrderItems.fileAssetId, assetIds),
        inArray(printOrders.status, [...PRINTED_STATUSES])
      )
    )
    .limit(1);
  return !!item;
}
