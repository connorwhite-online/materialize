"use server";

import { auth } from "@clerk/nextjs/server";
import { eq, and, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  fileComments,
  projectComments,
  files,
  projects,
  users,
} from "@/lib/db/schema";
import {
  postCommentSchema,
  editCommentSchema,
} from "@/lib/validations/comment";
import { logError } from "@/lib/logger";
import { isOrgMember } from "@/lib/authorization";
import {
  notifyCommentOnListing,
  notifyReplyToComment,
} from "@/lib/notifications/notify";
import { makeSnippet } from "@/lib/notifications/types";

// "file" or "project" — narrows which table + listing FK we touch.
// Centralizing this constant lets the page integration pass it once
// without having to import a union literal at every call site.
export type CommentTarget = "file" | "project";

type Result =
  | { ok: true; commentId?: string }
  | { error: string };

// ---- Post -----------------------------------------------------------

/**
 * Post a top-level comment or a single-level reply on a file or project.
 *
 * Depth is enforced here rather than at the DB level: if `parentId` is
 * supplied, the parent must itself have `parentId === null`. This keeps
 * threads to two visual levels (the user-confirmed shape) without
 * needing a CHECK constraint or trigger.
 *
 * The parent must also belong to the same `targetId` we're commenting
 * on — otherwise a malicious caller could attach a reply on file A to
 * a comment on file B and break thread integrity.
 */
export async function postComment(
  target: CommentTarget,
  targetId: string,
  input: { body: string; parentId?: string }
): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to post a comment" };

    const parsed = postCommentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid comment",
      };
    }

    // Pull the actor's identity once. We denormalize it into any
    // notification payload we end up emitting below — saves a join
    // later and survives later renames in the bell preview.
    const [actor] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!actor) return { error: "User not found" };

    if (target === "file") {
      // Verify the listing exists (and grab the slug for revalidate).
      const [file] = await db
        .select({
          id: files.id,
          slug: files.slug,
          name: files.name,
          ownerId: files.userId,
          visibility: files.visibility,
          status: files.status,
          organizationId: files.organizationId,
        })
        .from(files)
        .where(eq(files.id, targetId));
      if (!file) return { error: "File not found" };

      // Only comment on a listing the actor can see: published + public,
      // or one they own / co-own via its org. Blocks commenting on
      // someone else's private or draft listing. (CON-74)
      const fileIsWriter =
        file.ownerId === userId ||
        (!!file.organizationId &&
          (await isOrgMember(userId, file.organizationId)).member);
      if (
        !(
          (file.status === "published" && file.visibility === "public") ||
          fileIsWriter
        )
      ) {
        return { error: "File not found" };
      }

      let parentAuthorId: string | null = null;
      if (parsed.data.parentId) {
        const [parent] = await db
          .select({
            id: fileComments.id,
            parentId: fileComments.parentId,
            fileId: fileComments.fileId,
            authorId: fileComments.userId,
          })
          .from(fileComments)
          .where(eq(fileComments.id, parsed.data.parentId));
        if (!parent || parent.fileId !== file.id) {
          return { error: "Parent comment not found" };
        }
        if (parent.parentId !== null) {
          return { error: "Replies can't be nested further" };
        }
        parentAuthorId = parent.authorId;
      }

      const [row] = await db
        .insert(fileComments)
        .values({
          fileId: file.id,
          userId,
          parentId: parsed.data.parentId ?? null,
          body: parsed.data.body,
        })
        .returning({ id: fileComments.id });

      // Notification side-effects. The notify helpers swallow their
      // own errors and skip self-events, so we don't have to guard
      // those cases here.
      const listing = {
        kind: "file" as const,
        name: file.name,
        slug: file.slug,
      };
      const snippet = makeSnippet(parsed.data.body);
      if (parsed.data.parentId && parentAuthorId) {
        // Reply: notify the parent author. If they happen to be the
        // listing owner, also send the listing-comment notification
        // (different inbox entry; the listing-owner cares about both
        // identity-flavors of "someone is talking on my page").
        await notifyReplyToComment(parentAuthorId, {
          actor,
          listing,
          commentId: row.id,
          parentCommentId: parsed.data.parentId,
          snippet,
        });
        if (file.ownerId !== parentAuthorId) {
          await notifyCommentOnListing(file.ownerId, {
            actor,
            listing,
            commentId: row.id,
            snippet,
          });
        }
      } else {
        await notifyCommentOnListing(file.ownerId, {
          actor,
          listing,
          commentId: row.id,
          snippet,
        });
      }

      revalidatePath(`/files/${file.slug}`);
      return { ok: true, commentId: row.id };
    }

    const [project] = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        ownerId: projects.userId,
        visibility: projects.visibility,
        status: projects.status,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(eq(projects.id, targetId));
    if (!project) return { error: "Project not found" };

    // Same visibility gate as the file branch. (CON-74)
    const projectIsWriter =
      project.ownerId === userId ||
      (!!project.organizationId &&
        (await isOrgMember(userId, project.organizationId)).member);
    if (
      !(
        (project.status === "published" && project.visibility === "public") ||
        projectIsWriter
      )
    ) {
      return { error: "Project not found" };
    }

    let parentAuthorId: string | null = null;
    if (parsed.data.parentId) {
      const [parent] = await db
        .select({
          id: projectComments.id,
          parentId: projectComments.parentId,
          projectId: projectComments.projectId,
          authorId: projectComments.userId,
        })
        .from(projectComments)
        .where(eq(projectComments.id, parsed.data.parentId));
      if (!parent || parent.projectId !== project.id) {
        return { error: "Parent comment not found" };
      }
      if (parent.parentId !== null) {
        return { error: "Replies can't be nested further" };
      }
      parentAuthorId = parent.authorId;
    }

    const [row] = await db
      .insert(projectComments)
      .values({
        projectId: project.id,
        userId,
        parentId: parsed.data.parentId ?? null,
        body: parsed.data.body,
      })
      .returning({ id: projectComments.id });

    const listing = {
      kind: "project" as const,
      name: project.name,
      slug: project.slug,
    };
    const snippet = makeSnippet(parsed.data.body);
    if (parsed.data.parentId && parentAuthorId) {
      await notifyReplyToComment(parentAuthorId, {
        actor,
        listing,
        commentId: row.id,
        parentCommentId: parsed.data.parentId,
        snippet,
      });
      if (project.ownerId !== parentAuthorId) {
        await notifyCommentOnListing(project.ownerId, {
          actor,
          listing,
          commentId: row.id,
          snippet,
        });
      }
    } else {
      await notifyCommentOnListing(project.ownerId, {
        actor,
        listing,
        commentId: row.id,
        snippet,
      });
    }

    revalidatePath(`/projects/${project.slug}`);
    return { ok: true, commentId: row.id };
  } catch (error) {
    logError("postComment", error);
    return { error: "Failed to post comment" };
  }
}

