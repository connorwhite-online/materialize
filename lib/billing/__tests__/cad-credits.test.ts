import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- @/lib/db: a chainable select mock handing out queued results, and an
// insert mock recording rows (with a switch simulating the partial-unique-
// index conflict so idempotency behavior is testable). ---
let selectResults: unknown[][] = [];
let insertedRows: Array<Record<string, unknown>> = [];
let simulateConflict = false;
let insertThrows = false;
const selectSpy = vi.fn();
const insertSpy = vi.fn();

function selectChain() {
  const result = () => Promise.resolve(selectResults.shift() ?? []);
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => c;
  c.orderBy = () => c;
  c.innerJoin = () => c;
  c.limit = () => result();
  c.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
    result().then(onF, onR);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      selectSpy(...args);
      return selectChain();
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertSpy(v);
        const commit = () => {
          if (insertThrows) throw new Error("db down");
          if (simulateConflict) return [];
          insertedRows.push(v);
          return [{ id: "ledger-1" }];
        };
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve().then(commit),
            then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
              Promise.resolve().then(commit).then(onF, onR),
          }),
          then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
            Promise.resolve().then(commit).then(onF, onR),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  cadCreditLedger: {
    id: "id",
    userId: "user_id",
    delta: "delta",
    reason: "reason",
    generationId: "generation_id",
    jobId: "job_id",
    printOrderId: "print_order_id",
    note: "note",
    createdAt: "created_at",
  },
  cadGenerations: {
    id: "id",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    status: "status",
    createdAt: "created_at",
  },
  printOrders: {
    id: "id",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    status: "status",
  },
}));

const logError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logError(...args),
}));

import {
  cadCreditsEnabled,
  creditCostForRoute,
  getCadCreditBalance,
  grantCadCredits,
  grantPrintThroughRefund,
  recordGenerationDebit,
  sweepPrintThroughRefunds,
} from "@/lib/billing/cad-credits";

