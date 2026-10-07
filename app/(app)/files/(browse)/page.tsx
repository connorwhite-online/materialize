import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  files,
  filePhotos,
  users,
  projects,
  projectFiles,
  projectPhotos,
  collections,
  collectionItems,
} from "@/lib/db/schema";
import { eq, desc, ilike, and, or, sql, inArray, isNotNull, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Page } from "@/components/ui/page";
import { Browse } from "@/components/icons/browse";
import { UserAvatar } from "@/components/auth/user-avatar";
import { BrowseSearchBar } from "@/components/browse/browse-search-bar";
import { CategoryFilterBar } from "@/components/browse/category-filter-bar";
import { arrayTextIlike } from "@/lib/db/search";
import {
  categoryIdsMatchingQuery,
  isCategoryId,
  getCategoryById,
} from "@/lib/categories";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";
import {
  rankBrowseRows,
  rankOrderedRows,
  rankSearchRows,
} from "@/lib/discovery";
import {
  BROWSE_FILES_SHOWN,
  fetchFileCandidatePool,
  fileCandidateColumns,
  fileNotInAnyProjectCondition,
} from "@/lib/discovery/browse-pool";
import { recentDownloadCounts } from "@/lib/discovery/signals";
import { ProjectCoverFallback } from "@/components/projects/project-cover-fallback";
import {
  FileCard,
  FileCardCreator,
  FileCardDownloads,
  FileCardPriceBadge,
  fileCardPhotoUrls,
  FILE_CARD_BODY_CLASS,
  FILE_CARD_LINK_CLASS,
  FILE_CARD_SHELL_CLASS,
  FILE_CARD_TITLE_CLASS,
  FILE_CARD_WELL_CLASS,
} from "@/components/files/file-card";
import { FolderOpenIcon, SearchIcon } from "@/components/icons/oai";

// Shared with the ranking inspector, which marks this cutoff — see
// BROWSE_FILES_SHOWN. Also the per-section cap for projects,
// collections and creators, which the inspector doesn't cover.
const PER_SECTION = BROWSE_FILES_SHOWN;

/**
 * Pool sizes for the ranked sections. Ranking can only reorder what it
 * is given, so each section fetches several times what it renders —
 * fetch exactly PER_SECTION and the SQL's ORDER BY is still the real
 * ranker. The file pools live in `lib/discovery/browse-pool` because
 * the ranking inspector reads the same ones.
 */
const PROJECT_POOL = 36;
/**
 * Pool size per section on the active search/filter path. Same reason
 * as the idle pools: the ranker needs more rows than it renders, and
 * an ILIKE scan's cost is the scan, not the number of rows it returns.
 */
const SEARCH_POOL = PER_SECTION * 4;
/** Projects rendered on the idle grid (a subset of PROJECT_POOL). */
const PROJECTS_SHOWN = 12;
/**
 * Below this length we prefix-match (`x%`) instead of substring
 * (`%x%`) — the same threshold the live home search uses. Single-
 * char substring scans are pathologically wide; prefix is cheap.
 */
const PREFIX_ONLY_LENGTH = 2;

/**
 * Cache tag for the idle-browse (`!active`) grid below. Bumped by
 * updateTag() from app/actions/files.ts and app/actions/projects.ts
 * on any mutation that changes what's eligible for this globally-
 * shared grid (publish, archive, delete, visibility toggle). Kept as a
 * plain string constant (not exported) rather than shared from this
 * file, because `next build` rejects any non-reserved named export
 * from a page.tsx file — the action files re-declare the same literal
 * with a comment pointing back here.
 */
const IDLE_BROWSE_CACHE_TAG = "idle-browse";
/**
 * Modest TTL for the idle-browse grid — it's identical for every
 * anonymous hit (no viewer-specific data), so caching collapses N
 * concurrent Neon round trips into one per window. updateTag keeps
 * publish/unpublish/delete feeling instant despite the TTL.
 */
const IDLE_BROWSE_CACHE_TTL_SECONDS = 120;

/**
 * Idle-browse (`!active`) data: ranked files + projects + creators.
 *
 * "Recent" used to be accurate here and stopped being so long before
 * this change — the files query has ordered by `downloadCount` for a
 * while. It is now explicitly ranked (`lib/discovery`), and the names
 * say so.
 * Globally identical for every anonymous hit — no query/category/
 * viewer input — so it's a single cache entry for the whole site
 * rather than 6 fresh Neon round trips per hit (PERF-16). Mirrors the
 * unstable_cache shape in app/api/search/route.ts:119, plus
 * updateTag so publish/archive/delete don't wait out the TTL.
 */
