"use server";

/**
 * Server actions for project listings — sellable bundles of files.
 *
 * A project mirrors the "listing metadata" subset of files (price,
 * license, slug, status, visibility, tags) and references N existing
 * files via the project_files M2M join. Buying a project grants the
 * buyer access to every file inside it (see lib/entitlement.ts).
 *
 * Most actions mirror app/actions/files.ts; the project-specific bits
 * are addFilesToProject / removeFileFromProject / reorderProjectFiles.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  projectCollaborators,
  projects,
  projectFiles,
  projectPhotos,
  purchases,
  users,
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import {
  createProjectSchema,
  updateProjectSchema,
  MAX_PROJECT_FILES,
  MAX_BUILD_GUIDE_LENGTH,
} from "@/lib/validations/project";
import { buildListingSlug } from "@/lib/filenames";
import { logError, isRedirectError } from "@/lib/logger";
import {
  canWriteProject,
  resolveOwnerForCreate,
  viewerCanAttachAllFiles,
} from "@/lib/authorization";
import { notifyCollaboratorAddedToProject } from "@/lib/notifications/notify";

export async function createProject(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // Optional org owner from the create form's owner picker. Resolved
  // against viewer membership server-side so a tampered value can't
  // attribute the project to an arbitrary org. See lib/authorization.ts.
  const rawOrgIdForCreate = formData.get("organizationId");
  const requestedOrgId =
    typeof rawOrgIdForCreate === "string" && rawOrgIdForCreate.length > 0
      ? rawOrgIdForCreate
      : null;
  const ownerResolution = await resolveOwnerForCreate(userId, requestedOrgId);
  if (!ownerResolution.ok) {
    return { error: { name: ["You're not a member of that organization."] } };
  }
  const organizationId = ownerResolution.organizationId;

  const designTagValues = formData.getAll("designTags") as string[];
  const fileIdValues = formData.getAll("fileIds") as string[];

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    buildGuide: formData.get("buildGuide") || undefined,
    price: formData.get("price"),
    license: formData.get("license"),
    visibility: formData.get("visibility") || undefined,
    tags: formData.get("tags") || undefined,
    designTags: designTagValues.length > 0 ? designTagValues : undefined,
    thumbnailUrl: formData.get("thumbnailUrl") || undefined,
    repoUrl: formData.get("repoUrl") || undefined,
    fileIds: fileIdValues,
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  // Files can be attached if the viewer owns them OR they belong to
  // an org the viewer is in. This means an org-owned project can
  // bundle files from any of the org's members without a separate
  // transfer step.
  if (!(await viewerCanAttachAllFiles(userId, parsed.data.fileIds))) {
    return {
      error: { fileIds: ["One or more files are not yours."] },
    };
  }

  try {
    const slug = buildListingSlug(parsed.data.name, nanoid(6));
    const visibility: "public" | "private" =
      parsed.data.visibility ?? "public";

    const [project] = await db
      .insert(projects)
      .values({
        userId,
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        buildGuide: parsed.data.buildGuide,
        slug,
        price: parsed.data.price,
        license: parsed.data.license,
        visibility,
        tags: parsed.data.tags,
        designTags: parsed.data.designTags,
        thumbnailUrl: parsed.data.thumbnailUrl,
        repoUrl: parsed.data.repoUrl,
        status: "published",
      })
      .returning();

    await db.insert(projectFiles).values(
      parsed.data.fileIds.map((fileId, i) => ({
        projectId: project.id,
        fileId,
        position: i,
      }))
    );

    revalidatePath("/dashboard");
    redirect(`/projects/${project.slug}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    logError("createProject", error);
    return {
      error: { name: ["Failed to create project. Please try again."] },
    };
  }
}

export async function updateProject(projectId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  try {
    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: { name: ["Not found"] } };
    const project = access.resource;

    const designTagValues = formData.getAll("designTags") as string[];

    const parsed = updateProjectSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      price: formData.get("price"),
      license: formData.get("license"),
      visibility: formData.get("visibility") || undefined,
      tags: formData.get("tags") || undefined,
      designTags: designTagValues.length > 0 ? designTagValues : undefined,
      thumbnailUrl: formData.get("thumbnailUrl") || undefined,
      // Empty submission means "clear the repo URL" — explicit null so
      // the validator sees an empty string and resolves it to undefined,
      // and the update below writes null.
      repoUrl:
        formData.has("repoUrl") ? formData.get("repoUrl") || "" : undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
    }

    // Optional cover override — same shape as files.ts. Empty / missing
    // resets the column to null (use the legacy thumbnailUrl). Validate
    // that the chosen photo belongs to THIS project and is a curator-
    // kind row so a buyer's photo can't be selected as cover.
    const rawCoverPhotoId = formData.get("coverPhotoId");
    let coverPhotoUpdate: { coverPhotoId: string | null } | null = null;
    if (formData.has("coverPhotoId")) {
      if (typeof rawCoverPhotoId === "string" && rawCoverPhotoId !== "") {
        const [cover] = await db
          .select({ id: projectPhotos.id })
          .from(projectPhotos)
          .where(
            and(
              eq(projectPhotos.id, rawCoverPhotoId),
              eq(projectPhotos.projectId, projectId),
              eq(projectPhotos.kind, "creator")
            )
          );
        if (!cover) {
          return {
            error: {
              coverPhotoId: ["Cover photo doesn't belong to this project."],
            },
          };
        }
        coverPhotoUpdate = { coverPhotoId: cover.id };
      } else {
        coverPhotoUpdate = { coverPhotoId: null };
      }
    }

    await db
      .update(projects)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        price: parsed.data.price,
        license: parsed.data.license,
        visibility: parsed.data.visibility ?? project.visibility,
        tags: parsed.data.tags,
        designTags: parsed.data.designTags,
        thumbnailUrl: parsed.data.thumbnailUrl,
        // Only touch repoUrl if the caller actually submitted the field.
        // Posting an empty string clears it (validator → undefined → null
        // here); omitting it entirely leaves the existing value alone.
        ...(formData.has("repoUrl")
          ? { repoUrl: parsed.data.repoUrl ?? null }
          : {}),
        ...(coverPhotoUpdate ?? {}),
      })
      .where(eq(projects.id, projectId));

    revalidatePath("/dashboard");
    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("updateProject", error);
    return {
      error: { name: ["Failed to update project. Please try again."] },
    };
  }
}

/**
 * Save the project's build guide — the long-form markdown "how to
 * build this" doc. Split out from updateProject because the guide is
 * authored in its own dedicated editor on the project page (not the
 * metadata dialog) and can be very long. Pass an empty string to
 * clear it (column resets to NULL).
 */
