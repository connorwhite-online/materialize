import type { DiversityParams, QualityBoostParams } from "./params";

/**
 * The rescoring layer — the one structural idea worth lifting wholesale
 * from X's ranker.
 *
 * `HeuristicScorer.scala` is the whole philosophy in a line:
 *
 *     val scaleFactor = rescorers.map(_(query, candidate)).product
 *
 * A base score (from a model, or in our case from a popularity or
 * relevance function) multiplied by N independent factors, each one a
 * small pure function of the candidate set. Every heuristic X applies —
 * author diversity, candidate-source diversity, impression decay,
 * feedback fatigue — is one of those factors. Nothing composes into
 * anything else, so a heuristic can be added, removed or retuned
 * without touching the ranker or any other heuristic.
 *
 * Two properties are load-bearing and easy to lose:
 *
 * 1. **Rescorers are listwise.** A factor is computed from the whole
 *    candidate set, not from one candidate in isolation — that's the
 *    only way "this is your third file in this grid" is expressible.
 * 2. **They all read the same input scores.** Every factor is computed
 *    against the *pre-rescoring* score and the products are taken at
 *    the end, so the result never depends on the order rescorers are
 *    listed in. Feed one rescorer's output into the next and the stack
 *    silently becomes order-dependent.
 */
export interface Candidate<T> {
  /** Stable identity — also the final sort tiebreak. */
  id: string;
  item: T;
  /** Base score before any rescoring. */
  score: number;
}

/**
 * Maps candidate id → multiplier. Ids absent from the map are left
 * alone (treated as 1.0), so a rescorer that has nothing to say about
 * a candidate simply omits it.
 */
export type Rescorer<T> = (candidates: readonly Candidate<T>[]) => Map<string, number>;

/**
 * `(1 - floor) * decay^position + floor` — a port of
 * `DiversityDiscountProvider.discount` (and the identical function X
 * repeats in `CandidateSourceDiversityListwiseRescoringProvider` and
 * `ImpressedAuthorDecayRescoringProvider`; it earns being written once).
 *
 * Position is zero-based, so the first item in a group is never
 * discounted.
 */
export function positionDiscount(
  position: number,
  { decay, floor }: DiversityParams
): number {
  if (position <= 0) return 1;
  return (1 - floor) * Math.pow(decay, position) + floor;
}

/**
 * Group candidates by a key, rank each group by score, and discount by
 * position within the group — the diversity heuristic.
 *
 * Candidates whose key is null (no creator resolved, say) are left
 * ungrouped and undiscounted rather than being lumped into one "null"
 * bucket, which would penalise them for each other's existence.
 */
export function groupDiversityRescorer<T>(
  groupKey: (item: T) => string | null | undefined,
  params: DiversityParams
): Rescorer<T> {
  return (candidates) => {
    const groups = new Map<string, Candidate<T>[]>();
    for (const candidate of candidates) {
      const key = groupKey(candidate.item);
      if (key == null) continue;
      const group = groups.get(key);
      if (group) group.push(candidate);
      else groups.set(key, [candidate]);
    }

    const multipliers = new Map<string, number>();
    for (const group of groups.values()) {
      // Sort by score desc so a creator's strongest item holds
      // position 0 and keeps its full score; id breaks ties so the
      // discount assignment is deterministic across renders.
      const ordered = [...group].sort(
        (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
      ordered.forEach((candidate, position) => {
        multipliers.set(candidate.id, positionDiscount(position, params));
      });
    }
    return multipliers;
  };
}

/**
 * A saturating popularity multiplier, for stacking on top of a text
 * relevance score.
 *
 * `1 + maxBoost * popularity / (popularity + halfBoostAt)` — bounded
 * above by `1 + maxBoost` however popular the item is, so popularity
 * can only ever break a tie between comparable matches. A search
 * ranker that lets popularity dominate stops being a search ranker.
 */
export function qualityBoost(
  popularity: number,
  { maxBoost, halfBoostAt }: QualityBoostParams
): number {
  if (!Number.isFinite(popularity) || popularity <= 0) return 1;
  return 1 + (maxBoost * popularity) / (popularity + halfBoostAt);
}

/**
 * Multiply a candidate's base score by the product of every rescorer's
 * factor for it, then sort descending.
 *
 * Non-finite and negative scores are clamped to 0 rather than being
 * dropped: a candidate that reached the ranker stays in the list, it
 * just sorts last. (X guards the same case from the other end — their
 * `noNegHeuristic` leaves sub-epsilon scores unmultiplied so a
 * discount can't *raise* a negative score.)
 */
export function rescore<T>(
  candidates: readonly Candidate<T>[],
  rescorers: readonly Rescorer<T>[]
): Candidate<T>[] {
  return rescoreWithFactors(candidates, rescorers).map(
    ({ id, item, score }) => ({ id, item, score })
  );
}

/** A rescored candidate with the arithmetic that produced it kept. */
export interface RescoredCandidate<T> extends Candidate<T> {
  /** The score before any rescoring, after clamping. */
  baseScore: number;
  /** One factor per rescorer, in the order they were passed. */
  factors: number[];
}

/**
 * `rescore`, retaining each candidate's base score and per-rescorer
 * factors so the ranking inspector can show why a row landed where it
 * did. `rescore` is defined as this with the extra fields dropped —
 * same reason as `popularityBreakdown`: an inspector computing its own
 * version of the ranking would eventually explain a different one.
 */
export function rescoreWithFactors<T>(
  candidates: readonly Candidate<T>[],
  rescorers: readonly Rescorer<T>[]
): RescoredCandidate<T>[] {
  // Every rescorer sees the same untouched input — see the note above.
  const factorMaps = rescorers.map((rescorer) => rescorer(candidates));

  return candidates
    .map((candidate) => {
      const baseScore =
        Number.isFinite(candidate.score) && candidate.score > 0
          ? candidate.score
          : 0;
      const factors = factorMaps.map((map) => map.get(candidate.id) ?? 1);
      const score = factors.reduce((acc, factor) => acc * factor, baseScore);
      return { ...candidate, baseScore, factors, score };
    })
    .sort(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}
