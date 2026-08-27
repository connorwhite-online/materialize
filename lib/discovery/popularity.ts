import { DISCOVERY_PARAMS, type PopularityParams } from "./params";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Half-life decay: 1 at age 0, 0.5 at one half-life, → 0.
 *
 * An unknown age (NaN) and an infinite age both decay to 0, not to 1.
 * Lumping every non-finite age in with "age <= 0" is the tempting
 * one-liner and it is wrong in the direction that matters: a row with
 * no `createdAt` would collect the full new-listing boost forever.
 */
export function timeDecay(ageMs: number, halfLifeMs: number): number {
  if (Number.isNaN(ageMs)) return 0;
  if (ageMs <= 0) return 1;
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 0;
  // Infinity / halfLife is Infinity, and 0.5^Infinity is 0.
  return Math.pow(0.5, ageMs / halfLifeMs);
}

export interface PopularityInput {
  /** All-time download count — the denormalised `files.downloadCount`. */
  downloadCount: number;
  /** Downloads inside `recentWindowDays` — see `recentDownloadCounts`. */
  recentDownloads: number;
  /** Publication time, for the freshness head-start. */
  createdAt: Date | null;
}

/**
 * Time-decayed popularity, replacing a raw `downloadCount` sort.
 *
 * Three terms, and each one is there to fix a specific failure of
 * sorting by all-time downloads:
 *
 * - **Recent-window downloads** dominate, so the grid reflects what is
 *   being downloaded *now* rather than what won in 2024 and has coasted
 *   since.
 * - **All-time downloads** at a lower weight, as a durable-quality
 *   prior — enough that a proven file outranks a briefly-trending one,
 *   not enough to freeze the grid.
 * - **A freshness boost** that decays by half every two weeks, because
 *   a new listing has no downloads, therefore no rank, therefore never
 *   gets the downloads. It is a head start, not a ranking: it runs out.
 *
 * Both counts go through `log1p`, which is the important detail. On raw
 * counts a single file with 10k downloads is worth a hundred with 100,
 * and the grid becomes a permanent leaderboard of one; on a log scale
 * each order of magnitude is a fixed step and the recency and freshness
 * terms can still move things.
 */
export function popularityScore(
  input: PopularityInput,
  now: Date = new Date(),
  params: PopularityParams = DISCOVERY_PARAMS.popularity
): number {
  return popularityBreakdown(input, now, params).total;
}

/** The three terms of `popularityScore`, plus their sum. */
export interface PopularityBreakdown {
  /** `recentWeight * log1p(downloads in the recent window)`. */
  recent: number;
  /** `allTimeWeight * log1p(all-time downloads)`. */
  allTime: number;
  /** The decaying new-listing head start. */
  freshness: number;
  /** What `popularityScore` returns. */
  total: number;
}

/**
 * `popularityScore` with its terms kept apart, for the ranking
 * inspector at `/internal/discovery`.
 *
 * `popularityScore` is defined as this function's `total` rather than
 * the two being computed side by side. An inspector that can drift
 * from the ranker it inspects is worse than no inspector: it would
 * explain a ranking the grid isn't using, and you would trust it.
 */
export function popularityBreakdown(
  input: PopularityInput,
  now: Date = new Date(),
  params: PopularityParams = DISCOVERY_PARAMS.popularity
): PopularityBreakdown {
  const downloads = Math.max(0, input.downloadCount || 0);
  const recent = Math.max(0, input.recentDownloads || 0);

  const ageMs = input.createdAt
    ? now.getTime() - input.createdAt.getTime()
    : Number.POSITIVE_INFINITY;
  const rawFreshness =
    params.freshnessBoost *
    timeDecay(ageMs, params.freshnessHalfLifeDays * DAY_MS);

  const terms = {
    recent: params.recentWeight * Math.log1p(recent),
    allTime: params.allTimeWeight * Math.log1p(downloads),
    freshness: Number.isFinite(rawFreshness) ? rawFreshness : 0,
  };
  return {
    ...terms,
    total: terms.recent + terms.allTime + terms.freshness,
  };
}
