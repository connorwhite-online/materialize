import { describe, it, expect } from "vitest";
import {
  aggregateFinishCards,
  pickDefaultFinishGroupId,
} from "../finish-cards";
import type { EnrichedQuote } from "../types";

function quote(overrides: Partial<EnrichedQuote>): EnrichedQuote {
  return {
    quoteId: "q",
    vendorId: "v1",
    vendorName: "v",
    vendorCountryCode: null,
    vendorStateCode: null,
    modelId: "m",
    materialConfigId: "mc",
    quantity: 1,
    price: 10,
    currency: "USD",
    productionTimeFast: 1,
    productionTimeSlow: 2,
    scale: 1,
    materialId: "pla",
    materialName: "PLA",
    materialGroupId: "g",
    materialGroupName: "G",
    materialImage: null,
    materialSortIndex: 1,
    finishGroupId: "standard",
    finishGroupName: "Standard",
    finishGroupImage: "std.png",
    color: "white",
    colorCode: "#fff",
    configName: "default",
    ...overrides,
  };
}

describe("aggregateFinishCards", () => {
  const quotes: EnrichedQuote[] = [
    quote({
      quoteId: "1",
      finishGroupId: "polished",
      finishGroupName: "Polished",
      finishGroupImage: "pol.png",
      price: 20,
      color: "white",
    }),
    quote({
      quoteId: "2",
      finishGroupId: "polished",
      finishGroupName: "Polished",
      finishGroupImage: "pol.png",
      price: 18,
      color: "black",
      vendorId: "v2",
    }),
    quote({
      quoteId: "3",
      finishGroupId: "standard",
      finishGroupName: "Standard",
      price: 8,
      color: "white",
    }),
    quote({
      quoteId: "4",
      materialId: "petg",
      finishGroupId: "other",
      finishGroupName: "Other",
      price: 1,
    }),
  ];

  it("groups by finish, ignores other materials, and sorts cheapest-total first", () => {
    const cards = aggregateFinishCards(quotes, [], 1, "pla");
    expect(cards.map((c) => c.finishGroupId)).toEqual([
      "standard",
      "polished",
    ]);
    expect(cards[0]).toMatchObject({
      finishGroupName: "Standard",
      cheapest: 8,
      colorCount: 1,
      configCount: 1,
    });
    expect(cards[1]).toMatchObject({
      finishGroupName: "Polished",
      cheapest: 18,
      colorCount: 2,
      configCount: 2,
      finishGroupImage: "pol.png",
    });
  });

  it("weights production by sortQuantity when ranking finishes", () => {
    // Polished @ $18 + $1 ship beats Standard @ $8 + $40 ship at qty 1,
    // but Standard wins once quantity makes production dominate.
    const shipping = [
      { vendorId: "v1", price: 40 },
      { vendorId: "v2", price: 1 },
    ];
    const atOne = aggregateFinishCards(quotes, shipping, 1, "pla");
    expect(atOne[0].finishGroupId).toBe("polished");

    const atTen = aggregateFinishCards(quotes, shipping, 10, "pla");
    expect(atTen[0].finishGroupId).toBe("standard");
  });
});

describe("pickDefaultFinishGroupId", () => {
  const cards = [
    {
      finishGroupId: "cheap",
      finishGroupName: "Cheap",
      finishGroupImage: null,
      cheapest: 5,
      cheapestTotal: 5,
      configCount: 1,
      colorCount: 1,
    },
    {
      finishGroupId: "fancy",
      finishGroupName: "Fancy",
      finishGroupImage: null,
      cheapest: 20,
      cheapestTotal: 20,
      configCount: 1,
      colorCount: 1,
    },
  ];

  it("returns null when there are no finishes", () => {
    expect(pickDefaultFinishGroupId([])).toBeNull();
  });

  it("picks the first (cheapest) card when no preference is given", () => {
    expect(pickDefaultFinishGroupId(cards)).toBe("cheap");
  });

  it("honors a preferred id that is still in the set", () => {
    expect(pickDefaultFinishGroupId(cards, "fancy")).toBe("fancy");
  });

  it("falls back to cheapest when the preferred id is gone", () => {
    expect(pickDefaultFinishGroupId(cards, "vanished")).toBe("cheap");
  });
});
