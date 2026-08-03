/**
 * Tests for createAgentInitiatedOrder — the heart of the Phase 1
 * agent-billing flow. Each branch is the difference between
 * "user gets charged" and "user gets an email," so it pays to
 * cover them explicitly.
 *
 * Mocking strategy:
 *   - @/lib/db: hand-written select/insert/update chains. Each
 *     query is dispatched to a fixture defined per-test.
 *   - @/lib/craftcloud/client: createCart returns a fixed cart id.
 *   - @/lib/billing/policy: evaluateSpendingPolicy is mocked so we
 *     control approve vs reject without recomputing budget.
 *   - @/lib/stripe: getStripe returns a Stripe-shaped object with
 *     a controllable paymentIntents.create.
 *
 * The DB mock matches on the FIRST table passed to .from(), so each
 * test's fixture is keyed by table identity. New queries added to
 * createAgentInitiatedOrder will need a corresponding fixture entry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// ─── Fixtures ────────────────────────────────────────────────────

interface DBFixture {
  /** select chain results, keyed by table identity */
  selectByTable: Map<unknown, unknown[]>;
  /** insert results — printOrders insert returns a synthetic id */
  insertPrintOrderResult: Array<{ id: string }>;
  /** update calls captured for assertion */
  updatePrintOrdersCalls: Array<{ set: Record<string, unknown> }>;
  /** insert calls into tokenSpendingLedger */
  ledgerInserts: Array<Record<string, unknown>>;
  /** insert calls into printOrders */
  printOrderInserts: Array<Record<string, unknown>>;
}

let dbFixture: DBFixture;

// Module-level table sentinels — the schema mock returns these so
// we can dispatch select/insert/update by reference.
const PRINT_ORDERS = { __table: "print_orders" };
const FILE_ASSETS = { __table: "file_assets" };
const FILES = { __table: "files" };
const PERSONAL_ACCESS_TOKENS = { __table: "personal_access_tokens" };
const USERS = { __table: "users" };
const TOKEN_SPENDING_LEDGER = { __table: "token_spending_ledger" };
const PRINT_ORDER_ITEMS = { __table: "print_order_items" };

vi.mock("@/lib/db/schema", () => ({
  printOrders: PRINT_ORDERS,
  fileAssets: FILE_ASSETS,
  files: FILES,
  personalAccessTokens: PERSONAL_ACCESS_TOKENS,
  users: USERS,
  tokenSpendingLedger: TOKEN_SPENDING_LEDGER,
  printOrderItems: PRINT_ORDER_ITEMS,
}));

vi.mock("@/lib/db", () => {
  const handleChain = (table: unknown) => {
    const result = dbFixture.selectByTable.get(table) ?? [];
    return {
      where: () =>
        Object.assign(Promise.resolve(result), {
          limit: () => Promise.resolve(result),
        }),
      innerJoin: () => ({
        where: () =>
          Object.assign(Promise.resolve(result), {
            limit: () => Promise.resolve(result),
          }),
      }),
    };
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => handleChain(table) }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === TOKEN_SPENDING_LEDGER) {
            dbFixture.ledgerInserts.push(v);
            return Promise.resolve();
          }
          if (table === PRINT_ORDERS) {
            dbFixture.printOrderInserts.push(v);
            return {
              returning: () =>
                Promise.resolve(dbFixture.insertPrintOrderResult),
            };
          }
          return { returning: () => Promise.resolve([]) };
        },
      }),
      update: (table: unknown) => ({
        set: (s: Record<string, unknown>) => {
          if (table === PRINT_ORDERS) {
            dbFixture.updatePrintOrdersCalls.push({ set: s });
          }
          return { where: () => Promise.resolve() };
        },
      }),
    },
  };
});

const createCartMock = vi.fn();
// MTR-130: getPrice(priceId) is the source of truth
// createAgentInitiatedOrder reconciles the agent-supplied
// materialPriceCents against. Defaults to a quote matching baseInput
// (quoteId "quote-1", $45.00 = 4500 cents) so the existing suite's
// calls reconcile cleanly without per-test setup.
const getPriceMock = vi.fn((..._args: unknown[]) =>
  Promise.resolve({
    priceId: "price-1",
    allComplete: true,
    quotes: [{ quoteId: "quote-1", price: 45, currency: "USD" }],
    shipping: [],
  })
);
vi.mock("@/lib/craftcloud/client", () => ({
  createCart: (...args: unknown[]) => createCartMock(...args),
  getPrice: (...args: unknown[]) => getPriceMock(...args),
  CraftCloudApiError: class CraftCloudApiError extends Error {
    status: number;
    body: string;
    constructor(status = 500, body = "") {
      super(`mock error ${status}`);
      this.status = status;
      this.body = body;
    }
    isQuoteExpired() {
      if (this.status !== 400 && this.status !== 404) return false;
      return this.body.toLowerCase().includes("quote");
    }
  },
}));

vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: vi.fn(),
  findProvider: vi.fn(),
}));

const evaluateMock = vi.fn();
vi.mock("@/lib/billing/policy", () => ({
  evaluateSpendingPolicy: (...args: unknown[]) => evaluateMock(...args),
}));

const paymentIntentsCreateMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    paymentIntents: {
      create: (...args: unknown[]) => paymentIntentsCreateMock(...args),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────

function resetFixture(): DBFixture {
  return {
    selectByTable: new Map([
      [PRINT_ORDERS, []],
      [FILE_ASSETS, [{ assetId: "asset-1", ownerId: "user-1" }]],
      [PERSONAL_ACCESS_TOKENS, [{ spendingPolicy: null }]],
      [USERS, [{ stripeCustomerId: null, defaultPaymentMethod: null }]],
    ]),
    insertPrintOrderResult: [{ id: "order-new-1" }],
    updatePrintOrdersCalls: [],
    ledgerInserts: [],
    printOrderInserts: [],
  };
}

const baseInput = {
  userId: "user-1",
  initiatedByTokenId: "tok-1",
  agentName: "Test Agent",
  idempotencyKey: "idempotency-key-1",
  fileAssetId: "asset-1",
  priceId: "price-1",
  quoteId: "quote-1",
  vendorId: "vendor-1",
  vendorName: "Test Vendor",
  materialConfigId: "mat-config-1",
  shippingId: "ship-1",
  quantity: 1,
  materialPriceCents: 4500,
  shippingPriceCents: 500,
  currency: "USD" as const,
  shippingAddress: {
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    address: "1 Test St",
    city: "Testville",
    zipCode: "00000",
    countryCode: "US",
  },
};

beforeEach(() => {
  dbFixture = resetFixture();
  createCartMock.mockReset();
  createCartMock.mockResolvedValue({
    cartId: "cart-abc",
    minimumProductionPrice: { "vendor-1": { productionFee: 0 } },
  });
  getPriceMock.mockReset();
  getPriceMock.mockResolvedValue({
    priceId: "price-1",
    allComplete: true,
    quotes: [{ quoteId: "quote-1", price: 45, currency: "USD" }],
    shipping: [],
  });
  evaluateMock.mockReset();
  paymentIntentsCreateMock.mockReset();
  delete process.env.MATERIALIZE_AGENT_BILLING_ENABLED;
});

// ─── Tests ────────────────────────────────────────────────────────

describe("createAgentInitiatedOrder — feature flag off (default)", () => {
  it("falls through to email-confirm with no charge attempt", async () => {
    evaluateMock.mockResolvedValue({
      approved: false,
      reason: "No spending policy configured for this token",
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.path).toBe("awaiting_user_approval");
    // Reason is suppressed when the feature flag is off — would
    // otherwise leak misleading "no policy" noise to the agent.
    expect(result.fallbackReason).toBeUndefined();
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
    expect(dbFixture.ledgerInserts).toHaveLength(0);
  });
});

describe("createAgentInitiatedOrder — feature flag on", () => {
  beforeEach(() => {
    process.env.MATERIALIZE_AGENT_BILLING_ENABLED = "true";
  });

  it("auto-approves when policy passes and charge succeeds", async () => {
    dbFixture.selectByTable.set(USERS, [
      {
        stripeCustomerId: "cus_test",
        defaultPaymentMethod: "pm_test",
      },
    ]);
    dbFixture.selectByTable.set(PERSONAL_ACCESS_TOKENS, [
      {
        spendingPolicy: {
          perOrderLimitCents: 10000,
          periodBudgetCents: 50000,
          periodWindow: "month",
        },
      },
    ]);
    evaluateMock.mockResolvedValue({
      approved: true,
      cancellationWindowMinutes: 5,
      remainingPeriodBudgetCents: 45000,
    });
    paymentIntentsCreateMock.mockResolvedValue({
      id: "pi_test",
      status: "succeeded",
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.path).toBe("auto_approved");
    expect(result.cancellationDeadline).toBeTruthy();
    expect(result.remainingPeriodBudgetCents).toBe(45000);
    expect(result.fallbackReason).toBeUndefined();

    // PaymentIntent created with off-session params
    expect(paymentIntentsCreateMock).toHaveBeenCalledOnce();
    const piArgs = paymentIntentsCreateMock.mock.calls[0][0];
    expect(piArgs.off_session).toBe(true);
    expect(piArgs.confirm).toBe(true);
    expect(piArgs.customer).toBe("cus_test");
    expect(piArgs.payment_method).toBe("pm_test");
    expect(piArgs.metadata.printOrderId).toBe("order-new-1");
    expect(piArgs.metadata.token_id).toBe("tok-1");

    // Order promoted + ledger row written
    expect(dbFixture.updatePrintOrdersCalls).toHaveLength(1);
    expect(dbFixture.updatePrintOrdersCalls[0].set.status).toBe(
      "auto_approved"
    );
    expect(dbFixture.updatePrintOrdersCalls[0].set.stripeSessionId).toBe(
      "pi_test"
    );
    expect(dbFixture.ledgerInserts).toHaveLength(1);
    expect(dbFixture.ledgerInserts[0]).toMatchObject({
      tokenId: "tok-1",
      printOrderId: "order-new-1",
    });
  });

  it("falls through with the policy reason when policy rejects", async () => {
    evaluateMock.mockResolvedValue({
      approved: false,
      reason: "Exceeds per-order limit ($50.00 cap, this order $87.30)",
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.path).toBe("awaiting_user_approval");
    expect(result.fallbackReason).toContain("per-order limit");
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
    expect(dbFixture.ledgerInserts).toHaveLength(0);
  });

  it("falls through when Stripe declines the card", async () => {
    dbFixture.selectByTable.set(USERS, [
      { stripeCustomerId: "cus_test", defaultPaymentMethod: "pm_test" },
    ]);
    evaluateMock.mockResolvedValue({
      approved: true,
      cancellationWindowMinutes: 5,
      remainingPeriodBudgetCents: 45000,
    });
    paymentIntentsCreateMock.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        type: "StripeCardError",
        message: "Your card was declined.",
        code: "card_declined",
      } as never)
    );

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.path).toBe("awaiting_user_approval");
    expect(result.fallbackReason).toMatch(/declined/i);
    // Order row inserted in the email-confirm shape; no promotion,
    // no ledger entry.
    expect(dbFixture.updatePrintOrdersCalls).toHaveLength(0);
    expect(dbFixture.ledgerInserts).toHaveLength(0);
  });

  it("falls through when 3DS authentication is required", async () => {
    dbFixture.selectByTable.set(USERS, [
      { stripeCustomerId: "cus_test", defaultPaymentMethod: "pm_test" },
    ]);
    evaluateMock.mockResolvedValue({
      approved: true,
      cancellationWindowMinutes: 5,
      remainingPeriodBudgetCents: 45000,
    });
    paymentIntentsCreateMock.mockResolvedValue({
      id: "pi_3ds",
      status: "requires_action",
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.path).toBe("awaiting_user_approval");
    expect(result.fallbackReason).toMatch(/authentication|3-?D Secure/i);
    expect(dbFixture.updatePrintOrdersCalls).toHaveLength(0);
  });

  it("does not attempt charge when the user has no payment method", async () => {
    // billingRow has no defaultPaymentMethod — evaluator should reject
    // with "no payment method," regardless of policy specifics.
    evaluateMock.mockResolvedValue({
      approved: false,
      reason:
        "No payment method on file. Add a card in settings to enable auto-approval.",
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.path).toBe("awaiting_user_approval");
    expect(result.fallbackReason).toMatch(/payment method/i);
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("replays the existing order on idempotency-key reuse (awaiting_agent_approval)", async () => {
    dbFixture.selectByTable.set(PRINT_ORDERS, [
      {
        id: "existing-order-1",
        confirmationToken: "token-abc",
        confirmationExpiresAt: new Date(Date.now() + 60_000),
        autoApprovedUntil: null,
        totalPrice: 5000,
        serviceFee: 150,
        status: "awaiting_agent_approval",
      },
    ]);

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.orderId).toBe("existing-order-1");
    expect(result.path).toBe("awaiting_user_approval");
    expect(result.confirmationToken).toBe("token-abc");
    // No new cart / charge / DB insert when replaying
    expect(createCartMock).not.toHaveBeenCalled();
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
    expect(dbFixture.printOrderInserts).toHaveLength(0);
  });

  it("replays an auto_approved order that's still inside its cancel window", async () => {
    const futureWindow = new Date(Date.now() + 4 * 60_000);
    dbFixture.selectByTable.set(PRINT_ORDERS, [
      {
        id: "auto-order-1",
        confirmationToken: "tok-xyz",
        confirmationExpiresAt: new Date(Date.now() + 60_000),
        autoApprovedUntil: futureWindow,
        totalPrice: 5000,
        serviceFee: 150,
        status: "auto_approved",
      },
    ]);

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.orderId).toBe("auto-order-1");
    expect(result.path).toBe("auto_approved");
    expect(result.cancellationDeadline).toBe(futureWindow.toISOString());
  });

  it("rejects idempotency replay once the original order has started fulfillment", async () => {
    dbFixture.selectByTable.set(PRINT_ORDERS, [
      {
        id: "order-placed-1",
        confirmationToken: "tok-old",
        confirmationExpiresAt: new Date(Date.now() + 60_000),
        autoApprovedUntil: new Date(Date.now() - 60_000), // window passed
        totalPrice: 5000,
        serviceFee: 150,
        status: "auto_approved",
      },
    ]);

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/started fulfillment/i);
    }
  });

  it("rejects with a clear error when the file does not belong to the user", async () => {
    dbFixture.selectByTable.set(FILE_ASSETS, [
      { assetId: "asset-1", ownerId: "another-user" },
    ]);
    evaluateMock.mockResolvedValue({
      approved: false,
      reason: "irrelevant",
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/forbidden/i);
    }
    // Should fail before cart creation, charge, or order insert.
    expect(createCartMock).not.toHaveBeenCalled();
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
    expect(dbFixture.printOrderInserts).toHaveLength(0);
  });
});

