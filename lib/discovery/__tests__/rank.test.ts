import { describe, expect, it } from "vitest";
import {
  rankBrowseRows,
  rankOrderedRows,
  rankSearchRows,
} from "@/lib/discovery/rank";

const now = new Date("2026-08-27T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

interface Row {
  id: string;
  name: string;
  creator: string;
  downloadCount: number;
  recentDownloads: number;
  createdAt: Date | null;
  tags?: string[];
}

const row = (over: Partial<Row> & { id: string }): Row => ({
  name: over.id,
  creator: "ann",
  downloadCount: 0,
  recentDownloads: 0,
  createdAt: daysAgo(200),
  ...over,
});

describe("rankBrowseRows", () => {
  it("breaks up a single creator's run without banning them from the grid", () => {
    // Ann out-downloads everyone; sorted by download_count she takes
    // the whole grid, which is what the browse page did before.
    const rows = [
      row({ id: "ann-1", creator: "ann", downloadCount: 900, recentDownloads: 90 }),
      row({ id: "ann-2", creator: "ann", downloadCount: 800, recentDownloads: 80 }),
      row({ id: "ann-3", creator: "ann", downloadCount: 700, recentDownloads: 70 }),
      row({ id: "bo-1", creator: "bo", downloadCount: 120, recentDownloads: 12 }),
      row({ id: "cy-1", creator: "cy", downloadCount: 90, recentDownloads: 9 }),
    ];
    const ranked = rankBrowseRows(rows, {
      creatorKey: (r) => r.creator,
      now,
      limit: 4,
    });

    // Her best file still leads — diversity discounts, it does not
    // punish — but she no longer holds three consecutive slots, and
    // both other creators are on the first screen.
    expect(ranked[0].id).toBe("ann-1");
    expect(ranked[1].creator).not.toBe("ann");
    const creators = ranked.map((r) => r.creator);
    expect(creators).toContain("bo");
    expect(creators).toContain("cy");
    expect(creators.filter((c) => c === "ann")).toHaveLength(2);
  });

  it("lets a new listing past the dormant long tail, but not past live demand", () => {
    // The freshness boost is calibrated against the recent-downloads
    // term (see PopularityParams): a day-old listing should clear a
    // file with some lifetime downloads and nothing happening now, and
    // should lose to one people are actually downloading this month.
    const fresh = row({
      id: "new",
      creator: "bo",
      downloadCount: 0,
      recentDownloads: 0,
      createdAt: now,
    });
    const dormant = row({
      id: "dormant",
      creator: "ann",
      downloadCount: 60,
      recentDownloads: 0,
      createdAt: daysAgo(600),
    });
    const inDemand = row({
      id: "in-demand",
      creator: "cy",
      downloadCount: 60,
      recentDownloads: 25,
      createdAt: daysAgo(600),
    });

    const ranked = rankBrowseRows([dormant, inDemand, fresh], {
      creatorKey: (r) => r.creator,
      now,
    });
    expect(ranked.map((r) => r.id)).toEqual(["in-demand", "new", "dormant"]);
  });

  it("is stable across calls for identical input", () => {
    const rows = [
      row({ id: "a", creator: "ann" }),
      row({ id: "b", creator: "bo" }),
      row({ id: "c", creator: "cy" }),
    ];
    const first = rankBrowseRows(rows, { creatorKey: (r) => r.creator });
    const second = rankBrowseRows(rows, { creatorKey: (r) => r.creator });
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });
});

describe("rankSearchRows", () => {
  it("puts the best match first regardless of how new the others are", () => {
    // The bug this exists to fix: rows came back ordered by createdAt,
    // so the newest listing containing the string beat an exact title.
    const rows = [
      { id: "newest", name: "Dragon Egg Holder v3", creator: "bo", downloadCount: 5 },
      { id: "exact", name: "Dragon", creator: "ann", downloadCount: 2 },
      { id: "tagged", name: "Scaly Thing", creator: "cy", downloadCount: 0, tags: ["dragon"] },
    ];
    const ranked = rankSearchRows("dragon", rows, {
      creatorKey: (r) => r.creator,
    });
    expect(ranked.map((r) => r.id)).toEqual(["exact", "newest", "tagged"]);
  });

  it("lets popularity break a tie but never overturn a better match", () => {
    const tie = rankSearchRows(
      "dragon",
      [
        { id: "quiet", name: "Dragon Bookend", creator: "ann", downloadCount: 0 },
        { id: "loved", name: "Dragon Bracket", creator: "bo", downloadCount: 5000 },
      ],
      { creatorKey: (r) => r.creator }
    );
    expect(tie[0].id).toBe("loved");

    const beaten = rankSearchRows(
      "dragon",
      [
        { id: "exact", name: "Dragon", creator: "ann", downloadCount: 0 },
        { id: "loved", name: "Dragon Bracket", creator: "bo", downloadCount: 500_000 },
      ],
      { creatorKey: (r) => r.creator }
    );
    expect(beaten[0].id).toBe("exact");
  });

  it("drops rows it can see no match in rather than padding the results", () => {
    const ranked = rankSearchRows(
      "dragon",
      [
        { id: "hit", name: "Dragon", creator: "ann" },
        // Matched by an ILIKE on a column the ranker cannot see.
        { id: "miss", name: "Coat Hook", creator: "bo" },
      ],
      { creatorKey: (r) => r.creator }
    );
    expect(ranked.map((r) => r.id)).toEqual(["hit"]);
  });

  it("keeps a specialist's results together on a specific query", () => {
    // Search diversity is deliberately gentle: someone searching for
    // articulated dragons is entitled to a page of them.
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `ann-${i}`,
      name: `Articulated Dragon Mk${i}`,
      creator: "ann",
      downloadCount: 100 - i,
    }));
    const ranked = rankSearchRows(
      "articulated dragon",
      [...rows, { id: "bo-1", name: "Dragon Sticker", creator: "bo", downloadCount: 1 }],
      { creatorKey: (r) => r.creator, limit: 3 }
    );
    expect(ranked.every((r) => r.creator === "ann")).toBe(true);
  });
});

