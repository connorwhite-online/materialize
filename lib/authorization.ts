import "server-only";

import { db } from "@/lib/db";
import {
  collections,
  files,
  organizationMembers,
  organizations,
  printOrders,
  projectCollaborators,
  projects,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Centralized write-access checks for owned resources (files,
 * projects, collections, print orders).
 *
 * The shape of "owner" is:
 *   - if `organization_id` is set: ANY org member can write
 *     (admin gating handled by `roleAtLeast` callers if needed)
 *   - else: the row's `user_id` is the sole writer
 *
 * Each `canWrite*` returns a `{ ok: true; resource }` discriminant on
 * success so the caller skips the redundant SELECT. On failure it
 * returns `{ ok: false; reason }`. Callers translate `not-found` and
 * `forbidden` into whatever shape their API expects.
 *
 * This file is deliberately the SINGLE place where ownership is
 * resolved against org membership. Future additions — project-level
 * collaborators, role-based gating, etc. — slot in here and every
 * caller picks them up automatically.
 */

type Role = "admin" | "member" | (string & {});

type CanWriteOk<T> = {
  ok: true;
  resource: T;
  viaOrg: boolean;
  /**
   * True when access was granted via a row in
   * `project_collaborators` rather than user-equality or org
   * membership. Mutually exclusive with `viaOrg`. Callers that want
   * to differentiate "this is your repo" from "you're a guest" can
   * key off either flag — most don't need to.
   */
  viaCollaborator?: boolean;
};
type CanWriteFail = {
  ok: false;
  reason: "unauthenticated" | "not-found" | "forbidden";
};

export type CanWriteResult<T> = CanWriteOk<T> | CanWriteFail;

/**
 * Returns the set of organization ids the given user belongs to. Used
 * by the canWrite* helpers to resolve "viewer is a member of the org
 * that owns this resource" in a single follow-up query rather than a
 * subquery EXISTS — keeps the SQL flat and the call counts low for
 * the common case (most users belong to 0 or 1 orgs).
 */
async function getMembershipOrgIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  return new Set(rows.map((r) => r.organizationId));
}

/**
 * Is the viewer a per-project collaborator on this project? Used by
 * `canWriteProject` as the third grant branch and by
 * `lib/entitlement.ts` as a read-access branch.
 *
 * Single-row fetch off the unique (project_id, user_id) index.
 * Returns role too so callers can later distinguish "editor" vs
 * "viewer" without a second query; today everything is editor.
 */
export async function isProjectCollaborator(
  userId: string | null,
  projectId: string
): Promise<{ collaborator: boolean; role: Role | null }> {
  if (!userId) return { collaborator: false, role: null };
  const [row] = await db
    .select({ role: projectCollaborators.role })
    .from(projectCollaborators)
    .where(
      and(
        eq(projectCollaborators.userId, userId),
        eq(projectCollaborators.projectId, projectId)
      )
    )
    .limit(1);
  if (!row) return { collaborator: false, role: null };
  return { collaborator: true, role: row.role as Role };
}

/**
 * Lighter variant when the caller only needs to ask about ONE org.
 * Single-row fetch by composite key — uses the unique index on
 * (organization_id, user_id).
 */
export async function isOrgMember(
  userId: string | null,
  organizationId: string
): Promise<{ member: boolean; role: Role | null }> {
  if (!userId) return { member: false, role: null };
  const [row] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .limit(1);
  if (!row) return { member: false, role: null };
  return { member: true, role: row.role as Role };
}

/**
 * Resolves the right owner for a new resource the viewer is creating.
 *
 * `requestedOrgId` comes from the create form's owner picker. If
 * provided we verify the viewer is actually a member of that org
 * before letting them attribute the row to it — otherwise a
 * client-side tampered form value could plant content under an
 * arbitrary org.
 *
 * Returns the validated `organizationId` (null for personal) or a
 * `forbidden` failure.
 */
export async function resolveOwnerForCreate(
  viewerId: string,
  requestedOrgId: string | null | undefined
): Promise<
  | { ok: true; organizationId: string | null }
  | { ok: false; reason: "forbidden" }
> {
  if (!requestedOrgId) return { ok: true, organizationId: null };
  const { member } = await isOrgMember(viewerId, requestedOrgId);
  if (!member) return { ok: false, reason: "forbidden" };
  return { ok: true, organizationId: requestedOrgId };
}