// MTR-130 — this is the highest-risk path for a tampered price: an
// off-session auto-charge with no human present to notice a mismatched
// total. The agent-supplied materialPriceCents must be re-derived from
// CraftCloud (getPrice(priceId)) rather than trusted.
describe("createAgentInitiatedOrder — MTR-130 price reconciliation", () => {
  it("rejects a tampered (too-low) materialPriceCents instead of trusting the agent's request", async () => {
    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder({
      ...baseInput,
      materialPriceCents: 100, // authoritative quote is 4500
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/pricing has changed|re-run/i);
    }
    // Must bail BEFORE reserving a CraftCloud cart for the tampered order.
    expect(createCartMock).not.toHaveBeenCalled();
    expect(dbFixture.printOrderInserts).toHaveLength(0);
  });

  it("accepts a materialPriceCents that matches CraftCloud's quote and persists the reconciled value", async () => {
    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(createCartMock).toHaveBeenCalled();
    expect(dbFixture.printOrderInserts).toHaveLength(1);
    expect(dbFixture.printOrderInserts[0]).toMatchObject({
      materialSubtotal: 4500,
    });
  });

  it("quoteId absent from CraftCloud's price response surfaces a clear re-quote error", async () => {
    getPriceMock.mockResolvedValueOnce({
      priceId: "price-1",
      allComplete: true,
      quotes: [{ quoteId: "some-other-quote", price: 45, currency: "USD" }],
      shipping: [],
    });

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/expired|re-run/i);
    }
    expect(createCartMock).not.toHaveBeenCalled();
  });

  it("an expired priceId (CraftCloudApiError) surfaces the same actionable re-quote error", async () => {
    const { CraftCloudApiError } = (await import(
      "@/lib/craftcloud/client"
    )) as unknown as {
      CraftCloudApiError: new (status: number, body: string) => Error;
    };
    getPriceMock.mockRejectedValueOnce(
      new CraftCloudApiError(404, "Quote not found or expired")
    );

    const { createAgentInitiatedOrder } = await import("../orders");
    const result = await createAgentInitiatedOrder(baseInput);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/expired|re-run/i);
    }
    expect(createCartMock).not.toHaveBeenCalled();
  });
});
