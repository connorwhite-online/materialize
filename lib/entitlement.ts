import "server-only";
import { db } from "@/lib/db";
import { files, projects, projectFiles, purchases } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Does the viewer own this file? "Own" means any of:
 *   - the file is free (price === 0)
 *   - viewer is the file's creator
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
    .select({ id: files.id, price: files.price, userId: files.userId })
    .from(files)
    .where(eq(files.id, fileId));
  if (!file) return false;
  return ownsLoadedFile(userId, file);
}

/**
 * Same logic as `userOwnsFile` but takes the already-loaded file row,
 * skipping the initial `files` SELECT. Use this when the caller has
 * just looked up the file by slug for an unrelated reason.
 */
export async function ownsLoadedFile(
  userId: string | null,
  file: { id: string; price: number; userId: string }
): Promise<boolean> {
  if (file.price === 0) return true;
  if (!userId) return false;
  if (file.userId === userId) return true;

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
 * or the viewer has a completed purchase of it.
 */
export async function userOwnsProject(
  userId: string | null,
  projectId: string
): Promise<boolean> {
  const [project] = await db
    .select({ price: projects.price, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return false;
  if (project.price === 0) return true;
  if (!userId) return false;
  if (project.userId === userId) return true;

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