const getIdleBrowseData = unstable_cache(
  async () => {
    const [filePool, projectPool, recentCreators] = await Promise.all([
      fetchFileCandidatePool(),
      db
        .select({
          id: projects.id,
          slug: projects.slug,
          name: projects.name,
          thumbnailUrl: projects.thumbnailUrl,
          coverPhotoId: projects.coverPhotoId,
          creatorUsername: users.username,
          creatorDisplayName: users.displayName,
          creatorAvatarUrl: users.avatarUrl,
          fileCount: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
        })
        .from(projects)
        .innerJoin(users, eq(projects.userId, users.id))
        .leftJoin(projectFiles, eq(projectFiles.projectId, projects.id))
        .where(
          and(
            eq(projects.status, "published"),
            eq(projects.visibility, "public")
          )
        )
        .groupBy(projects.id, users.username, users.displayName, users.avatarUrl, projects.createdAt)
        .orderBy(desc(projects.createdAt))
        .limit(PROJECT_POOL),
      db
        .selectDistinctOn([users.id], {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .innerJoin(files, eq(files.userId, users.id))
        .where(and(eq(files.status, "published"), eq(files.visibility, "public")))
        .orderBy(users.id, desc(files.createdAt))
        .limit(12),
    ]);

    const rankedFiles = rankBrowseRows(filePool, {
      creatorKey: (f) => f.username,
      limit: PER_SECTION,
    });
    // Projects have no download signal of their own, so they keep their
    // recency order and only get the creator spread.
    const rankedProjects = rankOrderedRows(projectPool, {
      creatorKey: (p) => p.creatorUsername,
      limit: PROJECTS_SHOWN,
    });

    // Photo hydration runs on the ranked survivors, never the pool —
    // it is one query per section either way, but the IN-list stays
    // proportional to what is rendered.
    const [photosByFile, photosByProject, thumbnailsByProject] = await Promise.all([
      fetchAdditionalPhotosByFile(rankedFiles),
      fetchAdditionalPhotosByProject(rankedProjects),
      fetchFileThumbnailsByProject(rankedProjects.map((p) => p.id)),
    ]);

    // Project down to exactly what the grid renders, rather than
    // spreading the candidate row. The ranking-only columns
    // (`createdAt`, `category`, `tags`, `designTags`) have done their
    // job by now, and `createdAt` is a Date: this return value is
    // serialized into the Next data cache, so a Date left in it comes
    // back from a cache hit as an ISO string, typed as a Date and
    // wrong only on the second request. Nothing downstream reads it
    // today — which is exactly why it would be found late.
    const filesWithPhotos: FileRow[] = rankedFiles.map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      price: f.price,
      thumbnailUrl: f.thumbnailUrl,
      coverPhotoId: f.coverPhotoId,
      downloadCount: f.downloadCount,
      username: f.username,
      displayName: f.displayName,
      avatarUrl: f.avatarUrl,
      additionalPhotoIds: photosByFile.get(f.id) ?? [],
    }));
    const projectsWithPhotos: ProjectRow[] = rankedProjects.map((p) => ({
      ...p,
      additionalPhotoIds: photosByProject.get(p.id) ?? [],
      fileThumbnails: thumbnailsByProject.get(p.id) ?? [],
    }));

    return { filesWithPhotos, projectsWithPhotos, recentCreators };
  },
  ["idle-browse-grid"],
  { revalidate: IDLE_BROWSE_CACHE_TTL_SECONDS, tags: [IDLE_BROWSE_CACHE_TAG] }
);
const MAX_QUERY_LENGTH = 100;

function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Batch-fetch curator photos for a set of file ids, returning a
 * fileId → additionalPhotoIds map (cover photo excluded). Single
 * IN-array query keeps cost proportional to total photo count
 * rather than file count.
 */
