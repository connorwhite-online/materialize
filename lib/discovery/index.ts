/**
 * Discovery ranking — candidate rows in, ordered rows out.
 *
 * The layering is deliberate and worth keeping: `params`, `popularity`,
 * `relevance`, `rescoring` and `rank` are pure and free of `server-only`
 * / `db` imports, so they unit-test without a database and could run on
 * a client if a surface ever needs to re-rank locally. `signals` is the
 * only module that touches Postgres, and it is imported directly by
 * server code rather than re-exported here, so importing a scorer can
 * never drag the db client into a client bundle.
 */
export { DISCOVERY_PARAMS } from "./params";
export type {
  DiversityParams,
  PopularityParams,
  QualityBoostParams,
} from "./params";
export { popularityBreakdown, popularityScore, timeDecay } from "./popularity";
export type { PopularityBreakdown, PopularityInput } from "./popularity";
export { relevanceScore } from "./relevance";
export type { RelevanceFields } from "./relevance";
export {
  groupDiversityRescorer,
  positionDiscount,
  qualityBoost,
  rescore,
  rescoreWithFactors,
} from "./rescoring";
export type { Candidate, RescoredCandidate, Rescorer } from "./rescoring";
export {
  explainBrowseRanking,
  rankBrowseRows,
  rankOrderedRows,
  rankSearchRows,
} from "./rank";
export type {
  BrowseExplanation,
  BrowseRankOptions,
  BrowseRow,
  OrderedRankOptions,
  SearchRankOptions,
  SearchRow,
} from "./rank";
