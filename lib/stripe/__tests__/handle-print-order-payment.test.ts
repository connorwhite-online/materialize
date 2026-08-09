import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test we set:
//   - dbOrder: what db.select().from(printOrders).where() returns on the
//     post-claim re-fetch
//   - printOrderItemRows: what db.select().from(printOrderItems).where()
//     returns — MONEY-2's clearCartItemsForOrder reads this to decide
//     which cartItems rows to delete. Defaults to [] (single-item
//     orders from createPrintOrder never write printOrderItems), which
//     makes clearCartItemsForOrder a no-op for every pre-existing test
//     below — none of them need to change.
//   - claimReturns: rows the claim UPDATE().returning() resolves to
//     ([] = claim failed, [{id}] = claim succeeded)
let dbOrder: Record<string, unknown> | null = null;
let printOrderItemRows: Array<{ fileAssetId: string; quoteId: string }> = [];
// What db.select().from(users).where().limit() returns —
// persistSavedFeeCard reads this to decide whether to remember the
// fee card. Defaults to [] (no users row → nothing persisted), which
// keeps every pre-existing test below unchanged.
let userRows: Array<{
  stripeCustomerId: string | null;
  defaultPaymentMethod: string | null;
}> = [];
let claimReturns: Array<{ id: string; userId?: string }> = [];
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
// MONEY-2: spy on the cartItems cleanup DELETE.
const mockDeleteWhere = vi.fn();
let deleteShouldThrow: Error | null = null;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table?.__name === "users") {
          // The users read is the only select here that chains .limit().
          return { where: () => ({ limit: () => userRows }) };
        }
        return {
          where: () =>
            table?.__name === "printOrderItems"
              ? printOrderItemRows
              : dbOrder
                ? [dbOrder]
                : [],
        };
      },
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
    delete: () => ({
      where: (w: unknown) => {
        mockDeleteWhere(w);
        if (deleteShouldThrow) return Promise.reject(deleteShouldThrow);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    __name: "printOrders",
    id: "id",
    status: "status",
    craftCloudOrderId: "cc_order_id",
  },
  printOrderItems: {
    __name: "printOrderItems",
    printOrderId: "print_order_id",
    fileAssetId: "file_asset_id",
    quoteId: "quote_id",
  },
  cartItems: {
    __name: "cartItems",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    quoteId: "quote_id",
  },
  users: {
    __name: "users",
    id: "id",
    stripeCustomerId: "stripe_customer_id",
    defaultPaymentMethod: "default_payment_method",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...xs: unknown[]) => ({ and: xs }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
  or: (...xs: unknown[]) => ({ or: xs }),
}));

const mockCreateOrder = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
}));