export async function updateProjectBuildGuide(
  projectId: string,
  buildGuide: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    if (typeof buildGuide !== "string") {
      return { error: "Invalid build guide" };
    }
    if (buildGuide.length > MAX_BUILD_GUIDE_LENGTH) {
      return {
        error: `Build guide must be under ${MAX_BUILD_GUIDE_LENGTH} characters.`,
      };
    }
    const trimmed = buildGuide.trim();

    await db
      .update(projects)
      .set({ buildGuide: trimmed || null })
      .where(eq(projects.id, projectId));

    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("updateProjectBuildGuide", error);
    return { error: "Failed to save build guide." };
  }
}

export async function addFilesToProject(
  projectId: string,
  fileIds: string[]
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Dedupe + cap up front. Without this a malicious caller could
    // post a giant fileIds array that scales the DB cost of the
    // ownership join and the bulk insert.
    const sanitized = Array.from(new Set(fileIds));
    if (sanitized.length === 0) return { success: true };

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    if (!(await viewerCanAttachAllFiles(userId, sanitized))) {
      return { error: "One or more files are not yours." };
    }

    // Cap total project size before doing the bulk insert. The
    // following SELECT-then-INSERT was previously racy: two near-
    // simultaneous addFiles requests both saw the same `existing`
    // count and could push the project past MAX_PROJECT_FILES, OR
    // both insert the same fileId and hit the
    // project_files_project_file_uniq constraint. The unique index
    // (project_id, file_id) already exists from migration 0003 —
    // route the second-arrival's collision through onConflictDoNothing
    // so it cleanly no-ops instead of throwing.
    const existing = await db
      .select({ fileId: projectFiles.fileId })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const existingSet = new Set(existing.map((r) => r.fileId));
    const additions = sanitized.filter((id) => !existingSet.has(id));

    if (additions.length === 0) return { success: true };

    if (existing.length + additions.length > MAX_PROJECT_FILES) {
      return {
        error: `A project can bundle at most ${MAX_PROJECT_FILES} files.`,
      };
    }

    const startPosition = existing.length;
    await db
      .insert(projectFiles)
      .values(
        additions.map((fileId, i) => ({
          projectId,
          fileId,
          position: startPosition + i,
        }))
      )
      .onConflictDoNothing({
        target: [projectFiles.projectId, projectFiles.fileId],
      });

    revalidatePath("/dashboard");
    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("addFilesToProject", error);
    return { error: "Failed to add files" };
  }
}

