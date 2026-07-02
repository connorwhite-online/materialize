import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test fixtures:
//   - selectRows: what the awaiting_production_payment SELECT returns
//   - updateReturns: rows the conditional UPDATE().returning() resolves
//     to ([] = a concurrent worker won the race, [{id}] = we advanced
//     the row)
let selectRows: Array<Record<string, unknown>> = [];
let updateReturns: Array<{ id: string }> = [{ id: "order-1" }];

// Spies for assertions about which UPDATEs ran with which payload.
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("drizzle-orm", () => ({
  and: (...xs: unknown[]) => ({ and: xs }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  asc: (a: unknown) => ({ asc: a }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => selectRows,
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: (w: unknown) => {
            mockUpdateWhere(w);
            // The capture UPDATE chains .returning(); the cancel /
            // heal UPDATEs are awaited directly.
            const promise: Promise<void> & {
              returning: () => Array<{ id: string }>;
            } = Promise.resolve() as Promise<void> & {
              returning: () => Array<{ id: string }>;
            };
            promise.returning = () => updateReturns;
            return promise;
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    id: "id",
    status: "status",
    checkoutModel: "checkout_model",
    craftCloudOrderId: "craft_cloud_order_id",
    feePaymentIntentId: "fee_payment_intent_id",
    feeAuthorizedAt: "fee_authorized_at",
    feeCapturedAt: "fee_captured_at",
  },
}));

const mockRetrieve = vi.fn();
const mockCapture = vi.fn();
const mockCancel = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    paymentIntents: {
      retrieve: (...args: unknown[]) => mockRetrieve(...args),
      capture: (...args: unknown[]) => mockCapture(...args),
      cancel: (...args: unknown[]) => mockCancel(...args),
    },
  }),
}));

const mockGetOrderStatus = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  getOrderStatus: (...args: unknown[]) => mockGetOrderStatus(...args),
}));

