import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Two-step checkout model coverage for completePrintOrder /
// resumePrintOrder. Mock scaffolding mirrors
// print-checkout-lock.test.ts:
//   - selectedOrder: what db.select(printOrders).where() returns
//   - claimReturns: rows every UPDATE().returning() yields — the
//     session claim AND the conditional craftCloudOrderId / bridge
//     persists share it ([{id}] = the write landed).
let selectedOrder: Record<string, unknown> | null = null;
// When set, printOrders SELECTs consume from this queue in order
// instead of returning selectedOrder — lets a test give the initial
// order fetch and a later re-read (e.g. advanceFeeAuthorizedOrder's
// freshness check) different rows. Falls back to selectedOrder once
// exhausted.
let selectQueue: Array<Array<Record<string, unknown>>> | null = null;
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
          where: () => {
            const rows =
              selectQueue && selectQueue.length > 0
                ? selectQueue.shift()!
                : selectedOrder
                  ? [selectedOrder]
                  : [];
            // Some call sites chain .limit(1); drizzle results are
            // awaitable either way, so hand back an array that also
            // answers .limit().
            return Object.assign(rows, { limit: () => rows });
          },
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
const stripeUpdatePI = vi.fn();
const stripeRetrievePM = vi.fn();
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
      update: (...args: unknown[]) => stripeUpdatePI(...args),
    },
    paymentMethods: {
      retrieve: (...args: unknown[]) => stripeRetrievePM(...args),
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
  // Live-mode default: healMockBridgeUrl must be a pass-through in
  // these tests so stored bridge URLs come back verbatim.
  isMockCheckoutMode: vi.fn(() => false),
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

import {
  completePrintOrder,
  finalizeFeeAuthorization,
  resumePrintOrder,
} from "../print";
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
    selectQueue = null;
    claimReturns = [{ id: "order-1" }];
    billingRows = []; // default: no card on file → hosted Checkout
    returningQueue = null;
    // No publishable key → the embedded fee sheet is never offered,
    // so these tests exercise the hosted-Checkout path unchanged.
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
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
  // One-tap only runs after the user answered the confirmation
  // sheet — these tests exercise the post-confirm leg.
  const oneTapArgs = { ...callArgs, feePayment: "saved_card" as const };

  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...baseOrder };
    selectQueue = null;
    claimReturns = [{ id: "order-1" }];
    billingRows = [savedCard];
    returningQueue = null;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
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
    const result = await completePrintOrder(oneTapArgs);

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
    await completePrintOrder(oneTapArgs);

    expect(ccCreateOrder).toHaveBeenCalledTimes(1);
    expect(ccCreateStripeCheckout).toHaveBeenCalledTimes(1);
    expect(ccCreateOrder.mock.invocationCallOrder[0]).toBeLessThan(
      stripeCreatePI.mock.invocationCallOrder[0]
    );
  });

  it("falls back to hosted Checkout when the saved card declines, and logs", async () => {
    stripeCreatePI.mockRejectedValueOnce(new Error("card_declined"));

    const result = await completePrintOrder(oneTapArgs);

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

    const result = await completePrintOrder(oneTapArgs);

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

    const result = await completePrintOrder(oneTapArgs);

    expect(stripeCancelPI).toHaveBeenCalledWith("pi_onetap");
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("never attempts a PaymentIntent when no card is on file", async () => {
    billingRows = [{ stripeCustomerId: "cus_1", defaultPaymentMethod: null }];

    const result = await completePrintOrder(callArgs);

    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("stops for confirmation before ANY charge or CraftCloud work when no feePayment is given", async () => {
    stripeRetrievePM.mockResolvedValueOnce({
      type: "card",
      card: { brand: "visa", last4: "4242" },
    });

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({
      savedCardConfirm: {
        orderId: "order-1",
        amountCents: 150,
        brand: "visa",
        last4: "4242",
      },
    });
    // Nothing touched: no claim, no CraftCloud order, no Stripe
    // charge — the confirmation must be free to abandon.
    expect(updateSet).not.toHaveBeenCalled();
    expect(ccCreateOrder).not.toHaveBeenCalled();
    expect(ccCreateStripeCheckout).not.toHaveBeenCalled();
    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("describes a saved Link method without last4", async () => {
    stripeRetrievePM.mockResolvedValueOnce({ type: "link" });

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({
      savedCardConfirm: {
        orderId: "order-1",
        amountCents: 150,
        brand: "link",
        last4: null,
      },
    });
  });

  it("falls through WITHOUT charging when the saved method can't be described", async () => {
    stripeRetrievePM.mockRejectedValueOnce(new Error("no such payment_method"));

    const result = await completePrintOrder(callArgs);

    // Summary failed → skip confirm AND skip one-tap (a lookup
    // failure must never become a silent charge); no publishable key
    // in this describe → hosted Checkout fallback.
    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("feePayment: \"new_card\" skips one-tap even with a card on file", async () => {
    const result = await completePrintOrder({
      ...callArgs,
      feePayment: "new_card" as const,
    });

    // No confirmation detour, no saved-card PI — straight past
    // one-tap to the fallback (hosted here: no publishable key).
    expect(stripeRetrievePM).not.toHaveBeenCalled();
    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });
});

describe("completePrintOrder (two_step, embedded fee sheet)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...baseOrder };
    selectQueue = null;
    claimReturns = [{ id: "order-1" }];
    billingRows = []; // no saved card → one-tap skipped, sheet offered
    returningQueue = null;
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_sheet";
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
      id: "pi_sheet_1",
      status: "requires_payment_method",
      client_secret: "cs_secret_1",
    });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  });

  it("returns the sheet payload instead of a redirect for first-time buyers", async () => {
    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({
      feeSheet: {
        clientSecret: "cs_secret_1",
        orderId: "order-1",
        amountCents: 150,
        email: baseAddress.email,
      },
    });
    // No hosted session was minted — the sheet replaces the redirect.
    expect(stripeCreate).not.toHaveBeenCalled();

    expect(stripeCreatePI).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 150,
        currency: "usd",
        customer: "cus_1",
        capture_method: "manual",
        // Card gets saved on confirm → next order is one-tap.
        setup_future_usage: "off_session",
        // Pinned to card + Link ("link" powers the express row's
        // Link button; Instant Bank Payments stays off at the
        // merchant level): automatic_payment_methods would surface
        // every dashboard-enabled non-redirect method (e.g.
        // us_bank_account).
        payment_method_types: ["card", "link"],
        metadata: expect.objectContaining({
          printOrderId: "order-1",
          type: "print_order",
          checkoutModel: "two_step",
          source: "embedded_fee_sheet",
        }),
      }),
      { idempotencyKey: "fee-sheet:v4:order-1" }
    );

    // Sentinel swapped for the PI id + address persisted — but the
    // order does NOT advance: it stays cart_created until the client
    // confirms and finalize (or the webhook backstop) runs.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSessionId: "pi_sheet_1",
        shippingAddress: expect.objectContaining({ email: baseAddress.email }),
      })
    );
    const advanceWrites = updateSet.mock.calls.filter(
      (c) =>
        (c[0] as { status?: string }).status === "awaiting_production_payment"
    );
    expect(advanceWrites).toHaveLength(0);
  });

  it("still runs CraftCloud prep before offering the sheet", async () => {
    await completePrintOrder(callArgs);

    expect(ccCreateOrder).toHaveBeenCalledTimes(1);
    expect(ccCreateStripeCheckout).toHaveBeenCalledTimes(1);
    expect(ccCreateOrder.mock.invocationCallOrder[0]).toBeLessThan(
      stripeCreatePI.mock.invocationCallOrder[0]
    );
  });

  it("falls back to hosted Checkout when the publishable key isn't deployed", async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    const result = await completePrintOrder(callArgs);

    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("falls back to hosted Checkout when PI creation fails, and logs", async () => {
    stripeCreatePI.mockRejectedValueOnce(new Error("stripe down"));

    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
    expect(logError).toHaveBeenCalledWith(
      "completePrintOrder.feeSheet.createIntent",
      expect.any(Error)
    );
  });

  it("falls back to hosted Checkout when customer resolution fails", async () => {
    getOrCreateStripeCustomerMock.mockRejectedValueOnce(new Error("db blip"));

    const result = await completePrintOrder(callArgs);

    expect(stripeCreatePI).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/fee" });
  });

  it("a saved card stops for confirmation; confirming runs one-tap and never offers the sheet", async () => {
    billingRows = [
      { stripeCustomerId: "cus_1", defaultPaymentMethod: "pm_1" },
    ];
    stripeRetrievePM.mockResolvedValueOnce({
      type: "card",
      card: { brand: "visa", last4: "4242" },
    });

    // First call (no feePayment): confirmation, no charge.
    const first = await completePrintOrder(callArgs);
    expect(first).toEqual({
      savedCardConfirm: {
        orderId: "order-1",
        amountCents: 150,
        brand: "visa",
        last4: "4242",
      },
    });
    expect(stripeCreatePI).not.toHaveBeenCalled();

    // Confirmed re-call: one-tap fires, sheet PI never minted.
    stripeCreatePI.mockResolvedValueOnce({
      id: "pi_onetap",
      status: "requires_capture",
    });
    const result = await completePrintOrder({
      ...callArgs,
      feePayment: "saved_card" as const,
    });

    expect(result).toEqual({ checkoutUrl: "https://bridge.test/pay" });
    expect(stripeCreatePI).toHaveBeenCalledTimes(1);
    expect(stripeCreatePI).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "fee-auth:order-1",
    });
  });

  it("feePayment: \"new_card\" with a saved card mints the sheet, not the one-tap PI", async () => {
    billingRows = [
      { stripeCustomerId: "cus_1", defaultPaymentMethod: "pm_1" },
    ];

    const result = await completePrintOrder({
      ...callArgs,
      feePayment: "new_card" as const,
    });

    expect(result).toEqual({
      feeSheet: {
        clientSecret: "cs_secret_1",
        orderId: "order-1",
        amountCents: 150,
        email: baseAddress.email,
      },
    });
    // Exactly one PI — the embedded-sheet one, not saved_card_fee_auth.
    expect(stripeCreatePI).toHaveBeenCalledTimes(1);
    expect(stripeCreatePI).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ source: "embedded_fee_sheet" }),
      }),
      { idempotencyKey: "fee-sheet:v4:order-1" }
    );
  });

  describe("re-entry with an existing sheet PI (abandoned sheet, second tab)", () => {
    beforeEach(() => {
      selectedOrder = { ...baseOrder, stripeSessionId: "pi_sheet_1" };
    });

    it("reopens the sheet with the same clientSecret while the PI is confirmable", async () => {
      stripeRetrievePI.mockResolvedValueOnce({
        id: "pi_sheet_1",
        status: "requires_payment_method",
        client_secret: "cs_secret_1",
        payment_method_types: ["card", "link"],
        metadata: { source: "embedded_fee_sheet", printOrderId: "order-1" },
      });

      const result = await completePrintOrder(callArgs);

      expect(result).toEqual({
        feeSheet: {
          clientSecret: "cs_secret_1",
          orderId: "order-1",
          amountCents: 150,
        },
      });
      // No new PI, no new CraftCloud calls, no pin rewrite — pure reuse.
      expect(stripeCreatePI).not.toHaveBeenCalled();
      expect(ccCreateOrder).not.toHaveBeenCalled();
      expect(stripeUpdatePI).not.toHaveBeenCalled();
    });

    it("pins the method list in place when reopening a pre-pin PI", async () => {
      stripeRetrievePI.mockResolvedValueOnce({
        id: "pi_sheet_1",
        status: "requires_payment_method",
        client_secret: "cs_secret_1",
        // Minted under an earlier pin (v3 was card-only), or under
        // automatic_payment_methods with a different method set.
        payment_method_types: ["card"],
        metadata: { source: "embedded_fee_sheet", printOrderId: "order-1" },
      });
      stripeUpdatePI.mockResolvedValueOnce({ id: "pi_sheet_1" });

      const result = await completePrintOrder(callArgs);

      expect(stripeUpdatePI).toHaveBeenCalledWith("pi_sheet_1", {
        payment_method_types: ["card", "link"],
      });
      expect(result).toEqual({
        feeSheet: {
          clientSecret: "cs_secret_1",
          orderId: "order-1",
          amountCents: 150,
        },
      });
      expect(stripeCreatePI).not.toHaveBeenCalled();
    });

    it("cancels the pre-pin PI and remints when the pin update is refused", async () => {
      stripeRetrievePI.mockResolvedValueOnce({
        id: "pi_sheet_1",
        status: "requires_payment_method",
        client_secret: "cs_secret_1",
        payment_method_types: ["card", "link", "us_bank_account"],
        metadata: { source: "embedded_fee_sheet", printOrderId: "order-1" },
      });
      stripeUpdatePI.mockRejectedValueOnce(
        new Error("automatic_payment_methods PIs cannot pin types")
      );

      const result = await completePrintOrder(callArgs);

      // Old PI canceled, ref cleared, fresh pinned PI minted.
      expect(stripeCancelPI).toHaveBeenCalledWith("pi_sheet_1");
      expect(updateSet).toHaveBeenCalledWith({ stripeSessionId: null });
      expect(stripeCreatePI).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method_types: ["card", "link"],
        }),
        { idempotencyKey: "fee-sheet:v4:order-1" }
      );
      expect(result).toEqual({
        feeSheet: {
          clientSecret: "cs_secret_1",
          orderId: "order-1",
          amountCents: 150,
          email: baseAddress.email,
        },
      });
    });

    it("advances and goes straight to CraftCloud when the hold already exists (finalize died)", async () => {
      stripeRetrievePI.mockResolvedValue({
        id: "pi_sheet_1",
        status: "requires_capture",
        client_secret: "cs_secret_1",
        metadata: { source: "embedded_fee_sheet", printOrderId: "order-1" },
      });
      // Initial fetch: cart_created with the PI ref; the advance's
      // freshness re-read sees the advanced row.
      selectQueue = [
        [{ ...baseOrder, stripeSessionId: "pi_sheet_1" }],
        [
          {
            status: "awaiting_production_payment",
            bridgeSessionUrl: "https://bridge.test/pay",
          },
        ],
      ];

      const result = await completePrintOrder(callArgs);

      expect(result).toEqual({ checkoutUrl: "https://bridge.test/pay" });
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "awaiting_production_payment",
          feePaymentIntentId: "pi_sheet_1",
        })
      );
    });

    it("keeps the agent-charge message for PIs that aren't sheet PIs", async () => {
      stripeRetrievePI.mockResolvedValueOnce({
        id: "pi_agent",
        status: "requires_capture",
        metadata: { printOrderId: "order-1" }, // no source
      });

      const result = await completePrintOrder(callArgs);

      expect(result).toEqual({
        error:
          "Your order is being placed — it will appear under Orders shortly.",
      });
    });

    it("clears a canceled sheet PI and mints a fresh checkout", async () => {
      stripeRetrievePI.mockResolvedValueOnce({
        id: "pi_sheet_1",
        status: "canceled",
        metadata: { source: "embedded_fee_sheet", printOrderId: "order-1" },
      });
      // A fresh sheet PI gets created after the dead ref clears.
      const result = await completePrintOrder(callArgs);

      // Ref cleared conditionally on the dead PI id.
      expect(updateSet).toHaveBeenCalledWith({ stripeSessionId: null });
      expect(result).toEqual({
        feeSheet: {
          clientSecret: "cs_secret_1",
          orderId: "order-1",
          amountCents: 150,
          email: baseAddress.email,
        },
      });
    });
  });
});

