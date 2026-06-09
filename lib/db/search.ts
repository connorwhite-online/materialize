import { sql, type SQL, type AnyColumn } from "drizzle-orm";

/**
 * Case-insensitive substring match against any element of a Postgres
 * `text[]` column. Drizzle's `ilike` only works on scalar text, so a
 * search over `files.tags` / `projects.designTags` needs this: unnest
 * the array and ask whether ANY element ilike-matches the pattern.
 *
 *   exists (select 1 from unnest("tags") elem where elem ilike $pattern)
 *
 * NULL arrays unnest to zero rows, so the EXISTS is simply false — no
 * special-casing needed for rows that never set the column. The
 * `pattern` is the same `%needle%` / `needle%` string used with
 * `ilike` elsewhere, so wildcard escaping is the caller's job (it
 * already happens at the search-bar boundary).
 *
 * This is why "gps" now matches a project tagged "gps": the browse
 * query previously only ilike'd the name column and never looked at
 * the tags array at all.
 */
export function arrayTextIlike(column: AnyColumn, pattern: string): SQL {
  return sql`exists (select 1 from unnest(${column}) as elem where elem ilike ${pattern})`;
}
