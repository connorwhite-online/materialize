import type { AestheticJudgement, JudgeRequest } from "./critique";
import type { HarnessResult } from "./harness";

/**
 * Best-of-N selection, objective checks first (docs/text-to-cad/07).
 *
 * It used to keep the aesthetic judge's favorite outright. The judge's scores
 * have not been shown to track the owner's taste (scripts/evals/calibration.ts:
 * r = -0.65 over the first 6 rated builds), so it no longer decides. Candidates
 * rank on what is measured, and the judge only breaks a tie between
 * candidates that are objectively equal.
 *
 * Pure (the judge is injected) so it tests without the model or the harness.
 */

/** Lower is better, compared left to right. */
export function objectiveRank(r: HarnessResult): [number, number] {
  const dimensionFailures = (r.dimensionChecks ?? []).filter(
    (c) => c.ran && c.ok === false
  ).length;
  // Only a probe that RAN and failed counts against a candidate; an unrun
  // check is unknown, not bad (the same honesty rail as dimension-check.ts).
  const dfmFailed = r.run?.checks?.dfm?.ok === false ? 1 : 0;
  return [dimensionFailures, dfmFailed];
}

function compareRank(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

export async function pickBestCandidate(
  candidates: HarnessResult[],
  judge?: (req: JudgeRequest) => Promise<AestheticJudgement>
): Promise<HarnessResult> {
  if (candidates.length === 0) throw new Error("no candidates to pick from");
  const best = candidates.reduce((a, r) =>
    compareRank(objectiveRank(r), objectiveRank(a)) < 0 ? r : a
  );
  const tied = candidates.filter(
    (r) => compareRank(objectiveRank(r), objectiveRank(best)) === 0
  );
  // A clear objective winner, or nothing to break the tie with: first in
  // order among the best (the streaming candidate, whose progress the user
  // watched, when it is one of them).
  if (tied.length === 1 || !judge) return tied[0];

  const scored = await Promise.all(
    tied.map(async (r) => {
      if (typeof r.aestheticScore === "number") return { r, score: r.aestheticScore };
      if (!r.pendingJudge) return { r, score: -1 };
      const j = await judge(r.pendingJudge).catch(
        (): AestheticJudgement => ({ available: false })
      );
      if (!j.available) return { r, score: -1 };
      // Scored now, so the job must not score it again after `done`.
      return {
        r: {
          ...r,
          aestheticScore: j.score ?? null,
          aestheticDims: j.perDimension ?? null,
          pendingJudge: undefined,
        },
        score: j.score ?? -1,
      };
    })
  );
  return scored.reduce((a, b) => (b.score > a.score ? b : a)).r;
}
