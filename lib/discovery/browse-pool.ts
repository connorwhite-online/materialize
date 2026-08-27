import "server-only";
import { and, desc, eq, notExists, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, projectFiles, users } from "@/lib/db/schema";
import { recentDownloadCounts } from "./signals";

/**
 * The browse grid's candidate pool, in one place.
 *
 * Both `/files` and the ranking inspector at `/internal/discovery` draw
 * from this. That sharing is the point: an inspector that assembles its
 * own pool inspects a ranking nobody is served, and the first time the
 * two drift you would be debugging the grid through a lens that no
 * longer matches it.
 *
 * Two sources, deliberately. Either alone is self-reinforcing — order
 * by downloads and new work can never enter the pool to earn any;
 * order by recency and nothing proven ever appears. This is the
 * smallest useful version of what X calls candidate sources, and a new
 * one (same-category, co-download, followed creators) is another query
 * plus another `pools` tag, with the ranker unchanged.
 */

export const FILE_POOL_POPULAR = 96;
export const FILE_POOL_FRESH = 48;

/**
 * How many files the browse grid renders. Shared with the inspector,
 * which draws its cutoff rule here — a hardcoded copy would quietly
 * start marking the wrong row the moment the grid changed, in the one
 * tool whose whole job is not to be out of date.
 */
export const BROWSE_FILES_SHOWN = 24;

/** Which candidate source surfaced a row. A row can come from both. */
export type CandidatePool = "popular" | "fresh";

/**
 * The columns every file-candidate query selects. `createdAt`,
 * `category`, `tags` and `designTags` are here for ranking (freshness,
 * relevance, the category-bridge signal), not for rendering.
 */
export const fileCandidateColumns = {
  id: files.id,
  name: files.name,
  slug: files.slug,
  price: files.price,
  thumbnailUrl: files.thumbnailUrl,
  coverPhotoId: files.coverPhotoId,
  downloadCount: files.downloadCount,
  createdAt: files.createdAt,
  category: files.category,
  tags: files.tags,
  designTags: files.designTags,
  username: users.username,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
};

/**
 * The row shape `fileCandidateColumns` selects. Derived from the column
 * map rather than hand-written so adding a column can't leave the type
 * behind — note the `notNull` branch: without it every nullable column
 * (`thumbnailUrl`, `category`, …) would be typed non-null and the
 * nullish handling downstream would look dead.
 */
type FileCandidateColumns = {
  [K in keyof typeof fileCandidateColumns]: (typeof fileCandidateColumns)[K]["_"]["notNull"] extends true
    ? (typeof fileCandidateColumns)[K]["_"]["data"]
    : (typeof fileCandidateColumns)[K]["_"]["data"] | null;
};

export type FileCandidate = FileCandidateColumns & {
  /** Downloads inside the popularity window — see `recentDownloadCounts`. */
  recentDownloads: number;
  /** Every source this row came from, in query order. */
  pools: CandidatePool[];
};

/**
 * Files bundled into a project are surfaced under that project, not as
 * standalone entries in the Files section. Correlated NOT EXISTS so a
 * file with any project membership drops out. Pure function of the
 * schema (no request-specific input), so it's safe to call both inside
 * a cached fetch and on the live search/filter path.
 */
export function fileNotInAnyProjectCondition() {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(projectFiles)
      .where(eq(projectFiles.fileId, files.id))
  );
}

/**
 * Fetch the browse candidate pool and hydrate its recency signal.
 *
 * Returns more rows than any surface renders — ranking can only
 * reorder what it is given, and fetching exactly what you show leaves
 * the SQL's ORDER BY as the real ranker with `lib/discovery` shuffling
 * rows it already picked.
 */
export async function fetchFileCandidatePool(options?: {
  popularLimit?: number;
  freshLimit?: number;
  now?: Date;
}): Promise<FileCandidate[]> {
  const publishedFile = and(
    eq(files.status, "published"),
    eq(files.visibility, "public"),
    fileNotInAnyProjectCondition()
  );

  const [popular, fresh] = await Promise.all([
    db
      .select(fileCandidateColumns)
      .from(files)
      .innerJoin(users, eq(files.userId, users.id))
      .where(publishedFile)
      .orderBy(desc(files.downloadCount))
      .limit(options?.popularLimit ?? FILE_POOL_POPULAR),
    db
      .select(fileCandidateColumns)
      .from(files)
      .innerJoin(users, eq(files.userId, users.id))
      .where(publishedFile)
      .orderBy(desc(files.createdAt))
      .limit(options?.freshLimit ?? FILE_POOL_FRESH),
  ]);

  // The pools overlap — a popular file can also be a recent one — so a
  // row is merged rather than duplicated, keeping both source tags.
  const merged = new Map<string, FileCandidate>();
  const add = (rows: FileCandidateColumns[], pool: CandidatePool) => {
    for (const row of rows) {
      const existing = merged.get(row.id);
      if (existing) existing.pools.push(pool);
      else merged.set(row.id, { ...row, recentDownloads: 0, pools: [pool] });
    }
  };
  add(popular, "popular");
  add(fresh, "fresh");

  const candidates = [...merged.values()];
  const recent = await recentDownloadCounts(
    candidates.map((c) => c.id),
    { now: options?.now }
  );
  for (const candidate of candidates) {
    candidate.recentDownloads = recent.get(candidate.id) ?? 0;
  }
  return candidates;
}
