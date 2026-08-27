/**
 * Every number the discovery ranker can be tuned by, in one object.
 *
 * The shape is borrowed from how X's home-mixer separates its scoring
 * *structure* from its scoring *weights*: the pipeline is code, the
 * weights are configuration read at request time. Their weights live
 * in a feature-switch service (which is why every `ModelWeights.*Param`
 * in the open-source drop reads `default = 0.0` — the real values were
 * never published). We have no such service, so the equivalent move is
 * this: constants in one file, every ranking function taking its params
 * as an argument that defaults to them. Tuning is then a one-file diff,
 * and a test can rank against explicit params instead of whatever the
 * production defaults happen to be this week.
 *
 * Nothing here reads `process.env`, so this module is safe to import
 * from a client component or a unit test.
 */

/**
 * Exponential-decay discount applied to the 2nd, 3rd, … item sharing
 * some key (a creator, a candidate source, a category).
 *
 * `discount(position) = (1 - floor) * decay^position + floor`
 *
 * The floor is what stops it being a de-facto "one per creator" rule:
 * a genuinely great fourth item from the same creator still outranks a
 * mediocre first item from someone else, it just has to earn it.
 */
export interface DiversityParams {
  /** Per-position multiplier. Lower = harsher. */
  decay: number;
  /** Asymptote the discount never falls below. */
  floor: number;
}

export interface PopularityParams {
  /**
   * How far back "recent" reaches. X keeps only 24-48h of engagement
   * in the graph that powers out-of-network recommendations; the
   * window doing the work matters more than the total volume. A
   * 3D-print file has a far slower engagement clock than a tweet, so
   * ours is measured in weeks, not hours — but the principle is the
   * same, and this is the first number to reach for if the grid feels
   * stale.
   */
  recentWindowDays: number;
  /** Weight on log1p(downloads inside the recent window). */
  recentWeight: number;
  /** Weight on log1p(all-time downloads). */
  allTimeWeight: number;
  /**
   * Head-start given to a brand-new listing, decaying by half every
   * `freshnessHalfLifeDays`. Without it a new file has no downloads,
   * therefore no rank, therefore no downloads.
   *
   * Calibrate it against the term it competes with, not by feel: the
   * recent-downloads term is `recentWeight * log1p(recent)`, so a boost
   * of B is worth roughly `e^(B / recentWeight) - 1` recent downloads.
   * At 1.5 a day-old listing enters around where a file with ~3-4
   * downloads this month sits — ahead of the long tail that has neither
   * history nor current demand, behind anything with real traction, and
   * halved out of the way within two weeks.
   */
  freshnessBoost: number;
  freshnessHalfLifeDays: number;
}

export interface QualityBoostParams {
  /**
   * Ceiling of the popularity multiplier applied on top of a text
   * relevance score: 0.3 means a maximally popular file can rank up
   * to 1.3x its relevance. Deliberately small — popularity breaks
   * ties between comparable matches, it does not outrank a better
   * match.
   */
  maxBoost: number;
  /**
   * Popularity score at which the boost reaches half of `maxBoost`.
   * Higher = only genuinely popular items feel it.
   */
  halfBoostAt: number;
}

export const DISCOVERY_PARAMS = {
  popularity: {
    recentWindowDays: 30,
    recentWeight: 1,
    allTimeWeight: 0.35,
    freshnessBoost: 1.5,
    freshnessHalfLifeDays: 14,
  } satisfies PopularityParams,

  /**
   * Browse-grid creator diversity. Matches the values X ships for
   * author diversity (decay 0.5, floor 0.25): a creator's second item
   * scores ~0.63x, their third ~0.44x, tailing to 0.25x. Harsh on
   * purpose — the browse grid is the shop window, and at our catalog
   * size a handful of prolific creators would otherwise own it.
   */
  browseDiversity: { decay: 0.5, floor: 0.25 } satisfies DiversityParams,

  /**
   * Search-result creator diversity. Much gentler: someone searching
   * "articulated dragon" is entitled to five results from the person
   * who makes articulated dragons. This only breaks up a wall of
   * near-identical listings.
   */
  searchDiversity: { decay: 0.8, floor: 0.6 } satisfies DiversityParams,

  searchQualityBoost: { maxBoost: 0.3, halfBoostAt: 3 } satisfies QualityBoostParams,
} as const;