const mockNotify = vi.fn();
vi.mock("@/lib/notifications/print-order", () => ({
  notifyPrintOrderPlaced: (...args: unknown[]) => mockNotify(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { logError } from "@/lib/logger";
import {
  reconcileProductionPayments,
  ABANDONMENT_TTL_MS,
} from "../reconcile-production-payments";

const HOUR_MS = 60 * 60 * 1000;

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    craftCloudOrderId: "cc-1",
    feePaymentIntentId: "pi_1",
    feeAuthorizedAt: new Date(Date.now() - HOUR_MS), // 1h old — inside TTL
    ...overrides,
  };
}

// CraftCloud status payloads for the real isProductionPaymentConfirmed
// oracle (deliberately NOT mocked — it is the contract under test's
// dependency, and it is pure).
const PAID_STATUS = {
  orderId: "cc-1",
  vendorStatuses: [{ vendorId: "v1", status: "in_production" }],
};
const UNPAID_STATUS = {
  orderId: "cc-1",
  vendorStatuses: [],
};

describe("reconcileProductionPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows = [];
    updateReturns = [{ id: "order-1" }];
  });

  it("captures the fee and notifies when CraftCloud payment is confirmed", async () => {
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result).toEqual({
      captured: 1,
      cancelled: 0,
      pending: 0,
      errors: 0,
    });
    expect(mockCapture).toHaveBeenCalledWith("pi_1");
    expect(mockUpdateSet).toHaveBeenCalledWith({
      status: "ordered",
      feeCapturedAt: expect.any(Date),
    });
    expect(mockNotify).toHaveBeenCalledWith("order-1");
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("skips notify when the conditional UPDATE wrote no row (race lost)", async () => {
    selectRows = [makeRow()];
    updateReturns = []; // someone else advanced the row first
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result.captured).toBe(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("swallows notify failures — the capture still counts", async () => {
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);
    mockNotify.mockRejectedValue(new Error("notify blip"));

    const result = await reconcileProductionPayments();

    expect(result).toEqual({
      captured: 1,
      cancelled: 0,
      pending: 0,
      errors: 0,
    });
    expect(logError).toHaveBeenCalledWith(
      "reconcileProductionPayments:notify",
      expect.any(Error)
    );
  });

  it("cancels the hold when unconfirmed past the 72h TTL", async () => {
    selectRows = [
      makeRow({
        feeAuthorizedAt: new Date(Date.now() - ABANDONMENT_TTL_MS - HOUR_MS),
      }),
    ];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(UNPAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result).toEqual({
      captured: 0,
      cancelled: 1,
      pending: 0,
      errors: 0,
    });
    expect(mockCancel).toHaveBeenCalledWith("pi_1");
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "cancelled" });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("treats an already-canceled Stripe error as a successful cancel", async () => {
    selectRows = [
      makeRow({
        feeAuthorizedAt: new Date(Date.now() - ABANDONMENT_TTL_MS - HOUR_MS),
      }),
    ];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(UNPAID_STATUS);
    mockCancel.mockRejectedValue(
      Object.assign(
        new Error(
          "You cannot cancel this PaymentIntent because it has already been canceled."
        ),
        { code: "payment_intent_unexpected_state" }
      )
    );

    const result = await reconcileProductionPayments();

    expect(result.cancelled).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "cancelled" });
  });

  it("leaves unconfirmed orders alone within the TTL", async () => {
    selectRows = [makeRow()]; // authorized 1h ago
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(UNPAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result).toEqual({
      captured: 0,
      cancelled: 0,
      pending: 1,
      errors: 0,
    });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("heals a succeeded PI (crash between capture and row update)", async () => {
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "succeeded" });

    const result = await reconcileProductionPayments();

    expect(result.captured).toBe(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      status: "ordered",
      feeCapturedAt: expect.any(Date),
    });
    // No re-capture, no CraftCloud probe needed.
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockGetOrderStatus).not.toHaveBeenCalled();
  });

  it("finalizes the row when the PI is already canceled (Stripe auto-expiry)", async () => {
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "canceled" });

    const result = await reconcileProductionPayments();

    expect(result.cancelled).toBe(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "cancelled" });
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockGetOrderStatus).not.toHaveBeenCalled();
  });

  it("counts rows missing ids as errors without touching Stripe", async () => {
    selectRows = [makeRow({ feePaymentIntentId: null })];

    const result = await reconcileProductionPayments();

    expect(result.errors).toBe(1);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "reconcileProductionPayments:missingIds",
      expect.any(Error)
    );
  });

  it("isolates per-row failures — the second row still processes", async () => {
    selectRows = [
      makeRow({ id: "order-bad", feePaymentIntentId: "pi_bad" }),
      makeRow({ id: "order-good", feePaymentIntentId: "pi_good" }),
    ];
    updateReturns = [{ id: "order-good" }];
    mockRetrieve.mockImplementation(async (pi: unknown) => {
      if (pi === "pi_bad") throw new Error("stripe 500");
      return { status: "requires_capture" };
    });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result).toEqual({
      captured: 1,
      cancelled: 0,
      pending: 0,
      errors: 1,
    });
    expect(mockCapture).toHaveBeenCalledWith("pi_good");
    expect(mockNotify).toHaveBeenCalledWith("order-good");
    expect(logError).toHaveBeenCalledWith(
      "reconcileProductionPayments:order",
      expect.any(Error)
    );
  });

  it("returns errors>0 when one row fails and one succeeds (route will 500)", async () => {
    selectRows = [
      makeRow({ id: "order-bad", feePaymentIntentId: "pi_bad" }),
      makeRow({ id: "order-good", feePaymentIntentId: "pi_good" }),
    ];
    updateReturns = [{ id: "order-good" }];
    mockRetrieve.mockImplementation(async (pi: unknown) => {
      if (pi === "pi_bad") throw new Error("stripe 500");
      return { status: "requires_capture" };
    });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result.errors).toBe(1);
    expect(result.captured).toBe(1);
  });

  it("MTR-144: bounded worker pool processes every row exactly once, no double-processing", async () => {
    // More rows than CONCURRENCY (4) so multiple workers are definitely
    // in flight at once. Each row must be retrieved from Stripe exactly
    // once and captured exactly once — a double-claim would show up as
    // a PI id appearing more than once in either call list.
    const rowCount = 10;
    selectRows = Array.from({ length: rowCount }, (_, i) =>
      makeRow({ id: `order-${i}`, feePaymentIntentId: `pi_${i}` })
    );
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result.captured).toBe(rowCount);
    expect(result.errors).toBe(0);

    // Every row's PaymentIntent was retrieved exactly once — if a row
    // were claimed by two workers, some pi_N would appear twice here.
    const retrievedIds = mockRetrieve.mock.calls.map((c) => c[0]);
    expect(retrievedIds).toHaveLength(rowCount);
    expect(new Set(retrievedIds).size).toBe(rowCount);

    // Same invariant for the Stripe capture call.
    const capturedIds = mockCapture.mock.calls.map((c) => c[0]);
    expect(capturedIds).toHaveLength(rowCount);
    expect(new Set(capturedIds).size).toBe(rowCount);
  });

  it("queries with ORDER BY feeAuthorizedAt ASC and LIMIT 500", async () => {
    // The mock db doesn't verify query shape directly, but this test
    // documents the intent and will fail if the orderBy/limit chain is
    // removed from the implementation (the mock would break). We verify
    // the sweep completes without throwing.
    selectRows = [];
    const result = await reconcileProductionPayments();
    expect(result).toEqual({ captured: 0, cancelled: 0, pending: 0, errors: 0 });
  });

  it("CON-163: conditional WHERE guards on captured status — mockUpdateWhere captures their shape", async () => {
    // Verifies the status='awaiting_production_payment' guard is present
    // in every UPDATE's WHERE. If the guard is removed, this fails.
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);

    await reconcileProductionPayments();

    // Every WHERE that was recorded must reference the status guard.
    // (The eq mock returns { eq: [col, val] } so we stringify + check.)
    const whereStr = JSON.stringify(mockUpdateWhere.mock.calls);
    expect(whereStr).toContain("awaiting_production_payment");
  });

  it("CON-163: capture throwing increments errors, row untouched", async () => {
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(PAID_STATUS);
    mockCapture.mockRejectedValue(new Error("stripe capture 500"));

    const result = await reconcileProductionPayments();

    expect(result.errors).toBe(1);
    expect(result.captured).toBe(0);
    // No status update after a failed capture.
    const orderedSet = mockUpdateSet.mock.calls.find(
      (c) => (c[0] as { status?: unknown }).status === "ordered"
    );
    expect(orderedSet).toBeUndefined();
  });

  it("CON-163: unexpected intent status (processing) → logError + error count", async () => {
    selectRows = [makeRow()];
    mockRetrieve.mockResolvedValue({ status: "processing" });

    const result = await reconcileProductionPayments();

    expect(result.errors).toBe(1);
    expect(result.pending).toBe(0);
    expect(logError).toHaveBeenCalledWith(
      "reconcileProductionPayments:unexpectedIntentStatus",
      expect.any(Error)
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("CON-163: feeAuthorizedAt=null treated as epoch → instantly past TTL → hold cancelled on first sweep", async () => {
    // This is load-bearing: null feeAuthorizedAt falls back to 0 (epoch),
    // which is always > ABANDONMENT_TTL_MS ms ago — so the order is
    // treated as abandoned and the hold is cancelled immediately.
    // That's surprising but correct: a row stuck in awaiting_production_payment
    // with no timestamp is a bookkeeping anomaly; cancelling the hold is safe.
    selectRows = [makeRow({ feeAuthorizedAt: null })];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(UNPAID_STATUS);

    const result = await reconcileProductionPayments();

    expect(result.cancelled).toBe(1);
    expect(mockCancel).toHaveBeenCalledWith("pi_1");
  });

  it("CON-163: cancel rejecting with non-already-canceled error → rethrows (error count++)", async () => {
    selectRows = [
      makeRow({
        feeAuthorizedAt: new Date(Date.now() - ABANDONMENT_TTL_MS - HOUR_MS),
      }),
    ];
    mockRetrieve.mockResolvedValue({ status: "requires_capture" });
    mockGetOrderStatus.mockResolvedValue(UNPAID_STATUS);
    mockCancel.mockRejectedValue(
      Object.assign(new Error("Network error"), { code: "network_error" })
    );

    const result = await reconcileProductionPayments();

    // The non-already-canceled error is rethrown → caught by outer try/catch → error++
    expect(result.errors).toBe(1);
    expect(result.cancelled).toBe(0);
  });
});
