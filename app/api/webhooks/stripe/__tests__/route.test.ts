import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// `next/headers` is NOT pre-mocked by vitest.setup.ts — the route reads the
// Stripe-Signature header from it. We drive it per-test via mockSignature.
let mockSignature: string | null = "sig_valid";
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name.toLowerCase() === "stripe-signature" ? mockSignature : null,
    }),
}));

// Stripe SDK: signature verification + account re-fetch + setup-intent fetch.
// `constructEvent` returns whatever we stage in `nextEvent`, or throws when
// `signatureValid` is false (mirroring a bad/absent signature).
let nextEvent: Stripe.Event | null = null;
let signatureValid = true;
const mockConstructEvent = vi.fn((..._args: unknown[]) => {
  if (!signatureValid) {
    throw new Error("No signatures found matching the expected signature");
  }
  return nextEvent;
});
const mockAccountsRetrieve = vi.fn();
const mockSetupIntentsRetrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mockConstructEvent },
    accounts: { retrieve: mockAccountsRetrieve },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
  }),
}));

// Handler modules — fully mocked so we only assert routing/dispatch.
const mockHandlePrintOrderPayment = vi.fn();
const mockHandleListingPurchase = vi.fn();
const mockHandleListingRefund = vi.fn();
vi.mock("@/lib/stripe/handle-print-order-payment", () => ({
  handlePrintOrderPayment: (...a: unknown[]) => mockHandlePrintOrderPayment(...a),
}));
vi.mock("@/lib/stripe/handle-listing-purchase", () => ({
  handleListingPurchase: (...a: unknown[]) => mockHandleListingPurchase(...a),
}));
vi.mock("@/lib/stripe/handle-listing-refund", () => ({
  handleListingRefund: (...a: unknown[]) => mockHandleListingRefund(...a),
}));

