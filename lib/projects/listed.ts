/**
 * Visitor-facing listing gate for projects: published + public.
 *
 * A project does not need any bundled files to be listed. Plenty of
 * projects are boards, wiring and code with nothing to print, and the
 * creator can add an enclosure later. `fileCount` is accepted so call
 * sites that already load it keep compiling, but it no longer affects
 * the result.
 */
export function isProjectListedToOthers(params: {
  status: string;
  visibility: string;
  fileCount?: number;
}): boolean {
  return params.status === "published" && params.visibility === "public";
}
