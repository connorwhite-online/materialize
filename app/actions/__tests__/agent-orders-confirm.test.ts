/**
 * Tests for confirmAgentInitiatedOrder + mintStripeSession.
 * Covers: anon guard, wrong/expired token, status gate, concurrent-claim
 * loss, Stripe-failure sentinel rollback, no-URL rollback, and happy-path
 * line-item math (CON-144).
 *
 * Cancellation is already covered in cancel-auto-approved.test.ts.
 *
 * Mock pattern follows cancel-auto-approved.test.ts exactly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ────────────────────────────────────────────────────────────
// Shared mutable state used by the mocks below.
// Must be declared before vi.mock() calls so they are in scope
// when the (hoisted) factory functions reference them.
// ────────────────────────────────────────────────────────────

let mockUserId: string | null = "user-1";
let selectQueue: Array<unknown[]> = [];
let claimReturn: Array<{ id: string }> = [];

// All update().set() values after the first sentinel-claim call.
const capturedSets: Array<Record<string, unknown>> = [];
let updateCallCount = 0;

const stripeSessionCreateMock = vi.fn();

// ────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    id: "id",
    userId: "userId",
    status: "status",
    stripeSessionId: "stripeSessionId",
  },
  fileAssets: {
    id: "id",
    fileId: "fileId",
    originalFilename: "originalFilename",
  },
  files: { id: "id", name: "name" },
  tokenSpendingLedger: { printOrderId: "printOrderId" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // fileAssets join path
        leftJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectQueue.shift() ?? []),
          }),
        }),
        // printOrders direct path
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          // Capture happens here — NOT in .returning() — because some
          // update calls (the sentinel rollback) don't chain .returning().
          const idx = updateCallCount;
          updateCallCount++;
          if (idx > 0) {
            // All calls after the sentinel claim (rollback or swap)
            capturedSets.push(Object.assign({}, vals));
          }
          return {
            returning: () => {
              if (idx === 0) {
                // Sentinel claim
                return Promise.resolve(claimReturn);
              }
              return Promise.resolve([{ id: "order-1" }]);
            },
          };
        },
      }),
    }),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => stripeSessionCreateMock(...args),
      },
    },
  }),
}));

vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: vi.fn().mockResolvedValue(null),
  findProvider: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: () => "test-nanoid",
}));

// ────────────────────────────────────────────────────────────
// Import under test (after all mocks)
// ────────────────────────────────────────────────────────────

import { confirmAgentInitiatedOrder } from "../agent-orders";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const futureExpiry = () => new Date(Date.now() + 10 * 60_000);
const pastExpiry = () => new Date(Date.now() - 60_000);

function baseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "order-1",
    userId: "user-1",
    confirmationToken: "tok-correct",
    confirmationExpiresAt: futureExpiry(),
    status: "awaiting_agent_approval",
    stripeSessionId: null,
    shippingAddress: { email: "user@example.com" },
    fileAssetId: null,
    material: null,
    vendor: null,
    vendorName: null,
    materialSubtotal: null,
    shippingSubtotal: null,
    quantity: null,
    totalPrice: 5000,
    serviceFee: 150,
    ...overrides,
  };
}

function goodStripeSession() {
  stripeSessionCreateMock.mockResolvedValue({
    id: "cs_real",
    url: "https://checkout.stripe.com/cs_real",
  });
}

function resetState() {
  mockUserId = "user-1";
  selectQueue = [];
  claimReturn = [];
  capturedSets.length = 0;
  updateCallCount = 0;
  stripeSessionCreateMock.mockReset();
}

beforeEach(resetState);

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("confirmAgentInitiatedOrder", () => {
  it("returns error when user is not signed in", async () => {
    mockUserId = null;
    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/sign in/i);
    expect(updateCallCount).toBe(0);
  });

  it("returns error when token is wrong — no claim UPDATE fired", async () => {
    selectQueue = [[baseOrder({ confirmationToken: "tok-different" })]];
    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/invalid/i);
    expect(updateCallCount).toBe(0);
  });

  it("returns error when token is expired — no claim UPDATE fired", async () => {
    selectQueue = [[baseOrder({ confirmationExpiresAt: pastExpiry() })]];
    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/expired/i);
    expect(updateCallCount).toBe(0);
  });

  it("returns error when order status is not awaiting_agent_approval", async () => {
    selectQueue = [[baseOrder({ status: "cart_created" })]];
    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/no longer awaiting/i);
    expect(updateCallCount).toBe(0);
  });

  it("returns 'already in progress' when claim returns 0 rows (concurrent confirm)", async () => {
    selectQueue = [[baseOrder()]];
    claimReturn = [];
    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/already in progress/i);
  });

  it("rolls back sentinel when mintStripeSession throws", async () => {
    // Order row + empty fileAsset join
    selectQueue = [[baseOrder()], []];
    claimReturn = [{ id: "order-1" }];
    stripeSessionCreateMock.mockRejectedValue(new Error("Stripe is down"));

    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    expect("error" in result).toBe(true);
    // Rollback must have been called
    const rb = capturedSets.find((c) => c.stripeSessionId === null);
    expect(rb).toBeDefined();
    expect(rb?.status).toBe("awaiting_agent_approval");
  });

  it("rolls back sentinel when Stripe returns no URL", async () => {
    selectQueue = [[baseOrder()], []];
    claimReturn = [{ id: "order-1" }];
    stripeSessionCreateMock.mockResolvedValue({ id: "cs_nurl", url: null });

    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    expect("error" in result).toBe(true);
    const rb = capturedSets.find((c) => c.stripeSessionId === null);
    expect(rb).toBeDefined();
    expect(rb?.status).toBe("awaiting_agent_approval");
  });

  it("happy path: returns checkoutUrl and swaps sentinel for real session id", async () => {
    selectQueue = [[baseOrder()], []];
    claimReturn = [{ id: "order-1" }];
    goodStripeSession();

    const result = await confirmAgentInitiatedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    expect("checkoutUrl" in result).toBe(true);
    if ("checkoutUrl" in result) {
      expect(result.checkoutUrl).toBe("https://checkout.stripe.com/cs_real");
    }
    const swap = capturedSets.find(
      (c) => typeof c.stripeSessionId === "string" && c.stripeSessionId !== null
    );
    expect(swap).toBeDefined();
    expect(swap?.stripeSessionId).toBe("cs_real");
  });

  // ────────────────────────────────────────────────────────────
  // mintStripeSession line-item math
  // ────────────────────────────────────────────────────────────

  describe("mintStripeSession line-item math", () => {
    async function captureLineItems(orderOverrides: Record<string, unknown>) {
      resetState();
      selectQueue = [[baseOrder(orderOverrides)], []];
      claimReturn = [{ id: "order-1" }];
      goodStripeSession();

      await confirmAgentInitiatedOrder({
        orderId: "order-1",
        confirmationToken: "tok-correct",
      });

      const call = stripeSessionCreateMock.mock.calls[0][0] as {
        line_items: Array<{
          price_data: { unit_amount: number; product_data: { name: string } };
          quantity: number;
        }>;
      };
      return call.line_items;
    }

    it("material line × qty present when materialSubtotal + quantity are set", async () => {
      const items = await captureLineItems({
        materialSubtotal: 2000,
        shippingSubtotal: 500,
        quantity: 2,
        totalPrice: 4700,
        serviceFee: 141,
      });
      const mat = items.find((li) =>
        li.price_data.product_data.name.startsWith("3D Print")
      );
      expect(mat).toBeDefined();
      expect(mat?.price_data.unit_amount).toBe(2000);
      expect(mat?.quantity).toBe(2);
    });

    it("includes 'Vendor minimum production fee' ONLY when totalPrice - (materialSubtotal*qty + shippingSubtotal) > 0", async () => {
      const withFee = await captureLineItems({
        materialSubtotal: 2000,
        shippingSubtotal: 500,
        quantity: 2,
        totalPrice: 5000,
        serviceFee: 150,
      });
      expect(
        withFee.some(
          (li) =>
            li.price_data.product_data.name === "Vendor minimum production fee"
        )
      ).toBe(true);

      const withoutFee = await captureLineItems({
        materialSubtotal: 2000,
        shippingSubtotal: 500,
        quantity: 2,
        totalPrice: 4500,
        serviceFee: 135,
      });
      expect(
        withoutFee.some(
          (li) =>
            li.price_data.product_data.name === "Vendor minimum production fee"
        )
      ).toBe(false);
    });

    it("includes shipping line only when shippingSubtotal > 0", async () => {
      const withShipping = await captureLineItems({
        materialSubtotal: 2000,
        shippingSubtotal: 500,
        quantity: 1,
        totalPrice: 2500,
        serviceFee: 75,
      });
      expect(
        withShipping.some((li) => li.price_data.product_data.name === "Shipping")
      ).toBe(true);

      const noShipping = await captureLineItems({
        materialSubtotal: 2000,
        shippingSubtotal: 0,
        quantity: 1,
        totalPrice: 2000,
        serviceFee: 60,
      });
      expect(
        noShipping.some((li) => li.price_data.product_data.name === "Shipping")
      ).toBe(false);
    });

    it("always includes a service fee line with the correct amount", async () => {
      const items = await captureLineItems({
        materialSubtotal: 3000,
        shippingSubtotal: 400,
        quantity: 1,
        totalPrice: 3400,
        serviceFee: 102,
      });
      const fee = items.find(
        (li) => li.price_data.product_data.name === "Service fee"
      );
      expect(fee).toBeDefined();
      expect(fee?.price_data.unit_amount).toBe(102);
    });

    it("falls back to a single totalPrice line when materialSubtotal/quantity are null", async () => {
      const items = await captureLineItems({
        materialSubtotal: null,
        shippingSubtotal: null,
        quantity: null,
        totalPrice: 5000,
        serviceFee: 150,
      });
      const printLine = items.find((li) =>
        li.price_data.product_data.name.startsWith("3D Print")
      );
      expect(printLine?.price_data.unit_amount).toBe(5000);
      expect(printLine?.quantity).toBe(1);
      expect(
        items.some((li) => li.price_data.product_data.name === "Shipping")
      ).toBe(false);
      expect(
        items.some(
          (li) =>
            li.price_data.product_data.name === "Vendor minimum production fee"
        )
      ).toBe(false);
    });
  });
});
