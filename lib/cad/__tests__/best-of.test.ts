import { describe, it, expect, vi } from "vitest";
import { objectiveRank, pickBestCandidate } from "@/lib/cad/best-of";
import type { HarnessResult } from "@/lib/cad/harness";

function cand(
  id: string,
  opts: { dimFails?: number; dimUnrun?: number; dfmOk?: boolean | undefined; score?: number } = {}
): HarnessResult {
  const checks = [
    ...Array.from({ length: opts.dimFails ?? 0 }, () => ({ ran: true, ok: false })),
    ...Array.from({ length: opts.dimUnrun ?? 0 }, () => ({ ran: false, ok: null })),
    { ran: true, ok: true },
  ];
  return {
    ok: true,
    sourceCode: id,
    attempts: 1,
    run: {
      ok: true,
      files: {},
      validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true },
      ...(opts.dfmOk === undefined ? {} : { checks: { dfm: { ok: opts.dfmOk } } }),
    },
    dimensionChecks: checks as never,
    aestheticScore: opts.score ?? null,
    pendingJudge: { prompt: id },
  } as HarnessResult;
}

describe("objectiveRank", () => {
  it("counts only checks that ran and failed", () => {
    expect(objectiveRank(cand("a", { dimFails: 2, dimUnrun: 3, dfmOk: false }))).toEqual([2, 1]);
    // an unrun printability check is unknown, not bad
    expect(objectiveRank(cand("b"))).toEqual([0, 0]);
  });
});

describe("pickBestCandidate", () => {
  it("picks on objective checks without calling the judge, even over a higher score", async () => {
    const judge = vi.fn();
    const best = await pickBestCandidate(
      [cand("pretty", { dimFails: 1, score: 95 }), cand("correct", { score: 40 })],
      judge
    );
    expect(best.sourceCode).toBe("correct");
    expect(judge).not.toHaveBeenCalled();
  });

  it("dimensions outrank printability", async () => {
    const best = await pickBestCandidate([
      cand("dims", { dimFails: 1, dfmOk: true }),
      cand("dfm", { dfmOk: false }),
    ]);
    expect(best.sourceCode).toBe("dfm");
  });

  it("breaks an objective tie with the judge, and marks the winner scored", async () => {
    const judge = vi.fn(async (req: { prompt: string }) => ({
      available: true,
      score: req.prompt === "b" ? 80 : 50,
      perDimension: {},
    }));
    const best = await pickBestCandidate([cand("a"), cand("b"), cand("c", { dimFails: 1 })], judge);
    expect(best.sourceCode).toBe("b");
    expect(best.aestheticScore).toBe(80);
    // scored now, so the job must not score it again after `done`
    expect(best.pendingJudge).toBeUndefined();
    expect(judge).toHaveBeenCalledTimes(2); // only the tied pair
  });

  it("keeps the first of a tie when there is no judge or it fails", async () => {
    expect((await pickBestCandidate([cand("a"), cand("b")])).sourceCode).toBe("a");
    const broken = vi.fn(async () => {
      throw new Error("judge down");
    });
    expect((await pickBestCandidate([cand("a"), cand("b")], broken)).sourceCode).toBe("a");
  });
});
