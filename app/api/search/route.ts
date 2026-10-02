import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  files,
  users,
  projects,
  projectFiles,
  collections,
  collectionItems,
} from "@/lib/db/schema";
import { and, eq, ilike, or, desc, sql, inArray } from "drizzle-orm";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { arrayTextIlike } from "@/lib/db/search";
import { categoryIdsMatchingQuery } from "@/lib/categories";
import { logError } from "@/lib/logger";
import { rankSearchRows } from "@/lib/discovery";

const PER_CATEGORY_LIMIT = 8;
/**
 * Rows fetched per type before ranking. The typeahead shows
 * PER_CATEGORY_LIMIT, but ranking can only reorder what it was given —
 * fetch exactly 8 and `ORDER BY created_at DESC` is still choosing the
 * results, with the ranker only shuffling whichever 8 happened to be
 * newest. The extra rows are close to free: an ILIKE scan pays for the
 * scan, not for the rows it returns.
 */
const SEARCH_POOL = PER_CATEGORY_LIMIT * 5;
/**
 * Short cache window for the DB half of search. The home bar fires a
 * request on every keystroke and crawlers/agents replay popular
 * queries, so identical queries repeat constantly. Search results are
 * global (published/public, not per-viewer), so a query string is a
 * complete cache key and a 60s TTL collapses those duplicates into one
 * set of substring ILIKE scans per minute — the single biggest lever
 * on search's Neon cost short of adding a trigram index. 60s of
 * staleness (a brand-new listing not appearing instantly in search) is
 * imperceptible for this surface.
 */
const SEARCH_CACHE_TTL_SECONDS = 60;
/** Drop empty queries; one character is fine — see PREFIX_ONLY_LENGTH. */
const MIN_QUERY_LENGTH = 1;
/** Cap query length to prevent pathological regex-like patterns. */
const MAX_QUERY_LENGTH = 100;
/**
 * Below this length we match by PREFIX (`x%`) rather than substring
 * (`%x%`). A single character substring scans far too many rows to be
 * useful — typing "c" would otherwise return everything containing
 * the letter c. Prefix matching keeps the result set scoped to "things
 * that start with c" (Instagram-style filter) and is much cheaper for
 * the DB. Two characters and up, substring works as expected.
 */
const PREFIX_ONLY_LENGTH = 2;

/**
 * Escape ilike wildcards so a user typing `%` or `_` can't turn
 * their substring into a catch-all pattern (or a very slow one).
 * Backslash-escape the three chars that Postgres treats specially.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export interface SearchHitFile {
  type: "file";
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
}

export interface SearchHitUser {
  type: "user";
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SearchHitMaterial {
  type: "material";
  id: string;
  slug: string;
  name: string;
  groupName: string;
  featuredImage: string | null;
}

export interface SearchHitProject {
  type: "project";
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  fileCount: number;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
}

export interface SearchHitCollection {
  type: "collection";
  id: string;
  slug: string;
  name: string;
  fileCount: number;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
}

export interface SearchResponse {
  files: SearchHitFile[];
  projects: SearchHitProject[];
  collections: SearchHitCollection[];
  users: SearchHitUser[];
  materials: SearchHitMaterial[];
}

/**
 * The DB half of search: the four substring-ILIKE scans (files,
 * projects, collections, users). Pulled out and wrapped in
 * `unstable_cache` so identical query strings — which the keystroke-
 * driven home bar and crawlers produce in bulk — reuse one result set
 * for SEARCH_CACHE_TTL_SECONDS instead of re-scanning every time.
 * Purely a function of the query string; results are global, so the
 * query is a complete cache key.
 */
