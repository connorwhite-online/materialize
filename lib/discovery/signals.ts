import "server-only";
import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileDownloads } from "@/lib/db/schema";
import { DISCOVERY_PARAMS } from "./params";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Downloads per file inside the recency window — the signal that turns
 * `files.downloadCount` from an all-time leaderboard into something
 * that moves.
 *
 * Served by the existing `file_downloads_file_id_created_at_idx`
 * (fileId, createdAt), so this is an index scan bounded by the
 * candidate set rather than a table scan. Callers pass the candidate
 * pool they already fetched, never the whole catalogue.
 *
 * Returns a plain Map; ids with no downloads in the window are absent,
 * and callers should read them as 0.
 */
export async function recentDownloadCounts(
  fileIds: readonly string[],
  options: { windowDays?: number; now?: Date } = {}
): Promise<Map<string, number>> {
  if (fileIds.length === 0) return new Map();

  const windowDays =
    options.windowDays ?? DISCOVERY_PARAMS.popularity.recentWindowDays;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await db
    .select({
      fileId: fileDownloads.fileId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(fileDownloads)
    .where(
      and(
        inArray(fileDownloads.fileId, [...fileIds]),
        gte(fileDownloads.createdAt, since)
      )
    )
    .groupBy(fileDownloads.fileId);

  return new Map(rows.map((row) => [row.fileId, row.count]));
}
