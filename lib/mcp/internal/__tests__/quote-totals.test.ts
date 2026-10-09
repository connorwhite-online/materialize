import { describe, it, expect } from "vitest";
import { addBusinessDays, arrivalWindow, parseDays, trimQuotes, byBuyerTotal, chooseLead, processOf, quoteTotals, vendorsToProbe } from "../quote-totals";

const noMinimums = new Map<string, number>();

describe("quoteTotals", () => {
  it("adds shipping and the 3% service fee on the pre-shipping subtotal", () => {
    const t = quoteTotals(
      { vendorId: "v1", priceCents: 354, shippingPriceCents: 745 },
      1,
      new Map([["v1", 0]])
    );
    expect(t).toEqual({
      minimumFeeCents: 0,
      minimumKnown: true,
      serviceFeeCents: 11,
      totalCents: 354 + 745 + 11,
    });
  });

  it("tops production up to the vendor minimum, and charges the fee on that", () => {
    const t = quoteTotals(
      { vendorId: "panashape", priceCents: 727, shippingPriceCents: 500 },
      1,
      new Map([["panashape", 33]])
    );
    expect(t.minimumFeeCents).toBe(3300 - 727);
    expect(t.serviceFeeCents).toBe(99);
    expect(t.totalCents).toBe(3300 + 500 + 99);
  });

  it("applies the minimum to the order, not per unit", () => {
    const t = quoteTotals(
      { vendorId: "v", priceCents: 1000, shippingPriceCents: 0 },
      4,
      new Map([["v", 33]])
    );
    expect(t.minimumFeeCents).toBe(0);
    expect(t.totalCents).toBe(4000 + 120);
  });

  it("flags an unprobed vendor and leaves the total null without shipping", () => {
    const t = quoteTotals(
      { vendorId: "v", priceCents: 500, shippingPriceCents: null },
      1,
      noMinimums
    );
    expect(t.minimumKnown).toBe(false);
    expect(t.totalCents).toBeNull();
  });
});

describe("byBuyerTotal", () => {
  it("ranks by what the buyer pays, so a cheap item at a minimum vendor drops", () => {
    const cheapItem = { priceCents: 727, totalCents: 3899 };
    const dearerItem = { priceCents: 1200, totalCents: 1736 };
    const noShipping = { priceCents: 100, totalCents: null };
    expect(
      [cheapItem, noShipping, dearerItem].sort(byBuyerTotal)
    ).toEqual([dearerItem, cheapItem, noShipping]);
  });
});

describe("vendorsToProbe", () => {
  const q = (vendorId: string, priceCents: number, materialId = "pla") => ({
    vendorId,
    materialId,
    priceCents,
    shippingPriceCents: 500,
  });

  it("asks for a pricier vendor when every probed one has a high minimum", () => {
    // a, b were probed and both top up to $33; c's $12 item can still win.
    const quotes = [q("a", 300), q("b", 400), q("c", 1200)];
    const minimums = new Map([["a", 33], ["b", 33]]);
    expect(vendorsToProbe(quotes, 1, minimums, new Set(["a", "b"]))).toEqual(["c"]);
  });

  it("stops once no unprobed vendor can undercut the best known total", () => {
    const quotes = [q("a", 300), q("c", 1200)];
    const minimums = new Map([["a", 0]]);
    expect(vendorsToProbe(quotes, 1, minimums, new Set(["a"]))).toEqual([]);
  });

  it("judges each material on its own and skips vendors already attempted", () => {
    const quotes = [q("a", 300, "pla"), q("x", 900, "nylon"), q("y", 800, "nylon")];
    const minimums = new Map([["a", 0]]);
    expect(vendorsToProbe(quotes, 1, minimums, new Set(["a", "x"]))).toEqual(["y"]);
  });
});

