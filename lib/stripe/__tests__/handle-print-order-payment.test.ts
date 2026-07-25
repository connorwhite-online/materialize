import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test we set:
//   - dbOrder: what db.select().from().where() returns on the post-claim re-fetch
//   - claimReturns: rows the claim UPDATE().returning() resolves to
//     ([] = claim failed, [{id}] = claim succeeded)
let dbOrder: Record<string, unknown> | null = null;
let claimReturns: Array<{ id: string }> = [];
// When set, `.returning()` calls consume from this queue in order
// (one entry per UPDATE...returning() call within a single
// handlePrintOrderPayment invocation) instead of the shared
// `claimReturns`. Lets a test give the claim UPDATE and the
// place-write UPDATE different results within one call — the
// single-value `claimReturns` can't express that. Falls back to
// `claimReturns` once exhausted (or when unset) so existing
// single-`.returning()`-call tests don't need to change.
let returningQueue: Array<Array<{ id: string }>> | null = null;

// Spies for assertions about which UPDATEs ran with which payload.
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (dbOrder ? [dbOrder] : []),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: (w: unknown) => {
            mockUpdateWhere(w);
            // The claim UPDATE has .returning(); plain heals/releases don't.
            const promise: Promise<void> & {
              returning: () => Array<{ id: string }>;
            } = Promise.resolve() as Promise<void> & {
              returning: () => Array<{ id: string }>;
            };
            promise.returning = () => {
              if (returningQueue && returningQueue.length > 0) {
                return returningQueue.shift()!;
              }
              return claimReturns;
            };
            return promise;
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: { id: "id", status: "status", craftCloudOrderId: "cc_order_id" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...xs: unknown[]) => ({ and: xs }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
}));

const mockCreateOrder = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
}));

