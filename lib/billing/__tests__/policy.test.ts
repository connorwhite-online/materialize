import { describe, it, expect, vi, beforeEach } from "vitest";

// Hand out spending-ledger rows in call order. Each call to
// db.select(...).from().where() resolves to the next entry.
let ledgerResults: Array<Array<{ amountCents: number }>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(ledgerResults.shift() ?? []),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  tokenSpendingLedger: {
    tokenId: "token_id",
    amountCents: "amount_cents",
    chargedAt: "charged_at",
  },
}));

import {
  evaluateSpendingPolicy,
  computePeriodStart,
  type SpendingPolicy,
} from "../policy";

const basePolicy: SpendingPolicy = {
  perOrderLimitCents: 5000,
  periodBudgetCents: 20000,
  periodWindow: "month",
};

const baseInput = {
  tokenId: "tok_1",
  vendorId: "vendor_a",
  materialId: "material_a",
  hasPaymentMethod: true,
};

describe("evaluateSpendingPolicy", () => {
  beforeEach(() => {
    ledgerResults = [];
  });

  it("rejects when no policy is configured", async () => {
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: null,
      orderTotalCents: 1000,
    });
    expect(result).toEqual({
      approved: false,
      reason: expect.stringContaining("No spending policy"),
    });
  });

  it("rejects when no payment method is on file (even with a permissive policy)", async () => {
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      hasPaymentMethod: false,
      policy: basePolicy,
      orderTotalCents: 1000,
    });
    if (result.approved) throw new Error("expected reject");
    expect(result.reason).toMatch(/payment method/i);
  });

  it("rejects when the order exceeds the per-order limit", async () => {
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: basePolicy,
      orderTotalCents: 6000,
    });
    if (result.approved) throw new Error("expected reject");
    expect(result.reason).toMatch(/per-order limit/i);
    expect(result.reason).toContain("$50.00");
    expect(result.reason).toContain("$60.00");
  });

  it("rejects when an order is over the soft confirmAbove threshold", async () => {
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: { ...basePolicy, confirmAboveCents: 2500 },
      orderTotalCents: 3000,
    });
    if (result.approved) throw new Error("expected reject");
    expect(result.reason).toMatch(/requires confirmation/i);
  });

  it("approves when an order is at or below the soft threshold", async () => {
    ledgerResults = [[]]; // empty ledger
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: { ...basePolicy, confirmAboveCents: 3000 },
      orderTotalCents: 3000,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects when vendor is not in the allowlist", async () => {
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      vendorId: "vendor_b",
      policy: { ...basePolicy, allowedVendorIds: ["vendor_a"] },
      orderTotalCents: 1000,
    });
    if (result.approved) throw new Error("expected reject");
    expect(result.reason).toMatch(/vendor/i);
  });

  it("ignores an empty allowlist (treats it as no restriction)", async () => {
    ledgerResults = [[]];
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      vendorId: "vendor_b",
      policy: { ...basePolicy, allowedVendorIds: [] },
      orderTotalCents: 1000,
    });
    expect(result.approved).toBe(true);
  });

  it("rejects when the period budget would be exceeded", async () => {
    ledgerResults = [
      [{ amountCents: 18000 }, { amountCents: 1500 }], // 19500 spent
    ];
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: basePolicy,
      orderTotalCents: 1000,
    });
    if (result.approved) throw new Error("expected reject");
    expect(result.reason).toMatch(/month budget/i);
    expect(result.reason).toContain("$200.00");
  });

  it("approves and surfaces the remaining budget when within limits", async () => {
    ledgerResults = [[{ amountCents: 5000 }]];
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: basePolicy,
      orderTotalCents: 2000,
    });
    if (!result.approved) throw new Error("expected approve");
    expect(result.remainingPeriodBudgetCents).toBe(20000 - 5000 - 2000);
    expect(result.cancellationWindowMinutes).toBe(5);
  });

  it("honors a custom cancellationWindowMinutes (including 0)", async () => {
    ledgerResults = [[]];
    const result = await evaluateSpendingPolicy({
      ...baseInput,
      policy: { ...basePolicy, cancellationWindowMinutes: 0 },
      orderTotalCents: 2000,
    });
    if (!result.approved) throw new Error("expected approve");
    expect(result.cancellationWindowMinutes).toBe(0);
  });
});

describe("computePeriodStart", () => {
  it("day window snaps to UTC midnight", () => {
    const now = new Date("2026-05-06T15:30:45Z");
    expect(computePeriodStart("day", now).toISOString()).toBe(
      "2026-05-06T00:00:00.000Z"
    );
  });

  it("week window snaps to ISO Monday midnight UTC", () => {
    // 2026-05-06 is a Wednesday — week start should be Monday 2026-05-04
    const wed = new Date("2026-05-06T15:30:45Z");
    expect(computePeriodStart("week", wed).toISOString()).toBe(
      "2026-05-04T00:00:00.000Z"
    );
  });

  it("week window handles Sunday correctly (wraps to previous Monday)", () => {
    // 2026-05-10 is a Sunday — week start should be Monday 2026-05-04
    const sun = new Date("2026-05-10T15:30:45Z");
    expect(computePeriodStart("week", sun).toISOString()).toBe(
      "2026-05-04T00:00:00.000Z"
    );
  });

  it("month window snaps to first-of-month midnight UTC", () => {
    const mid = new Date("2026-05-06T15:30:45Z");
    expect(computePeriodStart("month", mid).toISOString()).toBe(
      "2026-05-01T00:00:00.000Z"
    );
  });
});