// persistSavedFeeCard retrieves the fee PI to learn which customer +
// payment method Stripe attached the saved card to.
const mockPIRetrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    paymentIntents: {
      retrieve: (...args: unknown[]) => mockPIRetrieve(...args),
    },
  }),
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
    printOrderItemRows = [];
    userRows = [];
    claimReturns = [];
    returningQueue = null;
    deleteShouldThrow = null;
    // Default: PI carries no customer (the customer_email fallback
    // session shape) so persistSavedFeeCard is a silent no-op.
    mockPIRetrieve.mockResolvedValue({ customer: null, payment_method: null });
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

  // MONEY-2: checkoutVendorGroup no longer deletes cartItems at order
  // creation — this handler clears them once the order actually
  // places, so an abandoned checkout keeps its cart intact.
  describe("MONEY-2: cart-clear on successful placement", () => {
    it("clears cartItems matching the order's printOrderItems after a fresh placement", async () => {
      claimReturns = [{ id: "order-1" }];
      dbOrder = {
        id: "order-1",
        userId: "user-1",
        status: "cart_created",
        craftCloudCartId: "cart-1",
        craftCloudOrderId: SENTINEL,
        shippingAddress: baseAddress,
      };
      printOrderItemRows = [
        { fileAssetId: "asset-1", quoteId: "quote-1" },
        { fileAssetId: "asset-2", quoteId: "quote-2" },
      ];
      mockCreateOrder.mockResolvedValue({ orderId: "cc-new" });

      await handlePrintOrderPayment("order-1");

      expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
      expect(mockDeleteWhere).toHaveBeenCalledWith({
        and: [
          { eq: ["user_id", "user-1"] },
          {
            or: [
              {
                and: [
                  { eq: ["file_asset_id", "asset-1"] },
                  { eq: ["quote_id", "quote-1"] },
                ],
              },
              {
                and: [
                  { eq: ["file_asset_id", "asset-2"] },
                  { eq: ["quote_id", "quote-2"] },
                ],
              },
            ],
          },
        ],
      });
    });

    it("does not touch cartItems for a single-file order with no printOrderItems (createPrintOrder flow)", async () => {
      claimReturns = [{ id: "order-1" }];
      dbOrder = {
        id: "order-1",
        userId: "user-1",
        status: "cart_created",
        craftCloudCartId: "cart-1",
        craftCloudOrderId: SENTINEL,
        shippingAddress: baseAddress,
      };
      printOrderItemRows = []; // no cart-derived order items
      mockCreateOrder.mockResolvedValue({ orderId: "cc-new" });

      await handlePrintOrderPayment("order-1");

      expect(mockDeleteWhere).not.toHaveBeenCalled();
    });

    it("is idempotent: a duplicate delivery after the order already placed clears the cart again without erroring (Guard #1)", async () => {
      claimReturns = []; // status already advanced, claim can't win
      dbOrder = {
        id: "order-1",
        userId: "user-1",
        status: "ordered",
        craftCloudCartId: "cart-1",
        craftCloudOrderId: "cc-prev",
        shippingAddress: baseAddress,
      };
      printOrderItemRows = [{ fileAssetId: "asset-1", quoteId: "quote-1" }];

      await expect(handlePrintOrderPayment("order-1")).resolves.toBeUndefined();

      expect(mockCreateOrder).not.toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    });

    it("is idempotent: the Guard #2 heal path also clears the cart", async () => {
      claimReturns = [];
      dbOrder = {
        id: "order-1",
        userId: "user-1",
        status: "cart_created",
        craftCloudCartId: "cart-1",
        craftCloudOrderId: "cc-prev", // real id from a previous successful place
        shippingAddress: baseAddress,
      };
      printOrderItemRows = [{ fileAssetId: "asset-1", quoteId: "quote-1" }];

      await handlePrintOrderPayment("order-1");

      expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    });

    it("a failure while clearing the cart is logged, not thrown — the order placement already committed must not roll back or retry", async () => {
      claimReturns = [{ id: "order-1" }];
      dbOrder = {
        id: "order-1",
        userId: "user-1",
        status: "cart_created",
        craftCloudCartId: "cart-1",
        craftCloudOrderId: SENTINEL,
        shippingAddress: baseAddress,
      };
      printOrderItemRows = [{ fileAssetId: "asset-1", quoteId: "quote-1" }];
      mockCreateOrder.mockResolvedValue({ orderId: "cc-new" });
      deleteShouldThrow = new Error("db blip");

      await expect(handlePrintOrderPayment("order-1")).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledWith(
        "handlePrintOrderPayment.clearCartItems",
        deleteShouldThrow
      );
      // The order itself still placed successfully.
      expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
        craftCloudOrderId: "cc-new",
        status: "ordered",
      });
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
    printOrderItemRows = [];
    userRows = [];
    claimReturns = [];
    returningQueue = null;
    deleteShouldThrow = null;
    mockPIRetrieve.mockResolvedValue({ customer: null, payment_method: null });
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

  // Card-on-file: the fee session was minted with setup_future_usage,
  // so after the authorization lands we remember the card for the
  // one-tap path (tryAuthorizeFeeWithSavedCard).
  describe("persistSavedFeeCard", () => {
    beforeEach(() => {
      dbOrder = { ...twoStepOrder };
      claimReturns = [{ id: "order-2", userId: "user-9" }];
      mockPIRetrieve.mockResolvedValue({
        customer: "cus_9",
        payment_method: "pm_9",
      });
    });

    it("persists customer + payment method when both users columns are empty", async () => {
      userRows = [{ stripeCustomerId: null, defaultPaymentMethod: null }];

      await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

      expect(mockPIRetrieve).toHaveBeenCalledWith("pi_fee_1");
      expect(mockUpdateSet).toHaveBeenCalledWith({
        stripeCustomerId: "cus_9",
        defaultPaymentMethod: "pm_9",
      });
    });

    it("handles Stripe's expanded-object shapes for customer and payment_method", async () => {
      userRows = [{ stripeCustomerId: null, defaultPaymentMethod: null }];
      mockPIRetrieve.mockResolvedValue({
        customer: { id: "cus_9" },
        payment_method: { id: "pm_9" },
      });

      await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

      expect(mockUpdateSet).toHaveBeenCalledWith({
        stripeCustomerId: "cus_9",
        defaultPaymentMethod: "pm_9",
      });
    });

    it("fills only the null column — a deliberately saved billing-setup card is never clobbered", async () => {
      userRows = [
        { stripeCustomerId: "cus_9", defaultPaymentMethod: "pm_existing" },
      ];

      await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

      // Only the order-advance UPDATE fired — no users write at all.
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "awaiting_production_payment" })
      );
    });

    it("skips when the PI's customer differs from the user's stored one — a mismatched PM pointer would break every future one-tap", async () => {
      userRows = [
        { stripeCustomerId: "cus_OTHER", defaultPaymentMethod: null },
      ];

      await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    });

    it("skips when the PI carries no customer (customer_email fallback session — no card was saved)", async () => {
      userRows = [{ stripeCustomerId: null, defaultPaymentMethod: null }];
      mockPIRetrieve.mockResolvedValue({
        customer: null,
        payment_method: "pm_9",
      });

      await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    });

    it("is best-effort: a Stripe retrieve failure logs and resolves — the advanced order must not make the webhook 500", async () => {
      userRows = [{ stripeCustomerId: null, defaultPaymentMethod: null }];
      mockPIRetrieve.mockRejectedValue(new Error("stripe down"));

      await expect(
        handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" })
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledWith(
        "handlePrintOrderPayment.persistSavedFeeCard",
        expect.any(Error)
      );
      // The order still advanced.
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "awaiting_production_payment" })
      );
    });

    it("does not run on a duplicate delivery whose advance UPDATE matched zero rows", async () => {
      dbOrder = { ...twoStepOrder, status: "awaiting_production_payment" };
      claimReturns = [];

      await handlePrintOrderPayment("order-2", { paymentIntentId: "pi_fee_1" });

      expect(mockPIRetrieve).not.toHaveBeenCalled();
    });
  });
});
