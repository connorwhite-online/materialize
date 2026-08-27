import { describe, expect, it } from "vitest";
import { explainBrowseRanking, rankBrowseRows } from "@/lib/discovery/rank";
import { popularityBreakdown, popularityScore } from "@/lib/discovery/popularity";
import { rescore, rescoreWithFactors } from "@/lib/discovery/rescoring";

const now = new Date("2026-08-27T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const rows = [
  { id: "a", creator: "ann", downloadCount: 900, recentDownloads: 90, createdAt: daysAgo(300) },
  { id: "b", creator: "ann", downloadCount: 800, recentDownloads: 80, createdAt: daysAgo(280) },
  { id: "c", creator: "bo", downloadCount: 120, recentDownloads: 12, createdAt: daysAgo(30) },
  { id: "d", creator: "cy", downloadCount: 0, recentDownloads: 0, createdAt: now },
  { id: "e", creator: "cy", downloadCount: 5, recentDownloads: 0, createdAt: daysAgo(900) },
];
const options = { creatorKey: (r: (typeof rows)[number]) => r.creator, now };

describe("popularityBreakdown", () => {
  it("sums to exactly what popularityScore returns", () => {
    // popularityScore is *defined* as this total. If these ever drift,
    // the inspector explains a ranking the grid isn't using.
    for (const row of rows) {
      const parts = popularityBreakdown(row, now);
      expect(parts.recent + parts.allTime + parts.freshness).toBeCloseTo(
        parts.total,
        12
      );
      expect(parts.total).toBe(popularityScore(row, now));
    }
  });
});

describe("rescoreWithFactors", () => {
  it("agrees with rescore on order and score", () => {
    const candidates = rows.map((r, i) => ({
      id: r.id,
      item: r,
      score: 10 - i,
    }));
    const rescorers = [
      () => new Map([["a", 0.5]]),
      () => new Map([["c", 2]]),
    ];
    const plain = rescore(candidates, rescorers);
    const detailed = rescoreWithFactors(candidates, rescorers);

    expect(detailed.map((c) => c.id)).toEqual(plain.map((c) => c.id));
    expect(detailed.map((c) => c.score)).toEqual(plain.map((c) => c.score));
  });

  it("reports factors whose product takes base to final", () => {
    const detailed = rescoreWithFactors(
      [{ id: "a", item: null, score: 4 }],
      [() => new Map([["a", 0.5]]), () => new Map([["a", 0.25]])]
    );
    expect(detailed[0].baseScore).toBe(4);
    expect(detailed[0].factors).toEqual([0.5, 0.25]);
    expect(detailed[0].score).toBeCloseTo(0.5, 12);
  });
});

describe("explainBrowseRanking", () => {
  it("returns exactly the order rankBrowseRows serves", () => {
    // The inspector's whole value is that it shows the real ranking.
    // Any divergence here means it is lying about the grid.
    const served = rankBrowseRows(rows, options).map((r) => r.id);
    const explained = explainBrowseRanking(rows, options).map((e) => e.row.id);
    expect(explained).toEqual(served);
  });

  it("honours the same limit", () => {
    const served = rankBrowseRows(rows, { ...options, limit: 3 }).map((r) => r.id);
    const explained = explainBrowseRanking(rows, { ...options, limit: 3 }).map(
      (e) => e.row.id
    );
    expect(explained).toEqual(served);
    expect(explained).toHaveLength(3);
  });

  it("reports scores that reconstruct from the parts it shows", () => {
    for (const entry of explainBrowseRanking(rows, options)) {
      expect(entry.popularity.total * entry.diversityFactor).toBeCloseTo(
        entry.score,
        12
      );
    }
  });

  it("ranks 1..n in served order", () => {
    const ranks = explainBrowseRanking(rows, options).map((e) => e.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  it("shows a discount on a creator's second-best row and not their best", () => {
    const byId = new Map(
      explainBrowseRanking(rows, options).map((e) => [e.row.id, e])
    );
    // ann has two rows; "a" scores higher, so it holds position 0.
    expect(byId.get("a")!.diversityFactor).toBe(1);
    expect(byId.get("b")!.diversityFactor).toBeLessThan(1);
    // bo has one row in the pool — nothing to spread.
    expect(byId.get("c")!.diversityFactor).toBe(1);
  });
});