describe("finalizeFeeAuthorization", () => {
  const sheetPI = {
    id: "pi_sheet_1",
    status: "requires_capture",
    client_secret: "cs_secret_1",
    metadata: { source: "embedded_fee_sheet", printOrderId: "order-1" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...baseOrder, stripeSessionId: "pi_sheet_1" };
    selectQueue = null;
    claimReturns = [{ id: "order-1" }];
    billingRows = [];
    returningQueue = null;
    stripeRetrievePI.mockResolvedValue({ ...sheetPI });
  });

  it("verifies the hold on Stripe, advances the order, and returns the CraftCloud URL", async () => {
    selectQueue = [
      [{ ...baseOrder, stripeSessionId: "pi_sheet_1" }],
      [
        {
          status: "awaiting_production_payment",
          bridgeSessionUrl: "https://bridge.test/pay",
        },
      ],
    ];

    const result = await finalizeFeeAuthorization("order-1");

    expect(result).toEqual({
      productionPaymentUrl: "https://bridge.test/pay",
    });
    expect(stripeRetrievePI).toHaveBeenCalledWith("pi_sheet_1");
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_production_payment",
        feePaymentIntentId: "pi_sheet_1",
        feeAuthorizedAt: expect.any(Date),
      })
    );
  });

  it("is idempotent: an already-advanced order returns the URL without touching Stripe", async () => {
    selectedOrder = {
      ...baseOrder,
      status: "awaiting_production_payment",
      stripeSessionId: "pi_sheet_1",
      bridgeSessionUrl: "https://bridge.test/pay",
    };

    const result = await finalizeFeeAuthorization("order-1");

    expect(result).toEqual({
      productionPaymentUrl: "https://bridge.test/pay",
    });
    expect(stripeRetrievePI).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects when the PI belongs to a different order (metadata mismatch)", async () => {
    stripeRetrievePI.mockResolvedValue({
      ...sheetPI,
      metadata: { source: "embedded_fee_sheet", printOrderId: "order-OTHER" },
    });

    const result = await finalizeFeeAuthorization("order-1");

    expect(result).toEqual({ error: "No payment is pending for this order" });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects when the hold doesn't exist yet (client lied or confirm still pending)", async () => {
    stripeRetrievePI.mockResolvedValue({
      ...sheetPI,
      status: "requires_payment_method",
    });

    const result = await finalizeFeeAuthorization("order-1");

    expect(result).toEqual({
      error: "Your payment hasn't completed yet. Please try again.",
    });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects when no PaymentIntent is attached to the order", async () => {
    selectedOrder = { ...baseOrder, stripeSessionId: null };

    const result = await finalizeFeeAuthorization("order-1");

    expect(result).toEqual({ error: "No payment is pending for this order" });
    expect(stripeRetrievePI).not.toHaveBeenCalled();
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
    selectQueue = null;
    claimReturns = [{ id: "order-1" }];
    billingRows = [];
    returningQueue = null;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
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
