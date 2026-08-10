import { describe, it, expect, vi, beforeEach } from "vitest";

// Two-step checkout model coverage for completePrintOrder /
// resumePrintOrder. Mock scaffolding mirrors
// print-checkout-lock.test.ts:
//   - selectedOrder: what db.select(printOrders).where() returns
//   - claimReturns: rows every UPDATE().returning() yields — the
//     session claim AND the conditional craftCloudOrderId / bridge
//     persists share it ([{id}] = the write landed).
let selectedOrder: Record<string, unknown> | null = null;
let claimReturns: Array<{ id: string }> = [];
// What db.select().from(users).where().limit() returns — the saved-card
// read in tryAuthorizeFeeWithSavedCard. Defaults to [] (no card on
// file) so every pre-existing hosted-session test is untouched.
let billingRows: Array<{
  stripeCustomerId: string | null;
  defaultPaymentMethod: string | null;
}> = [];
// When set, UPDATE().returning() calls consume from this queue in
// order instead of the shared claimReturns — lets one test give the
// session claim and the one-tap advance write different results.
// Falls back to claimReturns once exhausted (or when unset).
let returningQueue: Array<Array<{ id: string }>> | null = null;
const updateSet = vi.fn();
const updateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table?.__name === "fileAssets") {
          return {
            leftJoin: () => ({
              where: () => ({
                limit: () => [
                  { fileName: "Carabiner", originalFilename: "carabiner.stl" },
                ],
              }),
            }),
          };
        }
        if (table?.__name === "users") {
          // The saved-card read is the only select here chaining .limit().
          return { where: () => ({ limit: () => billingRows }) };
        }
        return {
          where: () => (selectedOrder ? [selectedOrder] : []),
        };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return {
          where: (w: unknown) => {
            updateWhere(w);
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
  printOrders: {
    __name: "printOrders",
    id: "id",
    userId: "user_id",
    status: "status",
    stripeSessionId: "stripe_session_id",
    craftCloudOrderId: "cc_order_id",
    bridgeSessionUrl: "bridge_session_url",
  },
  printOrderItems: { __name: "printOrderItems" },
  cartItems: { __name: "cartItems" },
  fileAssets: { __name: "fileAssets", id: "id", fileId: "file_id" },
  files: { __name: "files", id: "id", name: "name" },
  users: {
    __name: "users",
    id: "id",
    stripeCustomerId: "stripe_customer_id",
    defaultPaymentMethod: "default_payment_method",
  },
}));

vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: vi.fn(async () => ({
    config: { id: "pla-white", color: "White" },
    material: { name: "PLA" },
    finishGroup: { name: "Standard" },
  })),
  findProvider: vi.fn(async () => ({ vendorId: "vendor-1", name: "Unionfab" })),
}));

const stripeCreate = vi.fn();
const stripeRetrieve = vi.fn();
const stripeRetrievePI = vi.fn();
const stripeCreatePI = vi.fn();
const stripeCancelPI = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => stripeCreate(...args),
        retrieve: (...args: unknown[]) => stripeRetrieve(...args),
      },
    },
    paymentIntents: {
      retrieve: (...args: unknown[]) => stripeRetrievePI(...args),
      create: (...args: unknown[]) => stripeCreatePI(...args),
      cancel: (...args: unknown[]) => stripeCancelPI(...args),
    },
  }),
}));

// createStripeSessionForOrder resolves the user's Stripe Customer for
// two_step sessions via this helper (own unit tests in
// lib/stripe/__tests__/customers.test.ts) — stubbed here so these
// tests don't need customers.create/users-write scaffolding.
const getOrCreateStripeCustomerMock = vi.fn();
vi.mock("@/lib/stripe/customers", () => ({
  getOrCreateStripeCustomer: (...args: unknown[]) =>
    getOrCreateStripeCustomerMock(...args),
}));