// DB: the route SELECTs the dedup table (returns dedupExisting), runs handlers,
// then INSERTs the processed-event row. We spy on both.
let dedupExisting: Array<{ id: string }> = [];
const mockDbInsert = vi.fn();
const mockDbUpdateSet = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => dedupExisting,
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockDbUpdateSet(values);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        mockDbInsert(v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", stripeAccountId: "stripe_account_id" },
  webhookEventsProcessed: { id: "id", eventType: "event_type" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...a: unknown[]) => mockLogError(...a),
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLD_ENV = process.env.STRIPE_WEBHOOK_SECRET;

function makeRequest(body = "{}") {
  return new Request("https://example.com/api/webhooks/stripe", {
    method: "POST",
    body,
  });
}

// Stripe.Event is a discriminated union, so we can't spread a typed
// partial into it cleanly. Build a plain shape and cast through unknown —
// the route only reads id, created, type, and data.object.
function event(partial: {
  type: string;
  id?: string;
  created?: number;
  data?: { object: unknown };
}): Stripe.Event {
  return {
    id: "evt_test",
    created: 1_700_000_000,
    data: { object: {} },
    ...partial,
  } as unknown as Stripe.Event;
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignature = "sig_valid";
    signatureValid = true;
    nextEvent = null;
    dedupExisting = [];
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  // -------------------------------------------------------------------------
  // (1) Signature verification
  // -------------------------------------------------------------------------
  it("rejects an absent Stripe-Signature with 400 and runs no handler", async () => {
    mockSignature = null;

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(mockConstructEvent).not.toHaveBeenCalled();
    expect(mockHandlePrintOrderPayment).not.toHaveBeenCalled();
    expect(mockHandleListingPurchase).not.toHaveBeenCalled();
    expect(mockHandleListingRefund).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid Stripe-Signature with 400 and runs no handler", async () => {
    signatureValid = false; // constructEvent throws
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          metadata: { type: "print_order", printOrderId: "po_1" },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(mockHandlePrintOrderPayment).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (2) Routing
  // -------------------------------------------------------------------------
  it("routes a paid checkout.session.completed (print_order) to handlePrintOrderPayment", async () => {
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          payment_intent: "pi_single_1",
          metadata: { type: "print_order", printOrderId: "po_1" },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandlePrintOrderPayment).toHaveBeenCalledTimes(1);
    expect(mockHandlePrintOrderPayment).toHaveBeenCalledWith("po_1", {
      paymentIntentId: "pi_single_1",
    });
    expect(mockHandleListingPurchase).not.toHaveBeenCalled();
    expect(mockHandleListingRefund).not.toHaveBeenCalled();
    // Event recorded in the dedup table only after the handler succeeds.
    expect(mockDbInsert).toHaveBeenCalledWith({
      id: "evt_test",
      eventType: "checkout.session.completed",
    });
  });

  it("routes checkout.session.async_payment_succeeded (print_order) to handlePrintOrderPayment", async () => {
    nextEvent = event({
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          metadata: { type: "print_order", printOrderId: "po_async" },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandlePrintOrderPayment).toHaveBeenCalledWith("po_async", {
      paymentIntentId: undefined,
    });
  });

  it("routes an UNPAID two-step fee session (manual capture) to handlePrintOrderPayment", async () => {
    // Under capture_method: "manual" a completed session reports
    // payment_status "unpaid" — the funds are authorized, not
    // captured. The route must still dispatch it (recognized by the
    // two_step metadata), or fee authorizations would be silently
    // dropped.
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "unpaid",
          payment_intent: "pi_fee_1",
          metadata: {
            type: "print_order",
            checkoutModel: "two_step",
            printOrderId: "po_two_step",
          },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandlePrintOrderPayment).toHaveBeenCalledTimes(1);
    expect(mockHandlePrintOrderPayment).toHaveBeenCalledWith("po_two_step", {
      paymentIntentId: "pi_fee_1",
    });
    // Handled events land in the dedup table.
    expect(mockDbInsert).toHaveBeenCalledWith({
      id: "evt_test",
      eventType: "checkout.session.completed",
    });
  });

  it("normalizes an expanded payment_intent object to its id", async () => {
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "unpaid",
          payment_intent: { id: "pi_expanded" },
          metadata: {
            type: "print_order",
            checkoutModel: "two_step",
            printOrderId: "po_two_step",
          },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandlePrintOrderPayment).toHaveBeenCalledWith("po_two_step", {
      paymentIntentId: "pi_expanded",
    });
  });

  it("still drops an unpaid completed session WITHOUT two_step metadata (single gating unchanged)", async () => {
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "unpaid",
          metadata: { type: "print_order", printOrderId: "po_1" },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandlePrintOrderPayment).not.toHaveBeenCalled();
    // Not a recognized shape → not recorded in the dedup table.
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("routes a listing_purchase checkout session to handleListingPurchase", async () => {
    const session = {
      payment_status: "paid",
      metadata: { type: "listing_purchase" },
    };
    nextEvent = event({
      type: "checkout.session.completed",
      data: { object: session },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandleListingPurchase).toHaveBeenCalledTimes(1);
    expect(mockHandleListingPurchase).toHaveBeenCalledWith(session);
    expect(mockHandlePrintOrderPayment).not.toHaveBeenCalled();
  });

  it("routes charge.refunded to handleListingRefund", async () => {
    const charge = { id: "ch_1", refunded: true };
    nextEvent = event({
      type: "charge.refunded",
      data: { object: charge },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandleListingRefund).toHaveBeenCalledTimes(1);
    expect(mockHandleListingRefund).toHaveBeenCalledWith(charge);
  });

  it("routes account.updated through a fresh account re-fetch (CON-48)", async () => {
    // The stale event payload says charges_enabled=false, but the fresh
    // re-fetch reports true — the route must persist the FRESH value.
    nextEvent = event({
      type: "account.updated",
      data: {
        object: { id: "acct_1", charges_enabled: false },
      },
    });
    mockAccountsRetrieve.mockResolvedValue({
      id: "acct_1",
      charges_enabled: true,
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockAccountsRetrieve).toHaveBeenCalledWith("acct_1");
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      stripeOnboardingComplete: true,
    });
  });

  it("treats an unknown event type as a no-op 200 and records nothing", async () => {
    nextEvent = event({
      type: "payment_intent.created",
      data: { object: {} },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandlePrintOrderPayment).not.toHaveBeenCalled();
    expect(mockHandleListingPurchase).not.toHaveBeenCalled();
    expect(mockHandleListingRefund).not.toHaveBeenCalled();
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
    // Unhandled types are not recorded in the dedup table.
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (3) Idempotent retry
  // -------------------------------------------------------------------------
  it("no-ops a retry whose event id was already recorded — does not re-place the order", async () => {
    dedupExisting = [{ id: "evt_test" }]; // prior delivery committed
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          metadata: { type: "print_order", printOrderId: "po_1" },
        },
      },
    });

    const res = await POST(makeRequest());
    const json = (await res.json()) as { received: boolean; duplicate?: boolean };

    expect(res.status).toBe(200);
    expect(json.duplicate).toBe(true);
    // The CraftCloud-order-placing handler must NOT run on a retry.
    expect(mockHandlePrintOrderPayment).not.toHaveBeenCalled();
    // And we don't double-insert the dedup row.
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns 500 (so Stripe retries) when the print-order handler throws, and does NOT record the event", async () => {
    mockHandlePrintOrderPayment.mockRejectedValueOnce(new Error("boom"));
    nextEvent = event({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          metadata: { type: "print_order", printOrderId: "po_1" },
        },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    // Failed handlers are not marked processed, so the retry re-runs them.
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// (4) billing_setup — TEST-25 (2026-07-25 audit). This is the only
// success-path writer of users.defaultPaymentMethod, which the agent
// off-session charge path (lib/mcp/internal/orders.ts) depends on to
// place auto-approved orders. mockSetupIntentsRetrieve was declared in
// this suite from the start but never exercised.
// -----------------------------------------------------------------------
describe("POST /api/webhooks/stripe — billing_setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignature = "sig_valid";
    signatureValid = true;
    nextEvent = null;
    dedupExisting = [];
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  function billingSetupEvent(overrides: {
    setup_intent?: unknown;
    userId?: string | undefined;
  }) {
    return event({
      type: "checkout.session.completed",
      id: "evt_billing_setup",
      data: {
        object: {
          mode: "setup",
          metadata: {
            type: "billing_setup",
            ...(overrides.userId !== undefined
              ? { userId: overrides.userId }
              : { userId: "user_1" }),
          },
          setup_intent: overrides.setup_intent,
        },
      },
    });
  }

  it("string setup_intent: writes defaultPaymentMethod and records the event", async () => {
    nextEvent = billingSetupEvent({ setup_intent: "seti_123" });
    mockSetupIntentsRetrieve.mockResolvedValue({
      payment_method: "pm_abc",
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSetupIntentsRetrieve).toHaveBeenCalledWith("seti_123");
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      defaultPaymentMethod: "pm_abc",
    });
    expect(mockDbInsert).toHaveBeenCalledWith({
      id: "evt_billing_setup",
      eventType: "checkout.session.completed",
    });
  });

  it("expanded setup_intent object: normalizes to its id before retrieving", async () => {
    nextEvent = billingSetupEvent({ setup_intent: { id: "seti_expanded" } });
    mockSetupIntentsRetrieve.mockResolvedValue({
      payment_method: { id: "pm_expanded" },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSetupIntentsRetrieve).toHaveBeenCalledWith("seti_expanded");
    // payment_method itself may also arrive expanded — normalized the
    // same way as the top-level setup_intent id.
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      defaultPaymentMethod: "pm_expanded",
    });
  });

  it("SetupIntent with null payment_method: no write, still 200, event still recorded", async () => {
    nextEvent = billingSetupEvent({ setup_intent: "seti_no_pm" });
    mockSetupIntentsRetrieve.mockResolvedValue({ payment_method: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalledWith({
      id: "evt_billing_setup",
      eventType: "checkout.session.completed",
    });
  });

  it("setupIntents.retrieve throwing does not 500 — logs and lets the user retry from the dashboard (no-retry contract)", async () => {
    nextEvent = billingSetupEvent({ setup_intent: "seti_boom" });
    mockSetupIntentsRetrieve.mockRejectedValue(new Error("stripe down"));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalled();
    const [tag] = mockLogError.mock.calls[0];
    expect(tag).toBe("stripe-webhook-billing-setup");
    // The webhook route swallows this error rather than returning 500, so
    // Stripe will NOT retry delivery — the event is still marked
    // processed even though the save failed. This is the deliberate
    // "don't retry forever over a failed card save" contract described
    // in route.ts's billing_setup catch block.
    expect(mockDbInsert).toHaveBeenCalledWith({
      id: "evt_billing_setup",
      eventType: "checkout.session.completed",
    });
  });
});

// Restore env after the suite.
afterAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = OLD_ENV;
});