const searchDb = unstable_cache(
  async (q: string) => {
    // Escape %/_/\\ so user input can't function as ilike wildcards,
    // then choose pattern shape based on query length.
    const escaped = escapeLikePattern(q);
    const isPrefixOnly = q.length < PREFIX_ONLY_LENGTH;
    const pattern = isPrefixOnly ? `${escaped}%` : `%${escaped}%`;
    // Categories whose label/keywords match the query bridge into the
    // results (e.g. "drone" surfaces the Hobby & RC shelf). Empty list →
    // the inArray clause is simply omitted below.
    const matchedCategoryIds = categoryIdsMatchingQuery(q);

    const [fileRows, projectRows, collectionRows, userRows] = await Promise.all([
      db
        .select({
          id: files.id,
          slug: files.slug,
          name: files.name,
          thumbnailUrl: files.thumbnailUrl,
          category: files.category,
          tags: files.tags,
          designTags: files.designTags,
          downloadCount: files.downloadCount,
          creatorUsername: users.username,
          creatorDisplayName: users.displayName,
        })
        .from(files)
        .innerJoin(users, eq(files.userId, users.id))
        .where(
          and(
            eq(files.status, "published"),
            eq(files.visibility, "public"),
            or(
              ilike(files.name, pattern),
              arrayTextIlike(files.tags, pattern),
              arrayTextIlike(files.designTags, pattern),
              ...(matchedCategoryIds.length
                ? [inArray(files.category, matchedCategoryIds)]
                : [])
            )
          )
        )
        .orderBy(desc(files.createdAt))
        .limit(SEARCH_POOL),
      db
        .select({
          id: projects.id,
          slug: projects.slug,
          name: projects.name,
          thumbnailUrl: projects.thumbnailUrl,
          category: projects.category,
          tags: projects.tags,
          designTags: projects.designTags,
          creatorUsername: users.username,
          creatorDisplayName: users.displayName,
          fileCount: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
        })
        .from(projects)
        .innerJoin(users, eq(projects.userId, users.id))
        .leftJoin(projectFiles, eq(projectFiles.projectId, projects.id))
        .where(
          and(
            eq(projects.status, "published"),
            eq(projects.visibility, "public"),
            or(
              ilike(projects.name, pattern),
              arrayTextIlike(projects.tags, pattern),
              arrayTextIlike(projects.designTags, pattern),
              ...(matchedCategoryIds.length
                ? [inArray(projects.category, matchedCategoryIds)]
                : [])
            )
          )
        )
        .groupBy(
          projects.id,
          users.username,
          users.displayName,
          projects.createdAt
        )
        .orderBy(desc(projects.createdAt))
        .limit(SEARCH_POOL),
      db
        .select({
          id: collections.id,
          slug: collections.slug,
          name: collections.name,
          category: collections.category,
          tags: collections.tags,
          creatorUsername: users.username,
          creatorDisplayName: users.displayName,
          fileCount: sql<number>`cast(count(${collectionItems.fileId}) as int)`,
        })
        .from(collections)
        .innerJoin(users, eq(collections.userId, users.id))
        .leftJoin(
          collectionItems,
          eq(collectionItems.collectionId, collections.id)
        )
        .where(
          and(
            eq(collections.visibility, "public"),
            or(
              ilike(collections.name, pattern),
              arrayTextIlike(collections.tags, pattern),
              ...(matchedCategoryIds.length
                ? [inArray(collections.category, matchedCategoryIds)]
                : [])
            )
          )
        )
        .groupBy(
          collections.id,
          users.username,
          users.displayName,
          collections.createdAt
        )
        .orderBy(desc(collections.createdAt))
        .limit(SEARCH_POOL),
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(
          and(
            // Usernames are public, empty strings are impossible for
            // an onboarded user — safe to search directly.
            or(
              ilike(users.username, pattern),
              ilike(users.displayName, pattern)
            )
          )
        )
        .limit(PER_CATEGORY_LIMIT),
    ]);

    // Rank inside the cached helper so the cache entry holds the final
    // ordered slice: ranking is a pure function of (query, rows), so
    // there is nothing per-viewer to keep out of it.
    const matchedCategorySet = new Set(matchedCategoryIds);
    const withCategoryHit = <T extends { category: string | null }>(row: T) => ({
      ...row,
      matchedCategory: !!row.category && matchedCategorySet.has(row.category),
    });

    return {
      fileRows: rankSearchRows(q, fileRows.map(withCategoryHit), {
        creatorKey: (r) => r.creatorUsername,
        limit: PER_CATEGORY_LIMIT,
      }),
      projectRows: rankSearchRows(q, projectRows.map(withCategoryHit), {
        creatorKey: (r) => r.creatorUsername,
        limit: PER_CATEGORY_LIMIT,
      }),
      collectionRows: rankSearchRows(q, collectionRows.map(withCategoryHit), {
        creatorKey: (r) => r.creatorUsername,
        limit: PER_CATEGORY_LIMIT,
      }),
      userRows,
    };
  },
  ["global-search-db"],
  { revalidate: SEARCH_CACHE_TTL_SECONDS }
);