describe("arrivalWindow", () => {
  // Thursday 2026-10-08.
  const thu = new Date(Date.UTC(2026, 9, 8, 15));

  it("adds production and shipping business days, skipping weekends", () => {
    expect(addBusinessDays(thu, 1).toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(addBusinessDays(thu, 2).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(
      arrivalWindow({ productionTimeFastDays: 5, productionTimeSlowDays: 7, shippingDaysMin: 3, shippingDaysMax: 3 }, thu)
    ).toEqual({ arrivesEarliest: "2026-10-20", arrivesLatest: "2026-10-22" });
  });

  it("is null without a shipping time, and uses one production time when the other is missing", () => {
    expect(
      arrivalWindow({ productionTimeFastDays: 5, productionTimeSlowDays: 7, shippingDaysMin: null, shippingDaysMax: null }, thu)
    ).toBeNull();
    expect(
      arrivalWindow({ productionTimeFastDays: null, productionTimeSlowDays: 4, shippingDaysMin: 1, shippingDaysMax: 1 }, thu)
    ).toEqual({ arrivesEarliest: "2026-10-15", arrivesLatest: "2026-10-15" });
  });
});

describe("processOf / chooseLead", () => {
  it("reads the process from the material name or its printing method", () => {
    expect(processOf({ name: "SLS Nylon PA12" })).toBe("SLS");
    expect(processOf({ name: "HP MJF Nylon PA12" })).toBe("MJF");
    expect(processOf({ name: "FDM Nylon" })).toBe("FDM");
    expect(processOf({ name: "Tough Resin", printingMethods: [{ name: "SLA" }] })).toBe("SLA");
    expect(processOf({ name: "Mystery" })).toBeNull();
  });

  const q = (quoteId: string, process: string, totalCents: number) => ({ quoteId, process, totalCents });

  it("leads with the cheapest industrial print and offers the cheaper FDM one (the nylon cube)", () => {
    const lead = chooseLead([q("fdm", "FDM", 2435), q("sls", "SLS", 4391), q("mjf", "MJF", 4465)]);
    expect(lead).toEqual({
      quoteId: "sls",
      why: "industrial",
      alternative: { quoteId: "fdm", kind: "cheaper", deltaCents: 1956 },
    });
  });

  it("leads with the cheapest when industrial costs over twice as much, and offers it as the upgrade", () => {
    const lead = chooseLead([q("fdm", "FDM", 2000), q("sls", "SLS", 4500)]);
    expect(lead).toEqual({
      quoteId: "fdm",
      why: "cheapest",
      alternative: { quoteId: "sls", kind: "upgrade", deltaCents: 2500 },
    });
  });

  it("has no alternative when everything is FDM, or industrial is already cheapest", () => {
    expect(chooseLead([q("a", "FDM", 1000), q("b", "FDM", 1200)])).toEqual({ quoteId: "a", why: "cheapest", alternative: null });
    expect(chooseLead([q("s", "SLS", 900), q("f", "FDM", 1000)])).toEqual({ quoteId: "s", why: "cheapest", alternative: null });
    expect(chooseLead([])).toBeNull();
  });
});

describe("parseDays", () => {
  it("reads numbers and string ranges, so '4' + '2' can't become 42 days", () => {
    expect(parseDays(3)).toEqual([3, 3]);
    expect(parseDays("2")).toEqual([2, 2]);
    expect(parseDays("2-3")).toEqual([2, 3]);
    expect(parseDays("3 – 8")).toEqual([3, 8]);
    expect(parseDays(null)).toBeNull();
    expect(parseDays("soon")).toBeNull();
  });
});

describe("trimQuotes", () => {
  const q = (quoteId: string, materialId: string, vendorId: string) => ({ quoteId, materialId, vendorId });
  it("keeps the cheapest config per material + vendor, capped, plus the lead", () => {
    const rows = [q("a1", "pla", "v1"), q("a2", "pla", "v1"), q("b", "pla", "v2"), q("c", "abs", "v1"), q("d", "pa12", "v3")];
    expect(trimQuotes(rows).map((r) => r.quoteId)).toEqual(["a1", "b", "c", "d"]);
    expect(trimQuotes(rows, ["d"], 2).map((r) => r.quoteId)).toEqual(["a1", "b", "d"]);
  });
});