// Real minting needs STRIPE_SECRET_KEY (absent in this suite); the
// token's own crypto is covered in lib/orders/__tests__/.
vi.mock("@/lib/orders/pay-production-token", () => ({
  mintPayProductionToken: (orderId: string) => `tok-${orderId}`,
}));

const ccCreateOrder = vi.fn();
const ccCreateStripeCheckout = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  createCart: vi.fn(),
  createOrder: (...args: unknown[]) => ccCreateOrder(...args),
  createStripeCheckout: (...args: unknown[]) => ccCreateStripeCheckout(...args),
  getOrderStatus: vi.fn(),
  CraftCloudApiError: class CraftCloudApiError extends Error {
    isQuoteExpired() {
      return false;
    }
  },
}));

vi.mock("@/lib/env", () => ({
  getCheckoutModel: vi.fn(() => "two_step"),
  isSandboxMode: vi.fn(() => true),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed-id" }));

import { completePrintOrder, resumePrintOrder } from "../print";
import { logError } from "@/lib/logger";

const baseOrder = {
  id: "order-1",
  userId: "test-user-id",
  fileAssetId: "asset-1",
  craftCloudOrderId: null as string | null,
  craftCloudCartId: "cart-abc",
  stripeSessionId: null as string | null,
  bridgeSessionId: null as string | null,
  bridgeSessionUrl: null as string | null,
  feePaymentIntentId: null as string | null,
  checkoutModel: "two_step",
  totalPrice: 5000,
  serviceFee: 150,
  materialSubtotal: 4500,
  shippingSubtotal: 350,
  quantity: 1,
  material: "pla-white",
  vendor: "vendor-1",
  vendorName: null,
  status: "cart_created" as string,
  shippingAddress: null as Record<string, unknown> | null,
  trackingInfo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

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

const callArgs = {
  orderId: "order-1",
  email: baseAddress.email,
  shipping: baseAddress.shipping,
  billing: baseAddress.billing,
};

type SessionCreateArgs = {
  customer?: string;
  customer_email?: string;
  line_items: Array<{
    price_data: {
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
  }>;
  payment_intent_data: { capture_method?: string; setup_future_usage?: string };
  metadata: Record<string, string>;
  success_url: string;
  cancel_url: string;
};

describe("completePrintOrder (two_step)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...baseOrder };
    claimReturns = [{ id: "order-1" }];
    billingRows = []; // default: no card on file → hosted Checkout
    returningQueue = null;
    getOrCreateStripeCustomerMock.mockResolvedValue("cus_test");
    ccCreateOrder.mockResolvedValue({ orderId: "cc-123", status: "ordered" });
    ccCreateStripeCheckout.mockResolvedValue({
      sessionId: "bridge-sess-1",
      sessionUrl: "https://bridge.test/pay",
    });
    stripeCreate.mockResolvedValue({
      id: "sess_fee",
      url: "https://stripe.test/fee",
    });
  });

  it("places the CraftCloud order + bridge session BEFORE the fee session", async () => {
    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });

    // Strict ordering: createOrder → createStripeCheckout → our
    // fee-only Stripe session.
    expect(ccCreateOrder).toHaveBeenCalledTimes(1);
    expect(ccCreateStripeCheckout).toHaveBeenCalledTimes(1);
    expect(stripeCreate).toHaveBeenCalledTimes(1);
    expect(ccCreateOrder.mock.invocationCallOrder[0]).toBeLessThan(
      ccCreateStripeCheckout.mock.invocationCallOrder[0]
    );
    expect(ccCreateStripeCheckout.mock.invocationCallOrder[0]).toBeLessThan(
      stripeCreate.mock.invocationCallOrder[0]
    );

    expect(ccCreateOrder).toHaveBeenCalledWith({
      cartId: "cart-abc",
      user: {
        emailAddress: baseAddress.email,
        shipping: baseAddress.shipping,
        billing: baseAddress.billing,
      },
    });
    expect(ccCreateStripeCheckout).toHaveBeenCalledWith({
      orderId: "cc-123",
      returnUrl: expect.stringContaining(
        "/dashboard/orders?production=paid&orderId=order-1"
      ),
      cancelUrl: expect.stringContaining("/orders/order-1/pay-production"),
      isTestOrder: true,
    });

    // Both ids persisted via the conditional-update pattern.
    expect(updateSet).toHaveBeenCalledWith({ craftCloudOrderId: "cc-123" });
    expect(updateSet).toHaveBeenCalledWith({
      bridgeSessionId: "bridge-sess-1",
      bridgeSessionUrl: "https://bridge.test/pay",
    });
    // Shipping address still lands with the session swap.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSessionId: "sess_fee",
        shippingAddress: expect.objectContaining({ email: baseAddress.email }),
      })
    );
  });

  it("mints a fee-ONLY session with manual capture and two_step metadata", async () => {
    await completePrintOrder(callArgs);

    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.line_items).toHaveLength(1);
    expect(args.line_items[0].price_data.unit_amount).toBe(150);
    expect(args.line_items[0].price_data.product_data.name).toBe(
      "Service fee"
    );
    expect(args.line_items[0].price_data.product_data.description).toBe(
      "Materialize platform fee (3%) — authorized now, charged only when your order is placed"
    );
    expect(args.payment_intent_data.capture_method).toBe("manual");
    expect(args.metadata).toMatchObject({
      printOrderId: "order-1",
      type: "print_order",
      checkoutModel: "two_step",
    });
    // Session-less landing: the success URL must carry the signed
    // link token so the page renders in cookie-isolated contexts
    // (iOS PWA in-app browser) where the Clerk session is absent.
    expect(args.success_url).toContain(
      "/orders/order-1/pay-production?fee=authorized&t=tok-order-1"
    );
  });

  it("attaches the user's Stripe Customer and saves the card for future one-tap fees", async () => {
    await completePrintOrder(callArgs);

    expect(getOrCreateStripeCustomerMock).toHaveBeenCalledWith(
      "test-user-id",
      { email: baseAddress.email }
    );
    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.customer).toBe("cus_test");
    // customer and customer_email are mutually exclusive on a Stripe
    // session — with a customer attached the email must NOT be sent.
    expect(args.customer_email).toBeUndefined();
    expect(args.payment_intent_data.setup_future_usage).toBe("off_session");
  });

  it("falls back to a plain email session when customer resolution fails — checkout still works, card just isn't saved", async () => {
    getOrCreateStripeCustomerMock.mockRejectedValueOnce(new Error("db blip"));

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.customer).toBeUndefined();
    expect(args.customer_email).toBe(baseAddress.email);
    expect(args.payment_intent_data.setup_future_usage).toBeUndefined();
  });

  it("reuses an existing craftCloudOrderId on retry instead of re-placing", async () => {
    selectedOrder = { ...baseOrder, craftCloudOrderId: "cc-existing" };

    const result = await completePrintOrder(callArgs);

    expect(ccCreateOrder).not.toHaveBeenCalled();
    expect(ccCreateStripeCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "cc-existing" })
    );
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("reuses an existing bridge session on retry instead of re-creating", async () => {
    selectedOrder = {
      ...baseOrder,
      craftCloudOrderId: "cc-existing",
      bridgeSessionUrl: "https://bridge.test/existing",
    };

    const result = await completePrintOrder(callArgs);

    expect(ccCreateOrder).not.toHaveBeenCalled();
    expect(ccCreateStripeCheckout).not.toHaveBeenCalled();
    // Fee session is still (re)minted under the claim.
    expect(stripeCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("releases the session claim and returns a friendly error when createOrder fails", async () => {
    ccCreateOrder.mockRejectedValueOnce(new Error("CraftCloud 500"));

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({
      error:
        "Could not place your order with the print service. Please try again.",
    });
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(ccCreateStripeCheckout).not.toHaveBeenCalled();
    // Claim release: last sessionId write nulls the sentinel out.
    const releaseCall = updateSet.mock.calls.find(
      (c) => (c[0] as { stripeSessionId?: unknown }).stripeSessionId === null
    );
    expect(releaseCall).toBeDefined();
  });

  it("single-mode orders keep the full line-item charge session (no manual capture)", async () => {
    selectedOrder = { ...baseOrder, checkoutModel: "single" };

    const result = await completePrintOrder(callArgs);

    expect(ccCreateOrder).not.toHaveBeenCalled();
    expect(ccCreateStripeCheckout).not.toHaveBeenCalled();
    // Card-on-file is a two_step feature: no customer resolution, no
    // saved-card attempt, plain email session.
    expect(getOrCreateStripeCustomerMock).not.toHaveBeenCalled();
    expect(stripeCreatePI).not.toHaveBeenCalled();
    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.customer_email).toBe(baseAddress.email);
    expect(args.payment_intent_data.setup_future_usage).toBeUndefined();
    // Print + shipping + fee lines — not fee-only.
    expect(args.line_items.length).toBeGreaterThan(1);
    expect(args.payment_intent_data.capture_method).toBeUndefined();
    // Observability stamp only — everything else unchanged.
    expect(args.metadata).toMatchObject({
      printOrderId: "order-1",
      type: "print_order",
      checkoutModel: "single",
    });
    expect(args.success_url).toContain("payment=success&orderId=order-1");
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });
});