async function fetchAdditionalPhotosByFile(
  rows: Array<{ id: string; coverPhotoId: string | null }>
): Promise<Map<string, string[]>> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map();
  const photos = await db
    .select({ id: filePhotos.id, fileId: filePhotos.fileId })
    .from(filePhotos)
    .where(
      and(
        inArray(filePhotos.fileId, ids),
        eq(filePhotos.kind, "creator")
      )
    )
    .orderBy(filePhotos.sortOrder);

  const grouped = new Map<string, string[]>();
  for (const p of photos) {
    if (!p.fileId) continue;
    const arr = grouped.get(p.fileId) ?? [];
    arr.push(p.id);
    grouped.set(p.fileId, arr);
  }

  // Strip the cover photo id from each list so the carousel's
  // first slot (the cover via /api/thumbnails/{id}) doesn't
  // duplicate.
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const all = grouped.get(row.id) ?? [];
    result.set(
      row.id,
      row.coverPhotoId ? all.filter((id) => id !== row.coverPhotoId) : all
    );
  }
  return result;
}

/** Project-side mirror of `fetchAdditionalPhotosByFile`. */
async function fetchAdditionalPhotosByProject(
  rows: Array<{ id: string; coverPhotoId: string | null }>
): Promise<Map<string, string[]>> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map();
  const photos = await db
    .select({ id: projectPhotos.id, projectId: projectPhotos.projectId })
    .from(projectPhotos)
    .where(
      and(
        inArray(projectPhotos.projectId, ids),
        eq(projectPhotos.kind, "creator")
      )
    )
    .orderBy(projectPhotos.sortOrder);

  const grouped = new Map<string, string[]>();
  for (const p of photos) {
    if (!p.projectId) continue;
    const arr = grouped.get(p.projectId) ?? [];
    arr.push(p.id);
    grouped.set(p.projectId, arr);
  }
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const all = grouped.get(row.id) ?? [];
    result.set(
      row.id,
      row.coverPhotoId ? all.filter((id) => id !== row.coverPhotoId) : all
    );
  }
  return result;
}

/**
 * Fetch up to 3 file thumbnail URLs per project (files that have a thumbnail),
 * ordered by download count so the most recognisable image goes on top.
 */
async function fetchFileThumbnailsByProject(
  projectIds: string[]
): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: projectFiles.projectId,
      fileId: files.id,
    })
    .from(projectFiles)
    .innerJoin(files, eq(files.id, projectFiles.fileId))
    .where(
      and(
        inArray(projectFiles.projectId, projectIds),
        isNotNull(files.thumbnailUrl)
      )
    )
    .orderBy(desc(files.downloadCount));

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.projectId || !row.fileId) continue;
    const arr = grouped.get(row.projectId) ?? [];
    if (arr.length < 3) {
      arr.push(`/api/thumbnails/${row.fileId}`);
    }
    grouped.set(row.projectId, arr);
  }
  return grouped;
}

/**
 * Browse-page metadata, and the index hygiene that goes with it.
 *
 * This page had no metadata at all, so the marketplace — the most
 * commercially important indexable surface on the site — inherited the
 * generic site title and was indistinguishable from every other route
 * in a SERP.
 *
 * The three states are treated differently on purpose:
 *
 * - **Bare `/files`** — the canonical browse page. Indexable, self-
 *   canonical.
 * - **`?category=<slug>`** — a curated facet with a finite, known set
 *   of values (`lib/categories`). These are genuinely useful landing
 *   pages for "3d print files for X" queries, so they stay indexable
 *   with their own title/description and a canonical that keeps the
 *   category param.
 * - **`?q=<free text>`** — an internal search-results page over an
 *   unbounded input space. Google's own guidance is to keep these out
 *   of the index; left crawlable they generate effectively infinite
 *   thin, near-duplicate URLs and dilute the crawl budget of a domain
 *   that has very little to spare. `noindex, follow` — the links on
 *   the page still pass through to real listings.
 */