const ENV_KEYS = [
  "CAD_CREDITS_ENABLED",
  "CAD_CREDIT_COST_SIMPLE",
  "CAD_CREDIT_COST_COMPLEX",
  "CAD_CREDIT_COST_ORGANIC",
  "CAD_PRINT_THROUGH_REFUND_CREDITS",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  insertedRows = [];
  simulateConflict = false;
  insertThrows = false;
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const debitInput = {
  userId: "user-1",
  jobId: "job-1",
  generationId: "gen-1",
  route: "simple",
};

describe("flag OFF (the shipped default) — proof of inertness", () => {
  it("cadCreditsEnabled is false by default and for anything but 'true'", () => {
    expect(cadCreditsEnabled()).toBe(false);
    process.env.CAD_CREDITS_ENABLED = "1";
    expect(cadCreditsEnabled()).toBe(false);
  });

  it("every writer and reader is a hard no-op: ZERO db calls", async () => {
    await recordGenerationDebit(debitInput);
    await grantCadCredits({ userId: "user-1", amount: 10, reason: "grant" });
    expect(await grantPrintThroughRefund({ printOrderId: "order-1" })).toBe(0);
    expect(await sweepPrintThroughRefunds()).toEqual([]);
    expect(await getCadCreditBalance("user-1")).toBe(0);

    expect(selectSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });
});

describe("creditCostForRoute (route → tier mapping)", () => {
  it("defaults every tier to 0 credits", () => {
    for (const route of ["simple", "complex", "organic", "legacy", undefined]) {
      expect(creditCostForRoute(route)).toBe(0);
    }
  });

  it("maps routes onto the three tier env vars", () => {
    process.env.CAD_CREDIT_COST_SIMPLE = "1";
    process.env.CAD_CREDIT_COST_COMPLEX = "5";
    process.env.CAD_CREDIT_COST_ORGANIC = "3";
    expect(creditCostForRoute("simple")).toBe(1);
    expect(creditCostForRoute("simple-bestof3")).toBe(1);
    expect(creditCostForRoute("legacy")).toBe(1);
    expect(creditCostForRoute("legacy-bestof2")).toBe(1);
    expect(creditCostForRoute(undefined)).toBe(1); // unknown = cheapest tier
    expect(creditCostForRoute("complex")).toBe(5);
    expect(creditCostForRoute("complex-fallback")).toBe(5);
    expect(creditCostForRoute("organic")).toBe(3);
  });

  it("treats garbage/negative env as 0", () => {
    process.env.CAD_CREDIT_COST_SIMPLE = "-2";
    process.env.CAD_CREDIT_COST_COMPLEX = "abc";
    expect(creditCostForRoute("simple")).toBe(0);
    expect(creditCostForRoute("complex")).toBe(0);
  });
});

describe("recordGenerationDebit (flag ON)", () => {
  beforeEach(() => {
    process.env.CAD_CREDITS_ENABLED = "true";
  });

  it("still writes nothing while the route's price is 0 (unpriced default)", async () => {
    await recordGenerationDebit(debitInput);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("writes one negative ledger row at the tier price", async () => {
    process.env.CAD_CREDIT_COST_SIMPLE = "2";
    await recordGenerationDebit(debitInput);
    expect(insertedRows).toEqual([
      expect.objectContaining({
        userId: "user-1",
        delta: -2,
        reason: "generation",
        jobId: "job-1",
        generationId: "gen-1",
        note: "route:simple",
      }),
    ]);
  });

  it("never throws — a db failure is logged and swallowed", async () => {
    process.env.CAD_CREDIT_COST_SIMPLE = "2";
    insertThrows = true;
    await expect(recordGenerationDebit(debitInput)).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});

describe("getCadCreditBalance (flag ON)", () => {
  it("returns SUM(delta) from the ledger", async () => {
    process.env.CAD_CREDITS_ENABLED = "true";
    selectResults = [[{ balance: 7 }]];
    expect(await getCadCreditBalance("user-1")).toBe(7);
  });
});

describe("grantPrintThroughRefund (flag ON)", () => {
  beforeEach(() => {
    process.env.CAD_CREDITS_ENABLED = "true";
    process.env.CAD_PRINT_THROUGH_REFUND_CREDITS = "3";
  });

  const paidOrder = {
    id: "order-1",
    userId: "user-1",
    fileAssetId: "asset-1",
    status: "ordered",
  };

  it("grants the flat capped credit once per paid print order of a studio design", async () => {
    selectResults = [[paidOrder], [{ id: "gen-9" }]];
    const credits = await grantPrintThroughRefund({ printOrderId: "order-1" });
    expect(credits).toBe(3);
    expect(insertedRows).toEqual([
      expect.objectContaining({
        userId: "user-1",
        delta: 3,
        reason: "print_through_refund",
        generationId: "gen-9",
        printOrderId: "order-1",
      }),
    ]);
  });

  it("is idempotent: a second call hits the unique index and grants 0", async () => {
    selectResults = [[paidOrder], [{ id: "gen-9" }]];
    simulateConflict = true; // what ON CONFLICT DO NOTHING looks like
    const credits = await grantPrintThroughRefund({ printOrderId: "order-1" });
    expect(credits).toBe(0);
    expect(insertedRows).toHaveLength(0);
  });

  it("does not grant for an order that is not financially committed", async () => {
    selectResults = [[{ ...paidOrder, status: "cart_created" }]];
    expect(await grantPrintThroughRefund({ printOrderId: "order-1" })).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("does not grant when the asset has no succeeded generation by that user", async () => {
    selectResults = [[paidOrder], []];
    expect(await grantPrintThroughRefund({ printOrderId: "order-1" })).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("no-ops when the refund amount env is 0/unset even with the flag on", async () => {
    delete process.env.CAD_PRINT_THROUGH_REFUND_CREDITS;
    expect(await grantPrintThroughRefund({ printOrderId: "order-1" })).toBe(0);
    expect(selectSpy).not.toHaveBeenCalled();
  });
});

describe("sweepPrintThroughRefunds (flag ON)", () => {
  it("grants for each candidate order and reports what it granted", async () => {
    process.env.CAD_CREDITS_ENABLED = "true";
    process.env.CAD_PRINT_THROUGH_REFUND_CREDITS = "3";
    selectResults = [
      // candidates join
      [{ id: "order-1" }, { id: "order-2" }, { id: "order-1" }],
      // per-order: order row + generation row, twice
      [{ id: "order-1", userId: "u1", fileAssetId: "a1", status: "ordered" }],
      [{ id: "gen-1" }],
      [{ id: "order-2", userId: "u2", fileAssetId: "a2", status: "shipped" }],
      [{ id: "gen-2" }],
    ];
    const granted = await sweepPrintThroughRefunds();
    expect(granted).toEqual([
      { printOrderId: "order-1", credits: 3 },
      { printOrderId: "order-2", credits: 3 },
    ]);
    expect(insertedRows).toHaveLength(2);
  });
});