describe("rankOrderedRows", () => {
  it("keeps the diversity discount meaningful at any list length", () => {
    // A linear position score made this length-dependent: the same two
    // rows reordered in a list of 40 and refused to in a list of 3.
    const short = rankOrderedRows(
      [
        { id: "ann-1", creator: "ann" },
        { id: "ann-2", creator: "ann" },
        { id: "bo-1", creator: "bo" },
      ],
      { creatorKey: (r) => r.creator }
    ).map((r) => r.id);

    const padded = rankOrderedRows(
      [
        { id: "ann-1", creator: "ann" },
        { id: "ann-2", creator: "ann" },
        { id: "bo-1", creator: "bo" },
        ...Array.from({ length: 30 }, (_, i) => ({
          id: `filler-${i}`,
          creator: `filler-${i}`,
        })),
      ],
      { creatorKey: (r) => r.creator }
    )
      .map((r) => r.id)
      .filter((id) => !id.startsWith("filler"));

    expect(short).toEqual(padded);
  });

  it("preserves the incoming order when every row has a distinct creator", () => {
    const rows = [
      { id: "a", creator: "ann" },
      { id: "b", creator: "bo" },
      { id: "c", creator: "cy" },
    ];
    expect(
      rankOrderedRows(rows, { creatorKey: (r) => r.creator }).map((r) => r.id)
    ).toEqual(["a", "b", "c"]);
  });

  it("still spreads a repeated creator", () => {
    const rows = [
      { id: "ann-1", creator: "ann" },
      { id: "ann-2", creator: "ann" },
      { id: "bo-1", creator: "bo" },
    ];
    expect(
      rankOrderedRows(rows, { creatorKey: (r) => r.creator }).map((r) => r.id)
    ).toEqual(["ann-1", "bo-1", "ann-2"]);
  });
});