// ---- Edit -----------------------------------------------------------

/**
 * Edit your own comment. Listing owners can't edit other people's
 * comments — that would be a credibility-destroying surface (silently
 * rewriting feedback). They CAN delete via `deleteComment`.
 */
export async function editComment(
  target: CommentTarget,
  commentId: string,
  input: { body: string }
): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to edit" };

    const parsed = editCommentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid comment",
      };
    }

    if (target === "file") {
      const [row] = await db
        .select({
          id: fileComments.id,
          userId: fileComments.userId,
          deletedAt: fileComments.deletedAt,
          slug: files.slug,
        })
        .from(fileComments)
        .innerJoin(files, eq(fileComments.fileId, files.id))
        .where(eq(fileComments.id, commentId));
      if (!row) return { error: "Comment not found" };
      if (row.userId !== userId) return { error: "Not your comment" };
      if (row.deletedAt) return { error: "Comment was deleted" };

      await db
        .update(fileComments)
        .set({ body: parsed.data.body })
        .where(eq(fileComments.id, commentId));

      revalidatePath(`/files/${row.slug}`);
      return { ok: true, commentId };
    }

    const [row] = await db
      .select({
        id: projectComments.id,
        userId: projectComments.userId,
        deletedAt: projectComments.deletedAt,
        slug: projects.slug,
      })
      .from(projectComments)
      .innerJoin(projects, eq(projectComments.projectId, projects.id))
      .where(eq(projectComments.id, commentId));
    if (!row) return { error: "Comment not found" };
    if (row.userId !== userId) return { error: "Not your comment" };
    if (row.deletedAt) return { error: "Comment was deleted" };

    await db
      .update(projectComments)
      .set({ body: parsed.data.body })
      .where(eq(projectComments.id, commentId));

    revalidatePath(`/projects/${row.slug}`);
    return { ok: true, commentId };
  } catch (error) {
    logError("editComment", error);
    return { error: "Failed to edit comment" };
  }
}

// ---- Delete ---------------------------------------------------------

/**
 * Soft-delete: sets `deletedAt`, leaves the row in place so the UI can
 * render `[deleted]` in-thread without orphaning replies. The author
 * OR the listing owner can delete; callers without either right get
 * "Comment not found" so we don't leak existence.
 */
export async function deleteComment(
  target: CommentTarget,
  commentId: string
): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in to delete" };

    if (target === "file") {
      const [row] = await db
        .select({
          id: fileComments.id,
          authorId: fileComments.userId,
          ownerId: files.userId,
          slug: files.slug,
        })
        .from(fileComments)
        .innerJoin(files, eq(fileComments.fileId, files.id))
        .where(
          and(eq(fileComments.id, commentId), isNull(fileComments.deletedAt))
        );
      if (!row) return { error: "Comment not found" };
      if (row.authorId !== userId && row.ownerId !== userId) {
        return { error: "Comment not found" };
      }

      await db
        .update(fileComments)
        .set({ deletedAt: new Date() })
        .where(eq(fileComments.id, commentId));

      revalidatePath(`/files/${row.slug}`);
      return { ok: true, commentId };
    }

    const [row] = await db
      .select({
        id: projectComments.id,
        authorId: projectComments.userId,
        ownerId: projects.userId,
        slug: projects.slug,
      })
      .from(projectComments)
      .innerJoin(projects, eq(projectComments.projectId, projects.id))
      .where(
        and(
          eq(projectComments.id, commentId),
          isNull(projectComments.deletedAt)
        )
      );
    if (!row) return { error: "Comment not found" };
    if (row.authorId !== userId && row.ownerId !== userId) {
      return { error: "Comment not found" };
    }

    await db
      .update(projectComments)
      .set({ deletedAt: new Date() })
      .where(eq(projectComments.id, commentId));

    revalidatePath(`/projects/${row.slug}`);
    return { ok: true, commentId };
  } catch (error) {
    logError("deleteComment", error);
    return { error: "Failed to delete comment" };
  }
}