export async function removeFileFromProject(
  projectId: string,
  fileId: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    await db
      .delete(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.fileId, fileId)
        )
      );

    revalidatePath("/dashboard");
    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("removeFileFromProject", error);
    return { error: "Failed to remove file" };
  }
}

export async function reorderProjectFiles(
  projectId: string,
  orderedFileIds: string[]
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    // Dedupe + cap to MAX_PROJECT_FILES so a malicious caller can't
    // submit a giant ordered list. Keep first occurrence ordering.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of orderedFileIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      if (ordered.length >= MAX_PROJECT_FILES) break;
    }
    if (ordered.length === 0) return { success: true };

    // Atomic re-numbering: a single UPDATE...CASE WHEN statement
    // assigns every row's position in one round-trip. The previous
    // Promise.all-of-N-updates approach interleaved when the user
    // dragged fast — two reorders in flight could leave rows pointing
    // at conflicting positions, with the visible order matching
    // neither drag.
    const cases = ordered.map(
      (fileId, i) =>
        sql`WHEN ${projectFiles.fileId} = ${fileId} THEN ${i}`
    );
    await db
      .update(projectFiles)
      .set({
        position: sql`CASE ${sql.join(cases, sql` `)} ELSE ${projectFiles.position} END`,
      })
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          inArray(projectFiles.fileId, ordered)
        )
      );

    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("reorderProjectFiles", error);
    return { error: "Failed to reorder files" };
  }
}

export async function publishProject(projectId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return;

    await db
      .update(projects)
      .set({ status: "published" })
      .where(eq(projects.id, projectId));

    revalidatePath("/dashboard");
  } catch (error) {
    logError("publishProject", error);
  }
}

export async function archiveProject(projectId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return;

    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, projectId));

    revalidatePath("/dashboard");
  } catch (error) {
    logError("archiveProject", error);
  }
}

/**
 * Delete a project the owner controls.
 *
 * If anyone has purchased the project we soft-archive instead of
 * hard-deleting (matches deleteFileListing's behavior). Hard delete
 * removes the project row and the project_files links; the underlying
 * files survive — projects are bundles, not owners of files.
 */
export async function deleteProject(
  projectId: string
): Promise<
  | { archived: true; reason: "has-buyers"; buyerCount: number }
  | { deleted: true }
  | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    const buyerRows = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.projectId, projectId),
          eq(purchases.status, "completed")
        )
      );

    if (buyerRows.length > 0) {
      await db
        .update(projects)
        .set({ status: "archived", visibility: "private" })
        .where(eq(projects.id, projectId));
      revalidatePath(`/projects/${project.slug}`);
      revalidatePath("/dashboard");
      return {
        archived: true,
        reason: "has-buyers",
        buyerCount: buyerRows.length,
      };
    }

    await db.delete(projects).where(eq(projects.id, projectId));

    revalidatePath(`/projects/${project.slug}`);
    revalidatePath("/dashboard");
    return { deleted: true };
  } catch (error) {
    logError("deleteProject", error);
    return { error: "Failed to delete project" };
  }
}

export async function toggleProjectVisibility(projectId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    const newVisibility =
      project.visibility === "public" ? "private" : "public";

    await db
      .update(projects)
      .set({ visibility: newVisibility })
      .where(eq(projects.id, projectId));

    revalidatePath("/dashboard");
    return { visibility: newVisibility };
  } catch (error) {
    logError("toggleProjectVisibility", error);
    return { error: "Failed to update visibility" };
  }
}

