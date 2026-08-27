import { describe, expect, it } from "vitest";
import { popularityScore, timeDecay } from "@/lib/discovery/popularity";
import { DISCOVERY_PARAMS } from "@/lib/discovery/params";

const now = new Date("2026-08-27T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("timeDecay", () => {
  it("halves once per half-life", () => {
    expect(timeDecay(0, 100)).toBe(1);
    expect(timeDecay(100, 100)).toBeCloseTo(0.5, 10);
    expect(timeDecay(200, 100)).toBeCloseTo(0.25, 10);
  });

  it("treats a zero or negative half-life as fully decayed", () => {
    expect(timeDecay(1, 0)).toBe(0);
    expect(timeDecay(1, -1)).toBe(0);
  });

  it("decays an unknown or infinite age to nothing, not to everything", () => {
    // The freshness boost is the caller here: an item with no known
    // publication date must not read as brand new.
    expect(timeDecay(Number.POSITIVE_INFINITY, 100)).toBe(0);
    expect(timeDecay(Number.NaN, 100)).toBe(0);
  });
});

describe("popularityScore", () => {
  it("ranks current demand over a stale all-time leader", () => {
    // The exact failure of ORDER BY download_count DESC: a file that
    // won two years ago and has coasted since holds the grid against
    // something people are downloading today.
    const stale = popularityScore(
      { downloadCount: 5000, recentDownloads: 1, createdAt: daysAgo(700) },
      now
    );
    const rising = popularityScore(
      { downloadCount: 120, recentDownloads: 90, createdAt: daysAgo(120) },
      now
    );
    expect(rising).toBeGreaterThan(stale);
  });

  it("keeps a proven file ahead of a one-week wonder with the same recent pull", () => {
    const proven = popularityScore(
      { downloadCount: 4000, recentDownloads: 40, createdAt: daysAgo(400) },
      now
    );
    const newcomer = popularityScore(
      { downloadCount: 45, recentDownloads: 40, createdAt: daysAgo(300) },
      now
    );
    expect(proven).toBeGreaterThan(newcomer);
  });

  it("compresses runaway counts logarithmically", () => {
    const big = popularityScore(
      { downloadCount: 10_000, recentDownloads: 10_000, createdAt: daysAgo(500) },
      now
    );
    const small = popularityScore(
      { downloadCount: 100, recentDownloads: 100, createdAt: daysAgo(500) },
      now
    );
    // 100x the downloads, nothing like 100x the score — otherwise one
    // viral file is a permanent fixture nothing else can move.
    expect(big / small).toBeLessThan(2);
    expect(big).toBeGreaterThan(small);
  });

  it("gives a brand-new listing a head start that runs out", () => {
    const zero = { downloadCount: 0, recentDownloads: 0 };
    const today = popularityScore({ ...zero, createdAt: now }, now);
    const twoWeeks = popularityScore({ ...zero, createdAt: daysAgo(14) }, now);
    const aYear = popularityScore({ ...zero, createdAt: daysAgo(365) }, now);

    expect(today).toBeCloseTo(DISCOVERY_PARAMS.popularity.freshnessBoost, 5);
    expect(twoWeeks).toBeCloseTo(today / 2, 5);
    expect(aYear).toBeLessThan(0.01);

    // A head start, not a ranking: a modestly downloaded file already
    // outranks a brand-new one with nothing.
    expect(
      popularityScore(
        { downloadCount: 5, recentDownloads: 3, createdAt: daysAgo(200) },
        now
      )
    ).toBeGreaterThan(today);
  });

  it("survives a missing createdAt and junk counts", () => {
    const score = popularityScore(
      {
        downloadCount: Number.NaN,
        recentDownloads: -10,
        createdAt: null,
      },
      now
    );
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });
});
