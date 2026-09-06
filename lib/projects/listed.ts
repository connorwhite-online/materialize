import { sql } from "drizzle-orm";
import { projectFiles, projects } from "@/lib/db/schema";

/**
 * SQL predicate: the project has at least one bundled file.
 *
 * Visitor-facing listings combine this with published + public so a
 * public empty shell stays owner-only. The owner can create the
 * project first and add files later; it does not appear to anyone
 * else until then.
 */
export function projectHasBundledFile() {
  return sql`exists (
    select 1
    from ${projectFiles}
    where ${projectFiles.projectId} = ${projects.id}
  )`;
}

/**
 * JS twin of the listing gate — use when the row is already loaded.
 * `fileCount` is the number of `project_files` rows (0 = empty shell).
 */
export function isProjectListedToOthers(params: {
  status: string;
  visibility: string;
  fileCount: number;
}): boolean {
  return (
    params.status === "published" &&
    params.visibility === "public" &&
    Number(params.fileCount) > 0
  );
}