// ─── Project collaborators ───────────────────────────────────────────
//
// V1 is direct-add by username: the project owner (or any org member
// of an org-owned project) types a teammate's @handle and they get
// immediate write access plus a notification. Collaborators
// themselves CANNOT invite more collaborators — that's deliberately
// owner/org-member-only via the `viaCollaborator` flag from
// canWriteProject. Same shape GitHub uses for outside collaborators.
//
// A future invite/accept flow would slot in here without breaking the
// public surface: add a `status` column ("invited" | "active"), have
// addProjectCollaborator insert "invited" + send a notification with
// an accept link, and gate canWriteProject on `status = active`.

export async function addProjectCollaborator(
  projectId: string,
  username: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Only owners / org members can add collaborators — a collaborator
    // can't grow the access list further on their own. The
    // `viaCollaborator` flag is what distinguishes the two.
    const access = await canWriteProject(userId, projectId);
    if (!access.ok || access.viaCollaborator) {
      return { error: "You don't have permission to add collaborators." };
    }
    const project = access.resource;

    const handle = username.trim().replace(/^@/, "").toLowerCase();
    if (!handle) return { error: "Enter a username." };

    const [target] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.username, handle))
      .limit(1);
    if (!target) {
      return { error: `No user found with the handle @${handle}.` };
    }
    if (target.id === project.userId) {
      // The creator already has full access — adding them as a
      // "collaborator" would be a no-op row that confuses the UI.
      return { error: "That user is the project owner." };
    }

    const inserted = await db
      .insert(projectCollaborators)
      .values({
        projectId,
        userId: target.id,
        addedBy: userId,
      })
      // No-op on duplicate (the unique index would otherwise throw).
      // Returning empty means "row already existed" — surface a
      // friendly message rather than a generic failure.
      .onConflictDoNothing({
        target: [projectCollaborators.projectId, projectCollaborators.userId],
      })
      .returning({ id: projectCollaborators.id });

    if (inserted.length === 0) {
      return { error: "Already a collaborator." };
    }

    // Best-effort notification. The action returns success regardless
    // of email/notification delivery — that matches the comment /
    // build notify posture elsewhere in the codebase.
    const [actor] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (actor) {
      void notifyCollaboratorAddedToProject(target.id, {
        actor: {
          id: actor.id,
          username: actor.username,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
        },
        listing: {
          kind: "project",
          name: project.name,
          slug: project.slug,
        },
      });
    }

    revalidatePath(`/projects/${project.slug}`);
    return {
      success: true,
      collaborator: {
        id: target.id,
        username: target.username,
        displayName: target.displayName,
        avatarUrl: target.avatarUrl,
      },
    };
  } catch (error) {
    logError("addProjectCollaborator", error);
    return { error: "Failed to add collaborator." };
  }
}

export async function removeProjectCollaborator(
  projectId: string,
  collaboratorUserId: string
) {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteProject(userId, projectId);
    if (!access.ok) return { error: "Project not found" };
    const project = access.resource;

    // Two paths to removal: an owner / org member can remove anyone;
    // a collaborator can remove themselves but no one else.
    if (
      access.viaCollaborator &&
      collaboratorUserId !== userId
    ) {
      return { error: "Collaborators can only remove themselves." };
    }

    await db
      .delete(projectCollaborators)
      .where(
        and(
          eq(projectCollaborators.projectId, projectId),
          eq(projectCollaborators.userId, collaboratorUserId)
        )
      );

    revalidatePath(`/projects/${project.slug}`);
    return { success: true };
  } catch (error) {
    logError("removeProjectCollaborator", error);
    return { error: "Failed to remove collaborator." };
  }
}

/**
 * Public reader for the project detail page. Returns the joined user
 * info so the avatar row renders without a follow-up query. Open to
 * anyone who can see the project — the detail page itself gates
 * visibility before calling this.
 */
export async function listProjectCollaborators(projectId: string): Promise<
  Array<{
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    addedAt: Date;
  }>
> {
  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: projectCollaborators.role,
        addedAt: projectCollaborators.createdAt,
      })
      .from(projectCollaborators)
      .innerJoin(users, eq(users.id, projectCollaborators.userId))
      .where(eq(projectCollaborators.projectId, projectId))
      .orderBy(projectCollaborators.createdAt);
    return rows;
  } catch (error) {
    logError("listProjectCollaborators", error);
    return [];
  }
}

