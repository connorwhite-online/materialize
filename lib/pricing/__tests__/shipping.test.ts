import { describe, it, expect } from "vitest";
import { dedupeShippingByShipId } from "../shipping";

describe("dedupeShippingByShipId", () => {
  it("returns 0 for an empty list", () => {
    expect(dedupeShippingByShipId([])).toBe(0);
  });

  it("returns the single fee for one item", () => {
    expect(
      dedupeShippingByShipId([{ shippingId: "ship-1", shippingPrice: 599 }])
    ).toBe(599);
  });

  it("counts a single shipping fee once even when duplicated across items", () => {
    // The regression case: 2 same-vendor items carrying identical
    // shippingId + shippingPrice. Before the fix this summed to 1198.
    const result = dedupeShippingByShipId([
      { shippingId: "ship-1", shippingPrice: 599 },
      { shippingId: "ship-1", shippingPrice: 599 },
    ]);
    expect(result).toBe(599);
  });

  it("scales to any count of duplicated items", () => {
    const result = dedupeShippingByShipId(
      Array.from({ length: 7 }, () => ({
        shippingId: "ship-1",
        shippingPrice: 1234,
      }))
    );
    expect(result).toBe(1234);
  });

  it("sums distinct shipping IDs (multi-vendor scenarios or user picked 2 options)", () => {
    expect(
      dedupeShippingByShipId([
        { shippingId: "ship-std", shippingPrice: 500 },
        { shippingId: "ship-exp", shippingPrice: 1500 },
      ])
    ).toBe(2000);
  });

  it("keeps the first occurrence when prices differ for the same shippingId (should not happen in practice)", () => {
    // If two cart rows carry the same shippingId but somehow
    // different prices (data corruption), we take the first — the
    // alternative of picking max/avg would be even weirder. The
    // important property: we never sum them.
    const result = dedupeShippingByShipId([
      { shippingId: "ship-1", shippingPrice: 500 },
      { shippingId: "ship-1", shippingPrice: 9999 },
    ]);
    expect(result).toBe(500);
  });
});