export async function generateMetadata(props: {
  searchParams: Promise<{ q?: string; category?: string }>;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const rawQ = (searchParams.q ?? "").trim();
  const rawCategory = (searchParams.category ?? "").trim();
  const activeCategory = isCategoryId(rawCategory)
    ? getCategoryById(rawCategory)
    : undefined;

  if (rawQ.length > 0) {
    return {
      title: "Search 3D print files",
      description:
        "Search thousands of 3D-print files from independent creators on Materialize.",
      robots: { index: false, follow: true },
    };
  }

  if (activeCategory) {
    const title = `${activeCategory.label} 3D Print Files`;
    const description = `${activeCategory.description} Download or buy ${activeCategory.label.toLowerCase()} 3D models on Materialize, or have any of them printed on demand and shipped to you.`;
    return {
      title,
      description,
      alternates: { canonical: `/files?category=${activeCategory.id}` },
      openGraph: { type: "website", title, description },
    };
  }

  const title = "Browse 3D Print Files";
  const description =
    "Browse and download 3D-print files from independent creators — STL, OBJ, 3MF and STEP models across decor, functional parts, hobby, RC and more. Buy a design or have it printed on demand and shipped.";
  return {
    title,
    description,
    alternates: { canonical: "/files" },
    openGraph: { type: "website", title, description },
  };
}

export default async function BrowsePage(props: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const searchParams = await props.searchParams;
  const rawQ = (searchParams.q ?? "").trim();
  const query =
    rawQ.length > 0 && rawQ.length <= MAX_QUERY_LENGTH ? rawQ : "";
  const pattern = query
    ? query.length < PREFIX_ONLY_LENGTH
      ? `${escapeLikePattern(query)}%`
      : `%${escapeLikePattern(query)}%`
    : null;

  // Validate the category against the catalog so a stale / hand-typed
  // slug can't poison the query — unknown values fall through to "no
  // category filter" rather than returning an empty page.
  const rawCategory = (searchParams.category ?? "").trim();
  const category = isCategoryId(rawCategory) ? rawCategory : "";
  const activeCategory = getCategoryById(category);

  // Browse is "active" once there's either a text query OR a category
  // filter. Anything less is the idle recent-content grid.
  const active = !!pattern || !!category;

  // The header (title, search field, category chips) is shared across
  // states; only the title line changes to say what is being browsed.
  const header = (
    <BrowseHeader
      title={
        query
          ? `Results for “${query}”`
          : activeCategory
            ? activeCategory.label
            : "Explore"
      }
      description={
        query
          ? activeCategory
            ? `In ${activeCategory.label}`
            : undefined
          : activeCategory
            ? activeCategory.description
            : "Models, projects and creators from the community. Download them or get them printed."
      }
      query={query}
      category={category}
    />
  );

  // Idle state: recent projects + files + creators grid below the header.
  // Globally-identical content (no per-viewer data) — cached in
  // getIdleBrowseData() so an anonymous-hit stampede shares one Neon
  // round trip per IDLE_BROWSE_CACHE_TTL_SECONDS window (PERF-16).
  if (!active) {
    const { filesWithPhotos, projectsWithPhotos, recentCreators } =
      await getIdleBrowseData();

    return (
      <Page width="wide" className="gap-10">
        {header}

        <Section title="Files">
          {filesWithPhotos.length === 0 ? (
            <EmptyState
              icon={<Browse />}
              title="No files published yet"
              description="Upload a model and list it for the community."
            />
          ) : (
            <FileGrid files={filesWithPhotos} />
          )}
        </Section>

        {projectsWithPhotos.length > 0 && (
          <Section title="Projects">
            <div className={GRID_CLASS}>
              {projectsWithPhotos.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </Section>
        )}

        {recentCreators.length > 0 && (
          <Section title="Creators">
            <CreatorList users={recentCreators} />
          </Section>
        )}
      </Page>
    );
  }

  // Files bundled into a project are surfaced under that project, not as
  // standalone entries in the Files section. Correlated NOT EXISTS so a
  // file with any project membership drops out. Only needed from here
  // down (the active search/filter path) — the idle path above builds
  // its own copy inside the cached getIdleBrowseData().
  const fileNotInAnyProject = fileNotInAnyProjectCondition();

  // Categories whose label / keywords match the text query, so a search
  // for "drone" or "gps" also surfaces everything filed under Hobby &
  // RC even when the item's own name says neither.
  const matchedCategoryIds = pattern ? categoryIdsMatchingQuery(query) : [];

  // Per-section text-match clause: name OR any tag OR any design tag OR
  // (the matched-category bridge). Undefined when there's no text query
  // (category-only browse), which drizzle's `and`/`or` simply skip.
  const fileMatch: SQL | undefined = pattern
    ? or(
        ilike(files.name, pattern),
        arrayTextIlike(files.tags, pattern),
        arrayTextIlike(files.designTags, pattern),
        ...(matchedCategoryIds.length
          ? [inArray(files.category, matchedCategoryIds)]
          : [])
      )
    : undefined;
  const projectMatch: SQL | undefined = pattern
    ? or(
        ilike(projects.name, pattern),
        arrayTextIlike(projects.tags, pattern),
        arrayTextIlike(projects.designTags, pattern),
        ...(matchedCategoryIds.length
          ? [inArray(projects.category, matchedCategoryIds)]
          : [])
      )
    : undefined;
  const collectionMatch: SQL | undefined = pattern
    ? or(
        ilike(collections.name, pattern),
        arrayTextIlike(collections.tags, pattern),
        ...(matchedCategoryIds.length
          ? [inArray(collections.category, matchedCategoryIds)]
          : [])
      )
    : undefined;

  // Creators are only relevant to a text search — a category-only
  // browse shouldn't dump every user, so skip the query entirely then.
  const userQuery = pattern
    ? db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(
          or(ilike(users.username, pattern), ilike(users.displayName, pattern))
        )
        .limit(PER_SECTION)
    : Promise.resolve([] as UserRow[]);

  // Search/browse state: sections in parallel. Materials are intentionally
  // excluded — they have their own /materials page with rich filters.
  const [filePool, projectPool, collectionPool, userRows] = await Promise.all([
    db
      .select(fileCandidateColumns)
      .from(files)
      .innerJoin(users, eq(files.userId, users.id))
      .where(
        and(
          eq(files.status, "published"),
          eq(files.visibility, "public"),
          fileMatch,
          category ? eq(files.category, category) : undefined,
          fileNotInAnyProject
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
        coverPhotoId: projects.coverPhotoId,
        category: projects.category,
        tags: projects.tags,
        designTags: projects.designTags,
        creatorUsername: users.username,
        creatorDisplayName: users.displayName,
        creatorAvatarUrl: users.avatarUrl,
        fileCount: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
      })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .leftJoin(projectFiles, eq(projectFiles.projectId, projects.id))
      .where(
        and(
          eq(projects.status, "published"),
          eq(projects.visibility, "public"),
          projectMatch,
          category ? eq(projects.category, category) : undefined
        )
      )
      .groupBy(
        projects.id,
        users.username,
        users.displayName,
        users.avatarUrl,
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
          collectionMatch,
          category ? eq(collections.category, category) : undefined
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
    userQuery,
  ]);

  // Rank the pools. Which ranker applies depends on what the viewer
  // actually asked for, and the distinction matters: with a text query
  // the question is "how well does this match", and popularity is only
  // a tiebreak; with a category chip and no text there is nothing to
  // match against, so the section is a shelf and ranks like the idle
  // grid does.
  const matchedCategorySet = new Set(matchedCategoryIds);
  const withCategoryHit = <T extends { category: string | null }>(row: T) => ({
    ...row,
    matchedCategory: !!row.category && matchedCategorySet.has(row.category),
  });

  let fileRows;
  if (query) {
    fileRows = rankSearchRows(query, filePool.map(withCategoryHit), {
      creatorKey: (f) => f.username,
      limit: PER_SECTION,
    });
  } else {
    const recentDownloads = await recentDownloadCounts(
      filePool.map((f) => f.id)
    );
    fileRows = rankBrowseRows(
      filePool.map((f) => ({
        ...f,
        recentDownloads: recentDownloads.get(f.id) ?? 0,
      })),
      { creatorKey: (f) => f.username, limit: PER_SECTION }
    );
  }

  const projectRows = query
    ? rankSearchRows(query, projectPool.map(withCategoryHit), {
        creatorKey: (p) => p.creatorUsername,
        limit: PER_SECTION,
      })
    : rankOrderedRows(projectPool, {
        creatorKey: (p) => p.creatorUsername,
        limit: PER_SECTION,
      });

  const collectionRows = query
    ? rankSearchRows(query, collectionPool.map(withCategoryHit), {
        creatorKey: (c) => c.creatorUsername,
        limit: PER_SECTION,
      })
    : rankOrderedRows(collectionPool, {
        creatorKey: (c) => c.creatorUsername,
        limit: PER_SECTION,
      });

  const [photosByFile, photosByProject, thumbnailsByProject] = await Promise.all([
    fetchAdditionalPhotosByFile(fileRows),
    fetchAdditionalPhotosByProject(projectRows),
    fetchFileThumbnailsByProject(projectRows.map((p) => p.id)),
  ]);
  const fileRowsWithPhotos: FileRow[] = fileRows.map((f) => ({
    ...f,
    additionalPhotoIds: photosByFile.get(f.id) ?? [],
  }));
  const projectRowsWithPhotos: ProjectRow[] = projectRows.map((p) => ({
    ...p,
    additionalPhotoIds: photosByProject.get(p.id) ?? [],
    fileThumbnails: thumbnailsByProject.get(p.id) ?? [],
  }));

  const totalHits =
    fileRows.length +
    projectRows.length +
    collectionRows.length +
    userRows.length;

  // What we're browsing, for the empty-state copy.
  const scopeLabel = query
    ? `\u201c${query}\u201d`
    : activeCategory
      ? activeCategory.label
      : "";

  return (
    <Page width="wide" className="gap-10">
      {totalHits === 0 ? (
        // The empty state below already says "No results for …", so the
        // title doesn't repeat the query back a second time.
        <BrowseHeader
          title={activeCategory && !query ? activeCategory.label : "Explore"}
          description={activeCategory && !query ? activeCategory.description : undefined}
          query={query}
          category={category}
        />
      ) : (
        header
      )}

      {totalHits === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={
            query ? <>No results for {scopeLabel}</> : <>Nothing in {scopeLabel} yet</>
          }
          description={
            query
              ? "Try a shorter search, a different spelling, or another category."
              : "Be the first to list something here, or browse everything."
          }
          action={
            <Button variant="secondary" render={<Link href="/files" />}>
              {query ? "Clear search" : "Browse everything"}
            </Button>
          }
        />
      ) : (
        <>
          {userRows.length > 0 && (
            <Section title="Creators" count={userRows.length}>
              <CreatorList users={userRows} />
            </Section>
          )}

          {fileRowsWithPhotos.length > 0 && (
            <Section title="Files" count={fileRowsWithPhotos.length}>
              <FileGrid files={fileRowsWithPhotos} />
            </Section>
          )}

          {projectRowsWithPhotos.length > 0 && (
            <Section title="Projects" count={projectRowsWithPhotos.length}>
              <div className={GRID_CLASS}>
                {projectRowsWithPhotos.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </Section>
          )}

          {collectionRows.length > 0 && (
            <Section title="Collections" count={collectionRows.length}>
              <div className={GRID_CLASS}>
                {collectionRows.map((c) => (
                  <CollectionCard key={c.id} collection={c} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}

/**
 * One grid for every tile type so files, projects and collections line
 * up column for column. Borderless tiles need more vertical air than
 * boxed cards did, hence the larger row gap.
 */
const GRID_CLASS =
  "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5";

function BrowseHeader({
  title,
  description,
  query,
  category,
}: {
  title: string;
  description?: string;
  query: string;
  category: string;
}) {
  return (
    <header className="flex flex-col gap-5">
      <div className="min-w-0">
        <h1 className="truncate text-2xl leading-7 font-semibold">{title}</h1>
        {description && (
          <p className="mt-1 text-sm leading-5 text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <BrowseSearchBar key={query} defaultValue={query} category={category} />
        <CategoryFilterBar active={category} query={query} />
      </div>
    </header>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-baseline gap-2 text-base leading-6 font-semibold">
        {title}
        {count != null && (
          <span className="text-sm font-normal text-subtle-foreground tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

interface FileRow {
  id: string;
  name: string;
  slug: string;
  price: number;
  thumbnailUrl: string | null;
  coverPhotoId: string | null;
  additionalPhotoIds: string[];
  downloadCount: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

function FileGrid({ files }: { files: FileRow[] }) {
  return (
    <div className={GRID_CLASS}>
      {files.map((file) => (
        <FileCard
          key={file.id}
          href={`/files/${file.slug}`}
          title={file.name}
          images={fileCardPhotoUrls(
            file.id,
            file.thumbnailUrl,
            file.additionalPhotoIds
          )}
          overlay={<FileCardPriceBadge priceCents={file.price} />}
          subtitle={
            <FileCardCreator
              username={file.username}
              displayName={file.displayName}
              avatarUrl={file.avatarUrl}
            />
          }
          meta={<FileCardDownloads count={file.downloadCount} />}
        />
      ))}
    </div>
  );
}

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  coverPhotoId?: string | null;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
  creatorAvatarUrl: string | null;
  fileCount: number;
  additionalPhotoIds: string[];
  fileThumbnails: string[];
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const hasAnyImage =
    !!project.thumbnailUrl || project.additionalPhotoIds.length > 0;
  const thumbs = project.fileThumbnails;
  return (
    <Link href={`/projects/${project.slug}`} className={FILE_CARD_LINK_CLASS}>
      <Card className={FILE_CARD_SHELL_CLASS}>
        <div className={FILE_CARD_WELL_CLASS}>
          {hasAnyImage ? (
            <CardImageCarousel
              images={[
                `/api/thumbnails/projects/${project.id}`,
                ...project.additionalPhotoIds.map(
                  (id) =>
                    `/api/thumbnails/projects/${project.id}?photoId=${id}`
                ),
              ]}
              alt=""
              size="sm"
            />
          ) : thumbs.length === 0 ? (
            <ProjectCoverFallback size="sm" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {/* Stacked-file placeholder */}
              <div className="relative h-28 w-24">
                {/* Back card */}
                {thumbs[2] ? (
                  <div className="absolute inset-0 translate-x-2.5 translate-y-2 rotate-6 overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbs[2]} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="absolute inset-0 translate-x-2.5 translate-y-2 rotate-6 rounded-md border border-border bg-muted/60" />
                )}
                {/* Middle card */}
                {thumbs[1] ? (
                  <div className="absolute inset-0 translate-x-1 translate-y-1 rotate-3 overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbs[1]} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="absolute inset-0 translate-x-1 translate-y-1 rotate-3 rounded-md border border-border bg-muted/80" />
                )}
                {/* Front card */}
                {thumbs[0] ? (
                  <div className="absolute inset-0 overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbs[0]} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="absolute inset-0 rounded-md border border-border bg-muted flex items-center justify-center">
                    <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                      {project.fileCount > 0 ? `${project.fileCount}` : "—"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <CardContent className={FILE_CARD_BODY_CLASS}>
          <h3 className={FILE_CARD_TITLE_CLASS}>
            {project.name}
          </h3>
          <FileCardCreator
            username={project.creatorUsername}
            displayName={project.creatorDisplayName}
            avatarUrl={project.creatorAvatarUrl}
          />
          <p className="mt-1 text-xs text-subtle-foreground tabular-nums">
            {project.fileCount === 0
              ? "Project"
              : `Project · ${project.fileCount} ${project.fileCount === 1 ? "file" : "files"}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface CollectionRow {
  id: string;
  slug: string;
  name: string;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
  fileCount: number;
}

function CollectionCard({ collection }: { collection: CollectionRow }) {
  return (
    <Link href={`/collections/${collection.slug}`} className={FILE_CARD_LINK_CLASS}>
      <Card className={FILE_CARD_SHELL_CLASS}>
        <div className={`flex items-center justify-center text-subtle-foreground ${FILE_CARD_WELL_CLASS}`}>
          <FolderOpenIcon size={28} />
        </div>
        <CardContent className={FILE_CARD_BODY_CLASS}>
          <h3 className={FILE_CARD_TITLE_CLASS}>
            {collection.name}
          </h3>
          <p className="mt-0.5 truncate text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {collection.fileCount}{" "}
            {collection.fileCount === 1 ? "file" : "files"}
            {(collection.creatorDisplayName || collection.creatorUsername) &&
              " · "}
            {collection.creatorDisplayName ||
              collection.creatorUsername ||
              ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface UserRow {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Creators as list rows (the rulebook's row anatomy: 40px avatar, name,
 * handle), laid out in columns. They used to be floating shadowed
 * bubbles that read as buttons rather than people.
 */
function CreatorList({ users }: { users: UserRow[] }) {
  return (
    <ul className="-mx-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {users.map((u) =>
        u.username ? (
          <li key={u.id}>
            <Link
              href={`/${u.username}`}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserAvatar
                seed={u.username}
                imageUrl={u.avatarUrl}
                displayName={u.displayName || u.username}
                className="size-10 shrink-0 text-base"
              />
              <div className="min-w-0">
                <p className="truncate text-sm leading-5 font-medium">
                  {u.displayName || u.username}
                </p>
                <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
                  @{u.username}
                </p>
              </div>
            </Link>
          </li>
        ) : null
      )}
    </ul>
  );
}
