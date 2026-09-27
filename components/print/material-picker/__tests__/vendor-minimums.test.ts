import { describe, it, expect } from "vitest";
import {
  effectiveUnitPrice,
  minimumFee,
  pickMinimumProbes,
  probesForQuotes,
  quoteTotal,
} from "../vendor-minimums";
import { aggregateFinishCards } from "../finish-cards";
import { vendorQuoteBadges } from "../vendor-badges";
import type { EnrichedQuote } from "../types";

// Live numbers from a Caribiner quote (Sep 2026): Panashape's $7.27 part
// sits under its $33 minimum; JawsTec has none and costs more per item.
const minimums = new Map([
  ["panashape", 33],
  ["jawstec", 0],
]);
const shipping = [
  { vendorId: "panashape", price: 0, shippingId: "s-pana" },
  { vendorId: "jawstec", price: 13.97, shippingId: "s-jaws" },
  { vendorId: "jawstec", price: 20, shippingId: "s-jaws-fast" },
];
const shipMap = new Map([
  ["panashape", 0],
  ["jawstec", 13.97],
]);

describe("minimum fee math", () => {
  it("tops production up to the vendor minimum, never below zero", () => {
    expect(minimumFee({ vendorId: "panashape", price: 7.27 }, 1, minimums)).toBeCloseTo(25.73);
    expect(minimumFee({ vendorId: "panashape", price: 7.27 }, 5, minimums)).toBe(0);
    expect(minimumFee({ vendorId: "jawstec", price: 12.46 }, 1, minimums)).toBe(0);
  });

  it("treats an unprobed vendor as minimum-free", () => {
    expect(minimumFee({ vendorId: "unknown", price: 1 }, 1, minimums)).toBe(0);
    expect(minimumFee({ vendorId: "panashape", price: 1 }, 1, undefined)).toBe(0);
  });

  it("ranks the real Caribiner quotes by what the buyer pays", () => {
    const pana = quoteTotal({ vendorId: "panashape", price: 7.27 }, 1, shipMap, minimums);
    const jaws = quoteTotal({ vendorId: "jawstec", price: 12.46 }, 1, shipMap, minimums);
    expect(pana).toBeCloseTo(33);
    expect(jaws).toBeCloseTo(26.43);
    expect(jaws).toBeLessThan(pana);
  });

  it("spreads the fee across units for the per-unit label", () => {
    expect(effectiveUnitPrice({ vendorId: "panashape", price: 7.27 }, 1, minimums)).toBeCloseTo(33);
    expect(effectiveUnitPrice({ vendorId: "panashape", price: 7.27 }, 2, minimums)).toBeCloseTo(16.5);
  });
});

describe("probe selection", () => {
  const q = (quoteId: string, vendorId: string, materialId: string, price: number) => ({
    quoteId,
    vendorId,
    materialId,
    price,
  });

  it("probes the cheapest few vendors per material, once each, with their cheapest shipping", () => {
    const probes = pickMinimumProbes(
      [
        q("q1", "panashape", "pa12", 7.27),
        q("q2", "jawstec", "pa12", 12.46),
        q("q3", "jawstec", "pa12", 11),
        q("q4", "panashape", "resin", 9),
        q("q5", "noship", "pa12", 1),
      ],
      shipping,
      1,
      1
    );
    // pa12's cheapest shippable vendor is panashape; resin's too — one probe.
    expect(probes).toEqual([{ vendorId: "panashape", quoteId: "q1", shippingId: "s-pana" }]);
  });

  it("widens to the top N per material", () => {
    const probes = pickMinimumProbes(
      [q("q1", "panashape", "pa12", 7.27), q("q3", "jawstec", "pa12", 11)],
      shipping,
      1,
      2
    );
    expect(probes.map((p) => p.vendorId).sort()).toEqual(["jawstec", "panashape"]);
    expect(probes.find((p) => p.vendorId === "jawstec")?.shippingId).toBe("s-jaws");
  });

  it("probesForQuotes dedupes vendors and skips ones without shipping", () => {
    expect(
      probesForQuotes(
        [
          { quoteId: "a", vendorId: "jawstec" },
          { quoteId: "b", vendorId: "jawstec" },
          { quoteId: "c", vendorId: "noship" },
        ],
        shipping
      )
    ).toEqual([{ vendorId: "jawstec", quoteId: "a", shippingId: "s-jaws" }]);
  });
});

describe("consumers fold the minimum in", () => {
  const base = {
    modelId: "m",
    quantity: 1,
    currency: "USD",
    productionTimeFast: 5,
    productionTimeSlow: 7,
    scale: 1,
    vendorName: "",
    vendorCountryCode: "US",
    vendorStateCode: null,
    materialConfigId: "cfg",
    materialId: "pa12",
    materialName: "PA12",
    materialGroupId: "g",
    materialGroupName: "G",
    materialImage: null,
    materialSortIndex: 0,
    finishGroupImage: null,
    color: "White",
    colorCode: "#fff",
    configName: "",
  } satisfies Partial<EnrichedQuote>;
  const quotes: EnrichedQuote[] = [
    { ...base, quoteId: "pana", vendorId: "panashape", price: 7.27, finishGroupId: "std", finishGroupName: "Standard" },
    { ...base, quoteId: "jaws", vendorId: "jawstec", price: 12.46, finishGroupId: "dyed", finishGroupName: "Dyed" },
  ];

  it("finish cards sort and label by the real price", () => {
    const cards = aggregateFinishCards(quotes, shipping, 1, "pa12", minimums);
    expect(cards.map((c) => c.finishGroupId)).toEqual(["dyed", "std"]);
    expect(cards.find((c) => c.finishGroupId === "std")?.cheapest).toBeCloseTo(33);
    // Without minimums, the old (misleading) order comes back.
    expect(aggregateFinishCards(quotes, shipping, 1, "pa12").map((c) => c.finishGroupId)).toEqual(["std", "dyed"]);
  });

  it("the Cheapest badge goes to the vendor that is actually cheapest", () => {
    const badges = vendorQuoteBadges(quotes, shipping, 1, minimums);
    expect(badges.get("jaws")?.cheapest).toBe(true);
    expect(badges.get("pana")?.cheapest).toBe(false);
  });
});