async function canWriteByOwnership<T extends { userId: string; organizationId: string | null }>(
  viewerId: string | null,
  row: T | undefined
): Promise<CanWriteResult<T>> {
  if (!viewerId) return { ok: false, reason: "unauthenticated" };
  if (!row) return { ok: false, reason: "not-found" };
  if (row.organizationId) {
    const { member } = await isOrgMember(viewerId, row.organizationId);
    if (!member) return { ok: false, reason: "forbidden" };
    return { ok: true, resource: row, viaOrg: true };
  }
  if (row.userId !== viewerId) return { ok: false, reason: "forbidden" };
  return { ok: true, resource: row, viaOrg: false };
}

export async function canWriteFile(viewerId: string | null, fileId: string) {
  if (!viewerId) {
    return { ok: false, reason: "unauthenticated" } as const;
  }
  const [row] = await db
    .select()
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);
  return canWriteByOwnership(viewerId, row);
}

export async function canWriteProject(viewerId: string | null, projectId: string) {
  if (!viewerId) {
    return { ok: false, reason: "unauthenticated" } as const;
  }
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const base = await canWriteByOwnership(viewerId, row);
  if (base.ok) return base;
  // Projects have a third grant path — per-project collaborators. We
  // only fall through to this branch when the owner / org checks both
  // failed. `not-found` and `unauthenticated` short-circuit (no point
  // checking collaboration when the project doesn't exist).
  if (!base.ok && base.reason === "forbidden" && row) {
    const { collaborator } = await isProjectCollaborator(viewerId, projectId);
    if (collaborator) {
      return { ok: true as const, resource: row, viaOrg: false, viaCollaborator: true };
    }
  }
  return base;
}

export async function canWriteCollection(
  viewerId: string | null,
  collectionId: string
) {
  if (!viewerId) {
    return { ok: false, reason: "unauthenticated" } as const;
  }
  const [row] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1);
  return canWriteByOwnership(viewerId, row);
}

export async function canWritePrintOrder(
  viewerId: string | null,
  printOrderId: string
) {
  if (!viewerId) {
    return { ok: false, reason: "unauthenticated" } as const;
  }
  const [row] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, printOrderId))
    .limit(1);
  return canWriteByOwnership(viewerId, row);
}

/**
 * Bulk owner check used by `createProject` (and any other server
 * action that needs to confirm the viewer can attach a list of files
 * to a new container). True iff every file id is either:
 *   - owned directly by the viewer, OR
 *   - owned by an org the viewer belongs to.
 *
 * Single round-trip: pulls all candidate rows, then resolves
 * membership locally against the viewer's org set.
 */
export async function viewerCanAttachAllFiles(
  viewerId: string,
  fileIds: string[]
): Promise<boolean> {
  if (fileIds.length === 0) return false;
  const rows = await db
    .select({
      id: files.id,
      userId: files.userId,
      organizationId: files.organizationId,
    })
    .from(files)
    .where(inArray(files.id, fileIds));
  if (rows.length !== fileIds.length) return false;

  const myOrgs = await getMembershipOrgIds(viewerId);
  return rows.every((r) => {
    if (r.userId === viewerId) return true;
    if (r.organizationId && myOrgs.has(r.organizationId)) return true;
    return false;
  });
}

/**
 * Read-access check for org-owned listings. Public visibility falls
 * through to the standard "anyone can see"; private + org-owned
 * narrows to members of the owning org. The existing per-feature
 * entitlement helpers (lib/entitlement.ts) call into this once to
 * decide whether to hide a private org row from a non-member.
 */
export async function viewerCanSeeOrgRow(
  viewerId: string | null,
  row: { visibility: "public" | "private"; organizationId: string | null; userId: string }
): Promise<boolean> {
  if (row.visibility === "public") return true;
  if (!viewerId) return false;
  if (row.organizationId) {
    const { member } = await isOrgMember(viewerId, row.organizationId);
    return member;
  }
  return row.userId === viewerId;
}

/**
 * Returns the orgs the viewer belongs to, with display info pulled
 * from the local mirror. Used by the Owner picker on create forms
 * and the org switcher dropdown — both want { id, slug, name,
 * imageUrl } for every org the viewer can act inside.
 */
export async function listViewerOrgs(viewerId: string): Promise<
  Array<{ id: string; slug: string; name: string; imageUrl: string | null; role: Role }>
> {
  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      imageUrl: organizations.imageUrl,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, viewerId));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}