describe("completePrintOrder (two_step, one-tap saved card)", () => {
  const savedCard = { stripeCustomerId: "cus_1", defaultPaymentMethod: "pm_1" };

  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...baseOrder };
    claimReturns = [{ id: "order-1" }];
    billingRows = [savedCard];
    returningQueue = null;
    getOrCreateStripeCustomerMock.mockResolvedValue("cus_1");
    ccCreateOrder.mockResolvedValue({ orderId: "cc-123", status: "ordered" });
    ccCreateStripeCheckout.mockResolvedValue({
      sessionId: "bridge-sess-1",
      sessionUrl: "https://bridge.test/pay",
    });
    stripeCreate.mockResolvedValue({
      id: "sess_fee",
      url: "https://stripe.test/fee",
    });
    stripeCreatePI.mockResolvedValue({
      id: "pi_onetap",
      status: "requires_capture",
    });
  });

  it("authorizes the fee on the saved card and returns the bridge URL — no Checkout redirect", async () => {
    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://bridge.test/pay" });
    expect(stripeCreate).not.toHaveBeenCalled();

    expect(stripeCreatePI).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 150,
        currency: "usd",
        customer: "cus_1",
        payment_method: "pm_1",
        confirm: true,
        // Customer-initiated: the buyer just clicked "Proceed to
        // checkout" — this is NOT an off-session merchant charge.
        off_session: false,
        // Hold only — the reconcile cron captures after CraftCloud
        // confirms production payment (two_step money invariant).
        capture_method: "manual",
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        metadata: expect.objectContaining({
          printOrderId: "order-1",
          type: "print_order",
          checkoutModel: "two_step",
          source: "saved_card_fee_auth",
        }),
      }),
      { idempotencyKey: "fee-auth:order-1" }
    );

    // Same advancement the webhook performs for hosted sessions, plus
    // the PI id lands in stripeSessionId (overloaded column — the
    // pi_ prefix is what classifyPaymentRef keys on).
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_production_payment",
        feePaymentIntentId: "pi_onetap",
        feeAuthorizedAt: expect.any(Date),
        stripeSessionId: "pi_onetap",
        shippingAddress: expect.objectContaining({ email: baseAddress.email }),
      })
    );
  });

  it("still places the CraftCloud order + bridge session before authorizing", async () => {
    await completePrintOrder(callArgs);

    expect(ccCreateOrder).toHaveBeenCalledTimes(1);
    expect(ccCreateStripeCheckout).toHaveBeenCalledTimes(1);
    expect(ccCreateOrder.mock.invocationCallOrder[0]).toBeLessThan(
      stripeCreatePI.mock.invocationCallOrder[0]
    );
  });

  it("falls back to hosted Checkout when the saved card declines, and logs", async () => {
    stripeCreatePI.mockRejectedValueOnce(new Error("card_declined"));

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
    expect(logError).toHaveBeenCalledWith(
      "completePrintOrder.savedCardFeeAuth",
      expect.any(Error)
    );
  });

  it("falls back to hosted Checkout when the card needs 3DS (requires_action)", async () => {
    stripeCreatePI.mockResolvedValueOnce({
      id: "pi_onetap",
      status: "requires_action",
    });

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
    // An unactioned intent isn't a hold — nothing to cancel.
    expect(stripeCancelPI).not.toHaveBeenCalled();
  });

  it("cancels the hold and falls back when the advance write loses the row", async () => {
    // Retry-style order: CraftCloud id + bridge already persisted, so
    // the only .returning() calls are the session claim (wins) and the
    // one-tap advance (loses).
    selectedOrder = {
      ...baseOrder,
      craftCloudOrderId: "cc-existing",
      bridgeSessionUrl: "https://bridge.test/pay",
    };
    returningQueue = [[{ id: "order-1" }], []];

    const result = await completePrintOrder(callArgs);

    expect(stripeCancelPI).toHaveBeenCalledWith("pi_onetap");
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("never attempts a PaymentIntent when no card is on file", async () => {
    billingRows = [{ stripeCustomerId: "cus_1", defaultPaymentMethod: null }];

    const result = await completePrintOrder(callArgs);

    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });
});