const mockNotify = vi.fn();
vi.mock("@/lib/notifications/print-order", () => ({
  notifyPrintOrderPlaced: (...args: unknown[]) => mockNotify(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "fixed-id",
}));

import { handlePrintOrderPayment } from "../handle-print-order-payment";
import { logError } from "@/lib/logger";

const baseAddress = {
  email: "ada@example.com",
  shipping: {
    firstName: "Ada",
    lastName: "Lovelace",
    address: "123 Main",
    city: "London",
    zipCode: "NW15LR",
    countryCode: "GB",
  },
  billing: {
    firstName: "Ada",
    lastName: "Lovelace",
    address: "123 Main",
    city: "London",
    zipCode: "NW15LR",
    countryCode: "GB",
    isCompany: false,
  },
};

const SENTINEL = "placing:fixed-id";

describe("handlePrintOrderPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbOrder = null;
    claimReturns = [];
    returningQueue = null;
  });

  it("happy path: claim wins, places order, writes real id", async () => {
    claimReturns = [{ id: "order-1" }];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: SENTINEL,
      shippingAddress: baseAddress,
    };
    mockCreateOrder.mockResolvedValue({ orderId: "cc-new" });

    await handlePrintOrderPayment("order-1");

    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenNthCalledWith(1, {
      craftCloudOrderId: SENTINEL,
    });
    expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
      craftCloudOrderId: "cc-new",
      status: "ordered",
    });
  });

  it("claim loses to a sibling worker holding the sentinel — no-op", async () => {
    claimReturns = []; // someone else has the claim
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "placing:other-worker",
      shippingAddress: baseAddress,
    };

    await handlePrintOrderPayment("order-1");

    expect(mockCreateOrder).not.toHaveBeenCalled();
    // Only the claim attempt fired — no heal, no place.
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });

  it("logs via logError (not console.warn) when reentry against active sentinel (CON-137)", async () => {
    claimReturns = [];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "placing:other-worker",
      shippingAddress: baseAddress,
    };

    await handlePrintOrderPayment("order-1");

    expect(logError).toHaveBeenCalledWith(
      "handlePrintOrderPayment.reentryAgainstActiveClaim",
      expect.any(Error)
    );
  });

  it("claim loses because status already advanced (Guard #1)", async () => {
    claimReturns = [];
    dbOrder = {
      id: "order-1",
      status: "ordered",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "cc-prev",
      shippingAddress: baseAddress,
    };

    await handlePrintOrderPayment("order-1");

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledTimes(1); // claim attempt only
  });

  it("claim loses because a real (non-sentinel) id is present (Guard #2 heal)", async () => {
    claimReturns = [];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "cc-prev", // real id from a previous successful place
      shippingAddress: baseAddress,
    };

    await handlePrintOrderPayment("order-1");

    expect(mockCreateOrder).not.toHaveBeenCalled();
    // Claim attempt + heal-status update.
    expect(mockUpdateSet).toHaveBeenNthCalledWith(2, { status: "ordered" });
  });

  it("throws when row vanished after claim", async () => {
    claimReturns = [{ id: "order-1" }];
    dbOrder = null; // re-fetch after claim returns nothing

    await expect(handlePrintOrderPayment("order-1")).rejects.toThrow(
      /Missing cart or address/
    );
    // Released the claim before throwing.
    expect(mockUpdateSet).toHaveBeenLastCalledWith({
      craftCloudOrderId: null,
    });
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("throws when cart id is missing — releases the claim first", async () => {
    claimReturns = [{ id: "order-1" }];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: null,
      craftCloudOrderId: SENTINEL,
      shippingAddress: baseAddress,
    };

    await expect(handlePrintOrderPayment("order-1")).rejects.toThrow(
      /Missing cart or address/
    );
    expect(mockUpdateSet).toHaveBeenLastCalledWith({
      craftCloudOrderId: null,
    });
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("propagates CraftCloud errors AND releases the claim so a retry can succeed", async () => {
    claimReturns = [{ id: "order-1" }];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: SENTINEL,
      shippingAddress: baseAddress,
    };
    mockCreateOrder.mockRejectedValue(new Error("CraftCloud 500"));

    await expect(handlePrintOrderPayment("order-1")).rejects.toThrow(
      "CraftCloud 500"
    );
    // The claim release fires after the CraftCloud failure.
    expect(mockUpdateSet).toHaveBeenLastCalledWith({
      craftCloudOrderId: null,
    });
  });

  it("throws when the print order does not exist (claim found nothing AND re-fetch found nothing)", async () => {
    claimReturns = [];
    dbOrder = null;

    await expect(handlePrintOrderPayment("missing")).rejects.toThrow(
      /Print order not found/
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("single mode accepts (and ignores) the paymentIntentId option", async () => {
    claimReturns = [{ id: "order-1" }];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      checkoutModel: "single",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: SENTINEL,
      shippingAddress: baseAddress,
    };
    mockCreateOrder.mockResolvedValue({ orderId: "cc-new" });

    await handlePrintOrderPayment("order-1", { paymentIntentId: "pi_123" });

    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    // Place-phase write is byte-identical to the no-opts path — no
    // fee fields leak into single mode.
    expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
      craftCloudOrderId: "cc-new",
      status: "ordered",
    });
  });

  it("MTR-230: place-write zero-row logs placeWriteLost with both ids and skips notify, without throwing", async () => {
    // Claim succeeds (1st .returning()); the place-write UPDATE loses
    // the race (2nd .returning()) — e.g. an operator manually edited
    // the row between our claim and our write.
    returningQueue = [[{ id: "order-1" }], []];
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: SENTINEL,
      shippingAddress: baseAddress,
    };
    mockCreateOrder.mockResolvedValue({ orderId: "cc-new" });

    await expect(handlePrintOrderPayment("order-1")).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      "handlePrintOrderPayment.placeWriteLost",
      expect.objectContaining({
        cause: expect.objectContaining({
          printOrderId: "order-1",
          craftCloudOrderId: "cc-new",
        }),
      })
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("handlePrintOrderPayment (two_step)", () => {
  const twoStepOrder = {
    id: "order-2",
    status: "cart_created",
    checkoutModel: "two_step",
    craftCloudCartId: "cart-2",
    // Two-step rows already carry the real CraftCloud id — placed
    // up-front by completePrintOrder.
    craftCloudOrderId: "cc-upfront",
    shippingAddress: baseAddress,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dbOrder = null;
    claimReturns = [];
    returningQueue = null;
  });

  it("advances cart_created → awaiting_production_payment with PI id + timestamp", async () => {
    dbOrder = { ...twoStepOrder };
    claimReturns = [{ id: "order-2" }]; // UPDATE claims the row

    await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      status: "awaiting_production_payment",
      feePaymentIntentId: "pi_fee_1",
      feeAuthorizedAt: expect.any(Date),
    });
    // The UPDATE is the idempotency gate: id match AND still
    // cart_created.
    expect(mockUpdateWhere).toHaveBeenCalledWith({
      and: [{ eq: ["id", "order-2"] }, { eq: ["status", "cart_created"] }],
    });
    // Row was actually claimed — no MTR-230 zero-row log.
    expect(logError).not.toHaveBeenCalled();
  });

  it("never calls CraftCloud createOrder, never notifies, never takes the claim sentinel", async () => {
    dbOrder = { ...twoStepOrder };
    claimReturns = [{ id: "order-2" }];

    await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    // No update ever wrote a placing:* sentinel.
    const sentinelWrites = mockUpdateSet.mock.calls.filter((c) =>
      String((c[0] as Record<string, unknown>).craftCloudOrderId).startsWith(
        "placing:"
      )
    );
    expect(sentinelWrites).toHaveLength(0);
  });

  it("is idempotent: a duplicate delivery after the row advanced stays a no-op and logs nothing (MTR-230 case b)", async () => {
    dbOrder = { ...twoStepOrder };
    claimReturns = [{ id: "order-2" }]; // first delivery claims the row
    await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

    // Second delivery sees the already-advanced row. The conditional
    // UPDATE still fires but its WHERE (status = cart_created) can't
    // match, so it returns zero rows — a real duplicate, not a lost
    // write, so MTR-230's zero-row branch must stay silent.
    dbOrder = { ...twoStepOrder, status: "awaiting_production_payment" };
    claimReturns = [];
    await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    // Every write was the gated conditional — no status:"ordered"
    // heal, no sentinel claim.
    for (const call of mockUpdateSet.mock.calls) {
      expect(call[0]).toEqual({
        status: "awaiting_production_payment",
        feePaymentIntentId: "pi_fee_1",
        feeAuthorizedAt: expect.any(Date),
      });
    }
  });

  it("MTR-230 case c: zero-row UPDATE with the row in an unexpected status logs twoStepFeeNoOp", async () => {
    // The row landed in `cancelled` (e.g. the stale-order sweep beat
    // us to it) instead of the expected awaiting_production_payment —
    // this is the silent-revenue-loss case, not a benign duplicate.
    dbOrder = { ...twoStepOrder, status: "cancelled" };
    claimReturns = [];

    await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

    expect(logError).toHaveBeenCalledWith(
      "handlePrintOrderPayment.twoStepFeeNoOp",
      expect.objectContaining({
        cause: expect.objectContaining({
          printOrderId: "order-2",
          status: "cancelled",
        }),
      })
    );
  });

  it("throws when paymentIntentId is missing — prevents stranding the order", async () => {
    dbOrder = { ...twoStepOrder };

    await expect(handlePrintOrderPayment("order-2")).rejects.toThrow(
      /missing paymentIntentId/
    );
    // Must NOT advance the row — nothing should be written.
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("advances the row when paymentIntentId is present", async () => {
    dbOrder = { ...twoStepOrder };
    claimReturns = [{ id: "order-2" }];

    await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

    expect(mockUpdateSet).toHaveBeenCalledWith({
      status: "awaiting_production_payment",
      feePaymentIntentId: "pi_fee_1",
      feeAuthorizedAt: expect.any(Date),
    });
  });
});
