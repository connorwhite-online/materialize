import { describe, expect, it } from "vitest";
import {
  groupDiversityRescorer,
  positionDiscount,
  qualityBoost,
  rescore,
  type Candidate,
  type Rescorer,
} from "@/lib/discovery/rescoring";

const params = { decay: 0.5, floor: 0.25 };

describe("positionDiscount", () => {
  it("leaves the first item in a group untouched", () => {
    expect(positionDiscount(0, params)).toBe(1);
  });

  it("decays exponentially toward the floor without reaching it", () => {
    const discounts = [0, 1, 2, 3, 10].map((p) => positionDiscount(p, params));
    // Strictly decreasing…
    for (let i = 1; i < discounts.length; i++) {
      expect(discounts[i]).toBeLessThan(discounts[i - 1]);
    }
    // …but never below the floor, which is the whole point of having
    // one: a great fourth item can still outrank a weak first item.
    for (const discount of discounts) {
      expect(discount).toBeGreaterThan(params.floor);
    }
    expect(positionDiscount(1, params)).toBeCloseTo(0.625, 5);
  });
});

describe("groupDiversityRescorer", () => {
  const candidate = (
    id: string,
    creator: string | null,
    score: number
  ): Candidate<{ creator: string | null }> => ({
    id,
    item: { creator },
    score,
  });

  it("discounts by rank within a group, not by input order", () => {
    const rescorer = groupDiversityRescorer<{ creator: string | null }>(
      (item) => item.creator,
      params
    );
    // b is listed first but scores lower, so a holds position 0.
    const factors = rescorer([
      candidate("b", "ann", 1),
      candidate("a", "ann", 9),
    ]);
    expect(factors.get("a")).toBe(1);
    expect(factors.get("b")).toBeCloseTo(0.625, 5);
  });

  it("does not lump keyless candidates into one bucket", () => {
    const rescorer = groupDiversityRescorer<{ creator: string | null }>(
      (item) => item.creator,
      params
    );
    const factors = rescorer([
      candidate("a", null, 3),
      candidate("b", null, 2),
    ]);
    // Two rows with no creator resolved are not "the same creator" —
    // penalising them for each other's existence would be a bug.
    expect(factors.has("a")).toBe(false);
    expect(factors.has("b")).toBe(false);
  });

  it("is deterministic when scores tie", () => {
    const rescorer = groupDiversityRescorer<{ creator: string | null }>(
      (item) => item.creator,
      params
    );
    const first = rescorer([candidate("b", "ann", 5), candidate("a", "ann", 5)]);
    const second = rescorer([candidate("a", "ann", 5), candidate("b", "ann", 5)]);
    expect(first.get("a")).toBe(second.get("a"));
    expect(first.get("b")).toBe(second.get("b"));
  });
});

describe("rescore", () => {
  const items: Candidate<null>[] = [
    { id: "a", item: null, score: 10 },
    { id: "b", item: null, score: 8 },
  ];
  const halve: Rescorer<null> = () => new Map([["a", 0.5]]);
  const double: Rescorer<null> = (candidates) =>
    // Reads the input score: if rescorers were chained instead of
    // multiplied at the end, this would see a's halved score and the
    // result would depend on the order of the array below.
    new Map(candidates.map((c) => [c.id, c.score > 9 ? 2 : 1]));

  it("does not depend on the order rescorers are listed in", () => {
    const forwards = rescore(items, [halve, double]).map((c) => [c.id, c.score]);
    const backwards = rescore(items, [double, halve]).map((c) => [c.id, c.score]);
    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual([
      ["a", 10],
      ["b", 8],
    ]);
  });

  it("multiplies every factor and sorts descending", () => {
    const ranked = rescore(items, [halve]);
    expect(ranked.map((c) => c.id)).toEqual(["b", "a"]);
    expect(ranked[0].score).toBe(8);
    expect(ranked[1].score).toBe(5);
  });

  it("clamps non-finite and negative scores instead of dropping them", () => {
    const ranked = rescore(
      [
        { id: "nan", item: null, score: Number.NaN },
        { id: "neg", item: null, score: -5 },
        { id: "ok", item: null, score: 1 },
      ],
      []
    );
    expect(ranked.map((c) => c.id)).toEqual(["ok", "nan", "neg"]);
    expect(ranked[1].score).toBe(0);
    expect(ranked[2].score).toBe(0);
  });
});

describe("qualityBoost", () => {
  const boostParams = { maxBoost: 0.3, halfBoostAt: 3 };

  it("is bounded by 1 + maxBoost however popular the item", () => {
    expect(qualityBoost(0, boostParams)).toBe(1);
    expect(qualityBoost(3, boostParams)).toBeCloseTo(1.15, 5);
    expect(qualityBoost(1e9, boostParams)).toBeLessThanOrEqual(1.3);
    expect(qualityBoost(1e9, boostParams)).toBeGreaterThan(1.29);
  });

  it("cannot promote a weaker match past a stronger one", () => {
    // The bound is what makes this safe to stack on relevance: an
    // exact-title match (1.0) beats a substring match (0.4) no matter
    // how popular the substring match is.
    expect(0.4 * qualityBoost(1e9, boostParams)).toBeLessThan(1);
  });
});
