/**
 * Pure access-resolution helper for the project detail page.
 *
 * Kept out of page.tsx because App Router page files may only export
 * the default component plus reserved route config (generateMetadata,
 * dynamic, etc.) — a plain helper export doesn't belong there. This
 * file has no such restriction, and the pure shape makes the
 * visibility decision unit-testable without spinning up the full
 * server component.
 */

/**
 * Can the viewer see this project at all? Public + published projects
 * are open to everyone; everything else (draft, private, archived)
 * requires write access — owner, org member, or per-project
 * collaborator, all folded into the single `canWrite` flag computed
 * via `canWriteProject` in the page.
 */
export function resolveProjectVisibility(params: {
  status: string;
  visibility: string;
  canWrite: boolean;
}): boolean {
  const isPublicPublished =
    params.status === "published" && params.visibility === "public";
  return isPublicPublished || params.canWrite;
}