/**
 * Global search used by the home bottom bar. Returns up to
 * PER_CATEGORY_LIMIT hits per type. Each axis is independent —
 * materials search is in-memory over CraftCloud's cached catalog; the
 * file/project/collection/user scans run through the cached `searchDb`
 * helper above.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawQ = (url.searchParams.get("q") ?? "").trim();

  // Return empty instead of erroring on too-short/too-long queries —
  // the home search bar fires continuously as the user types, so we
  // want to no-op quietly below the threshold rather than flashing
  // an error.
  if (rawQ.length < MIN_QUERY_LENGTH || rawQ.length > MAX_QUERY_LENGTH) {
    return NextResponse.json<SearchResponse>({
      files: [],
      projects: [],
      collections: [],
      users: [],
      materials: [],
    });
  }

  const q = rawQ;
  const isPrefixOnly = q.length < PREFIX_ONLY_LENGTH;

  try {
    const [{ fileRows, projectRows, collectionRows, userRows }, catalog] =
      await Promise.all([searchDb(q), getCraftCloudCatalog()]);

    // Material search runs over the in-memory catalog. Match on
    // material name OR group name, case-insensitive. Mirror the
    // DB-side semantics: prefix for single-char queries, substring
    // for two or more.
    const needle = q.toLowerCase();
    const matches = isPrefixOnly
      ? (s: string) => s.toLowerCase().startsWith(needle)
      : (s: string) => s.toLowerCase().includes(needle);
    const materials: SearchHitMaterial[] = [];
    outer: for (const group of catalog.groups) {
      for (const material of group.materials) {
        const nameHit = matches(material.name);
        const groupHit = matches(group.name);
        if (!nameHit && !groupHit) continue;
        materials.push({
          type: "material",
          id: material.id,
          slug: material.slug,
          name: material.name,
          groupName: group.name,
          featuredImage: material.featuredImage ?? null,
        });
        if (materials.length >= PER_CATEGORY_LIMIT) break outer;
      }
    }

    const filesOut: SearchHitFile[] = fileRows.map((r) => ({
      type: "file",
      id: r.id,
      slug: r.slug,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      creatorUsername: r.creatorUsername,
      creatorDisplayName: r.creatorDisplayName,
    }));

    const projectsOut: SearchHitProject[] = projectRows.map((r) => ({
      type: "project",
      id: r.id,
      slug: r.slug,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      fileCount: r.fileCount,
      creatorUsername: r.creatorUsername,
      creatorDisplayName: r.creatorDisplayName,
    }));

    const collectionsOut: SearchHitCollection[] = collectionRows.map((r) => ({
      type: "collection",
      id: r.id,
      slug: r.slug,
      name: r.name,
      fileCount: r.fileCount,
      creatorUsername: r.creatorUsername,
      creatorDisplayName: r.creatorDisplayName,
    }));

    const usersOut: SearchHitUser[] = userRows
      .filter(
        (u): u is typeof u & { username: string } =>
          typeof u.username === "string" && u.username.length > 0
      )
      .map((r) => ({
        type: "user",
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
      }));

    return NextResponse.json<SearchResponse>({
      files: filesOut,
      projects: projectsOut,
      collections: collectionsOut,
      users: usersOut,
      materials,
    });
  } catch (error) {
    logError("api/search", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