describe("resumePrintOrder (two_step, awaiting_production_payment)", () => {
  const awaitingOrder = {
    ...baseOrder,
    status: "awaiting_production_payment",
    craftCloudOrderId: "cc-123",
    stripeSessionId: "sess_fee",
    feePaymentIntentId: "pi_fee_1",
    bridgeSessionId: "bridge-sess-1",
    bridgeSessionUrl: "https://bridge.test/pay",
    shippingAddress: { email: baseAddress.email },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...awaitingOrder };
    claimReturns = [{ id: "order-1" }];
    billingRows = [];
    returningQueue = null;
  });

  it("returns the bridge session URL while the fee hold is still capturable", async () => {
    stripeRetrievePI.mockResolvedValueOnce({ status: "requires_capture" });

    const result = await resumePrintOrder("order-1");

    expect(stripeRetrievePI).toHaveBeenCalledWith("pi_fee_1");
    expect(result).toEqual({ checkoutUrl: "https://bridge.test/pay" });
    // No new sessions of any kind get minted on this path.
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(ccCreateStripeCheckout).not.toHaveBeenCalled();
  });

  it("returns the expired-authorization error when the fee hold was canceled", async () => {
    stripeRetrievePI.mockResolvedValueOnce({ status: "canceled" });

    const result = await resumePrintOrder("order-1");

    expect(result).toEqual({
      error:
        "Your card authorization expired. Please start a new checkout from the material picker.",
    });
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("treats a missing feePaymentIntentId defensively as an expired hold", async () => {
    selectedOrder = { ...awaitingOrder, feePaymentIntentId: null };

    const result = await resumePrintOrder("order-1");

    expect(stripeRetrievePI).not.toHaveBeenCalled();
    expect(result).toEqual({
      error:
        "Your card authorization expired. Please start a new checkout from the material picker.",
    });
  });

  it("treats a missing bridgeSessionUrl defensively as an expired hold", async () => {
    selectedOrder = { ...awaitingOrder, bridgeSessionUrl: null };

    const result = await resumePrintOrder("order-1");

    expect(stripeRetrievePI).not.toHaveBeenCalled();
    expect(result).toEqual({
      error:
        "Your card authorization expired. Please start a new checkout from the material picker.",
    });
  });

  it("rejects other PI states (e.g. already captured) as already processed", async () => {
    stripeRetrievePI.mockResolvedValueOnce({ status: "succeeded" });

    const result = await resumePrintOrder("order-1");

    expect(result).toEqual({ error: "Order already processed" });
  });
});
