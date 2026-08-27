import {
  DISCOVERY_PARAMS,
  type DiversityParams,
  type PopularityParams,
  type QualityBoostParams,
} from "./params";
import {
  popularityBreakdown,
  popularityScore,
  type PopularityBreakdown,
  type PopularityInput,
} from "./popularity";
import { relevanceScore, type RelevanceFields } from "./relevance";
import {
  groupDiversityRescorer,
  qualityBoost,
  rescore,
  rescoreWithFactors,
  type Candidate,
  type RescoredCandidate,
  type Rescorer,
} from "./rescoring";

/**
 * The two rankers the product actually calls, assembled from the parts
 * in this directory.
 *
 * Both follow the same shape, which is the point of the exercise:
 * a base score from one function, a list of independent rescorers, one
 * `rescore()` call. Adding a heuristic — impression decay, a category
 * spread, a creator-quality prior — means appending to the rescorer
 * array, not rewriting a query's ORDER BY.
 */

/** Identity plus everything `popularityScore` needs. */
export type BrowseRow = PopularityInput & { id: string };

export interface BrowseRankOptions<T> {
  /**
   * Diversity grouping key — any stable per-creator string. Rows that
   * return null are ranked without a diversity discount.
   */
  creatorKey: (row: T) => string | null | undefined;
  limit?: number;
  now?: Date;
  popularity?: PopularityParams;
  diversity?: DiversityParams;
}

/**
 * Rank browse candidates by time-decayed popularity, then spread them
 * across creators.
 *
 * Replaces `ORDER BY download_count DESC`, which had two problems that
 * compound: it is an all-time leaderboard that new work cannot enter,
 * and it has no notion of who published what, so the most prolific
 * creator takes as many grid slots as they have files.
 */
export function rankBrowseRows<T extends BrowseRow>(
  rows: readonly T[],
  options: BrowseRankOptions<T>
): T[] {
  return runBrowseRanking(rows, options).map((candidate) => candidate.item);
}

/**
 * The browse ranking itself. `rankBrowseRows` and
 * `explainBrowseRanking` are both projections of this one call, so the
 * inspector can never explain an ordering the grid isn't serving.
 */
function runBrowseRanking<T extends BrowseRow>(
  rows: readonly T[],
  options: BrowseRankOptions<T>
): RescoredCandidate<T>[] {
  const now = options.now ?? new Date();
  const candidates: Candidate<T>[] = rows.map((row) => ({
    id: row.id,
    item: row,
    score: popularityScore(row, now, options.popularity),
  }));

  const ranked = rescoreWithFactors(candidates, [
    groupDiversityRescorer<T>(
      options.creatorKey,
      options.diversity ?? DISCOVERY_PARAMS.browseDiversity
    ),
  ]);

  return options.limit == null ? ranked : ranked.slice(0, options.limit);
}

/** One ranked row with the arithmetic that placed it there. */
export interface BrowseExplanation<T> {
  row: T;
  /** Final position, 1-based. */
  rank: number;
  /** The three popularity terms and their sum (the base score). */
  popularity: PopularityBreakdown;
  /**
   * Creator-diversity multiplier. 1 means the row was not discounted —
   * either its creator has one row in the pool, or this is their best.
   */
  diversityFactor: number;
  /** `popularity.total * diversityFactor`. */
  score: number;
}

/**
 * `rankBrowseRows` with the scoring kept, for `/internal/discovery`.
 *
 * Ranking is cheap and pure once the rows are in hand, so the
 * inspector re-runs it rather than the grid paying to record it.
 */
export function explainBrowseRanking<T extends BrowseRow>(
  rows: readonly T[],
  options: BrowseRankOptions<T>
): BrowseExplanation<T>[] {
  // Resolve `now` once and hand it down: letting runBrowseRanking
  // default its own would score the ranking and explain it at two
  // different instants, so the freshness term shown wouldn't be quite
  // the one that produced the order.
  const now = options.now ?? new Date();
  return runBrowseRanking(rows, { ...options, now }).map((candidate, index) => ({
    row: candidate.item,
    rank: index + 1,
    popularity: popularityBreakdown(candidate.item, now, options.popularity),
    // Single rescorer today; named rather than indexed so adding one
    // upstream is a compile error here instead of a silently wrong label.
    diversityFactor: candidate.factors[0] ?? 1,
    score: candidate.score,
  }));
}

