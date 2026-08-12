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
import { eq, desc, ilike, and, or, sql, inArray, isNotNull, notExists, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
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
import { Download } from "@/components/icons/download";
import { formatCompactCount } from "@/lib/utils/format-count";
import { getAvatarGradient } from "@/lib/utils/avatar-gradient";
import { FileTitleTooltip } from "@/components/browse/file-title-tooltip";

const PER_SECTION = 24;
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
 * Files bundled into a project are surfaced under that project, not as
 * standalone entries in the Files section. Correlated NOT EXISTS so a
 * file with any project membership drops out. Pure function of the
 * schema (no request-specific input), so it's safe to call both inside
 * the cached idle-browse fetch and in the live search/filter path.
 */
function fileNotInAnyProjectCondition() {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(projectFiles)
      .where(eq(projectFiles.fileId, files.id))
  );
}

/**
 * Idle-browse (`!active`) data: recent projects + files + creators.
 * Globally identical for every anonymous hit — no query/category/
 * viewer input — so it's a single cache entry for the whole site
 * rather than 6 fresh Neon round trips per hit (PERF-16). Mirrors the
 * unstable_cache shape in app/api/search/route.ts:119, plus
 * updateTag so publish/archive/delete don't wait out the TTL.
 */
const getIdleBrowseData = unstable_cache(
  async () => {
    const fileNotInAnyProject = fileNotInAnyProjectCondition();
    const [recentFiles, recentProjects, recentCreators] = await Promise.all([
      db
        .select({
          id: files.id,
          name: files.name,
          slug: files.slug,
          price: files.price,
          thumbnailUrl: files.thumbnailUrl,
          coverPhotoId: files.coverPhotoId,
          downloadCount: files.downloadCount,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(files)
        .innerJoin(users, eq(files.userId, users.id))
        .where(
          and(
            eq(files.status, "published"),
            eq(files.visibility, "public"),
            fileNotInAnyProject
          )
        )
        .orderBy(desc(files.downloadCount))
        .limit(PER_SECTION),
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
        .where(and(eq(projects.status, "published"), eq(projects.visibility, "public")))
        .groupBy(projects.id, users.username, users.displayName, users.avatarUrl, projects.createdAt)
        .orderBy(desc(projects.createdAt))
        .limit(12),
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

    const [photosByFile, photosByProject, thumbnailsByProject] = await Promise.all([
      fetchAdditionalPhotosByFile(recentFiles),
      fetchAdditionalPhotosByProject(recentProjects),
      fetchFileThumbnailsByProject(recentProjects.map((p) => p.id)),
    ]);

    const recentWithPhotos: FileRow[] = recentFiles.map((f) => ({
      ...f,
      additionalPhotoIds: photosByFile.get(f.id) ?? [],
    }));
    const projectsWithPhotos: ProjectRow[] = recentProjects.map((p) => ({
      ...p,
      additionalPhotoIds: photosByProject.get(p.id) ?? [],
      fileThumbnails: thumbnailsByProject.get(p.id) ?? [],
    }));

    return { recentWithPhotos, projectsWithPhotos, recentCreators };
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

  // The header (search bar + category chips) is identical across states.
  const header = (
    <>
      <div className="flex justify-center">
        <BrowseSearchBar defaultValue={query} category={category} />
      </div>
      <div className="mt-4 flex">
        <CategoryFilterBar />
      </div>
    </>
  );

  // Idle state: recent projects + files + creators grid below the header.
  // Globally-identical content (no per-viewer data) — cached in
  // getIdleBrowseData() so an anonymous-hit stampede shares one Neon
  // round trip per IDLE_BROWSE_CACHE_TTL_SECONDS window (PERF-16).
  if (!active) {
    const { recentWithPhotos, projectsWithPhotos, recentCreators } =
      await getIdleBrowseData();

    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        {header}

        {/* Projects */}
        {projectsWithPhotos.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
              Projects
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {projectsWithPhotos.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </section>
        )}

        {/* Files */}
        <section className="mt-10">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">
            Files
          </h2>
          {recentWithPhotos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files published yet</p>
          ) : (
            <FileGrid files={recentWithPhotos} />
          )}
        </section>

        {/* Creators */}
        {recentCreators.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
              Creators
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {recentCreators.map((u) => (
                <UserCard key={u.id} user={u} />
              ))}
            </div>
          </section>
        )}
      </div>
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
  const [fileRows, projectRows, collectionRows, userRows] = await Promise.all([
    db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        price: files.price,
        thumbnailUrl: files.thumbnailUrl,
        coverPhotoId: files.coverPhotoId,
        downloadCount: files.downloadCount,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
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
      .limit(PER_SECTION),
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
      .limit(PER_SECTION),
    db
      .select({
        id: collections.id,
        slug: collections.slug,
        name: collections.name,
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
      .limit(PER_SECTION),
    userQuery,
  ]);

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
    ? `"${query}"`
    : activeCategory
      ? activeCategory.label
      : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {header}

      {activeCategory && !query && (
        <div className="mt-6">
          <h1 className="text-lg font-semibold tracking-tight">
            {activeCategory.label}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {activeCategory.description}
          </p>
        </div>
      )}

      {totalHits === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">
            No results for {scopeLabel}
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {userRows.length > 0 && (
            <Section title="Creators">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {userRows.map((u) => (
                  <UserCard key={u.id} user={u} />
                ))}
              </div>
            </Section>
          )}

          {projectRowsWithPhotos.length > 0 && (
            <Section title="Projects">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {projectRowsWithPhotos.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </Section>
          )}

          {collectionRows.length > 0 && (
            <Section title="Collections">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {collectionRows.map((c) => (
                  <CollectionCard key={c.id} collection={c} />
                ))}
              </div>
            </Section>
          )}

          {fileRowsWithPhotos.length > 0 && (
            <Section title="Files">
              <FileGrid files={fileRowsWithPhotos} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {files.map((file) => (
        <Link key={file.id} href={`/files/${file.slug}`}>
          <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
            <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50">
              {file.thumbnailUrl && (
                <CardImageCarousel
                  images={[
                    file.thumbnailUrl,
                    ...file.additionalPhotoIds.map(
                      (id) => `/api/thumbnails/${file.id}?photoId=${id}`
                    ),
                  ]}
                  alt=""
                  size="sm"
                  className="transition-transform duration-300 group-hover:scale-105"
                />
              )}
              {file.price > 0 && (
                <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-xs font-medium tabular-nums backdrop-blur-sm">
                  ${(file.price / 100).toFixed(2)}
                </span>
              )}
            </div>
            <CardContent className="p-2.5">
              <FileTitleTooltip
                title={file.name}
                className="truncate text-sm font-medium group-hover:text-primary transition-colors"
              />
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                {file.avatarUrl &&
                (file.avatarUrl.startsWith("http://") ||
                  file.avatarUrl.startsWith("https://")) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.avatarUrl}
                    alt=""
                    className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="flex h-3.5 w-3.5 shrink-0 rounded-full"
                    style={{
                      background: getAvatarGradient(file.username || file.displayName || ""),
                    }}
                  />
                )}
                <span className="truncate">
                  {file.displayName || file.username || "Unknown"}
                </span>
              </p>
              <div className="mt-1.5 flex items-center">
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums"
                  aria-label={`${file.downloadCount} downloads`}
                  title={`${file.downloadCount} downloads`}
                >
                  <Download size={11} />
                  {formatCompactCount(file.downloadCount)}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
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
  const creatorSeed = project.creatorUsername || project.creatorDisplayName || "";
  return (
    <Link href={`/projects/${project.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50">
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
        <CardContent className="p-2.5">
          <h3 className="truncate text-sm font-medium group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {project.creatorAvatarUrl &&
            (project.creatorAvatarUrl.startsWith("http://") ||
              project.creatorAvatarUrl.startsWith("https://")) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={project.creatorAvatarUrl}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ background: getAvatarGradient(creatorSeed) }}
              />
            )}
            <span className="truncate">
              {project.creatorDisplayName || project.creatorUsername || "Unknown"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {project.fileCount} {project.fileCount === 1 ? "file" : "files"}
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
    <Link href={`/collections/${collection.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50 text-xs text-muted-foreground/60">
          Collection
        </div>
        <CardContent className="p-2.5">
          <h3 className="truncate text-sm font-medium group-hover:text-primary transition-colors">
            {collection.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
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

function UserCard({ user }: { user: UserRow }) {
  if (!user.username) return null;
  return (
    <Link
      href={`/${user.username}`}
      className="group flex items-center gap-2.5 rounded-l-full rounded-r-3xl border border-border bg-card p-1.5 pr-3 transition-colors hover:border-foreground/20 hover:bg-muted/30"
    >
      <UserAvatar
        seed={user.username}
        imageUrl={user.avatarUrl}
        displayName={user.displayName || user.username}
        className="h-9 w-9 shrink-0 text-base"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-tight transition-colors group-hover:text-primary">
          {user.displayName || user.username}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          @{user.username}
        </p>
      </div>
    </Link>
  );
}