/** Identity, relevance fields, and the counts the quality boost reads. */
export type SearchRow = RelevanceFields & {
  id: string;
  downloadCount?: number | null;
};

export interface SearchRankOptions<T> {
  creatorKey: (row: T) => string | null | undefined;
  limit?: number;
  diversity?: DiversityParams;
  qualityBoost?: QualityBoostParams;
}

/**
 * Rank search hits by how well they match, nudged by popularity and
 * spread lightly across creators.
 *
 * The base score is relevance alone. Popularity enters only as a
 * bounded multiplier (`qualityBoost`), so it separates two comparable
 * matches without ever promoting a worse one — the same reason X caps
 * its heuristics as multipliers on a model score rather than letting
 * them into the score itself.
 *
 * Rows that score zero are dropped: they came back from an ILIKE that
 * matched something (a description, a category bridge) but nothing this
 * function can see, and showing them ahead of nothing is worse than
 * showing nothing.
 */
export function rankSearchRows<T extends SearchRow>(
  query: string,
  rows: readonly T[],
  options: SearchRankOptions<T>
): T[] {
  const boostParams = options.qualityBoost ?? DISCOVERY_PARAMS.searchQualityBoost;

  const candidates: Candidate<T>[] = rows.map((row) => ({
    id: row.id,
    item: row,
    score: relevanceScore(query, row),
  }));

  const popularityRescorer: Rescorer<T> = (items) =>
    new Map(
      items.map((candidate) => [
        candidate.id,
        // log1p for the same reason popularityScore uses it: one
        // runaway file shouldn't saturate the boost for everything
        // else in the result set.
        qualityBoost(
          Math.log1p(Math.max(0, candidate.item.downloadCount ?? 0)),
          boostParams
        ),
      ])
    );

  const ranked = rescore(candidates, [
    popularityRescorer,
    groupDiversityRescorer<T>(
      options.creatorKey,
      options.diversity ?? DISCOVERY_PARAMS.searchDiversity
    ),
  ]).filter((candidate) => candidate.score > 0);

  const limited =
    options.limit == null ? ranked : ranked.slice(0, options.limit);
  return limited.map((candidate) => candidate.item);
}

export interface OrderedRankOptions<T> {
  creatorKey: (row: T) => string | null | undefined;
  limit?: number;
  diversity?: DiversityParams;
}

/**
 * Apply creator diversity to a list that is *already* in the order we
 * want, without a popularity or relevance signal to rank by.
 *
 * The base score is derived from the row's position in the input list,
 * which is X's `LowSignalScorer` trick: when there is no signal to
 * score with, score by candidate-source position so the existing order
 * is preserved exactly, then let the rescorers work on top. It matters
 * that the base score is strictly decreasing — score every row equally
 * and the sort collapses to the id tiebreak, throwing the original
 * ordering away.
 *
 * Reciprocal rank (`1 / (1 + index)`) rather than a linear countdown,
 * because a linear score makes the diversity discount mean different
 * things at different list lengths: in a list of 3 the gap between
 * consecutive positions is a third of the whole range and no realistic
 * discount can cross it, while in a list of 40 it is a fortieth and the
 * same discount reorders freely. Reciprocal rank keeps the ratio
 * between neighbouring positions constant, so the pool size stops
 * being an invisible tuning knob.
 *
 * Used for projects on the browse grid, which have no download signal
 * of their own but are still worth spreading across creators.
 */
export function rankOrderedRows<T extends { id: string }>(
  rows: readonly T[],
  options: OrderedRankOptions<T>
): T[] {
  const candidates: Candidate<T>[] = rows.map((row, index) => ({
    id: row.id,
    item: row,
    score: 1 / (1 + index),
  }));

  const ranked = rescore(candidates, [
    groupDiversityRescorer<T>(
      options.creatorKey,
      options.diversity ?? DISCOVERY_PARAMS.browseDiversity
    ),
  ]);

  const limited =
    options.limit == null ? ranked : ranked.slice(0, options.limit);
  return limited.map((candidate) => candidate.item);
}
