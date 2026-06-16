import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock state:
 *   staleOrderRows   — rows the stale-orders SELECT returns
 *   cartDeleteReturns   — rows the cart_items DELETE.returning() yields
 *   webhookDeleteReturns — rows the webhook_events DELETE.returning() yields
 *   throwOnDelete    — if set, deleting from that table name throws
 *   throwOnSelect    — if true, the stale-order SELECT throws
 *   mockRefundCreate — spy on stripe.refunds.create
 */
let staleOrderRows: Array<{ id: string; stripeSessionId: string | null }> = [];
let cartDeleteReturns: Array<{ id: string }> = [];
let webhookDeleteReturns: Array<{ id: string }> = [];
let throwOnDelete: string | null = null;
let throwOnSelect = false;

const updateCalls: Array<{ id: string; status: string; refundFailedAt?: Date | null }> = [];
const mockRefundCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          if (throwOnSelect) throw new Error("select error");
          return Promise.resolve(staleOrderRows);
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          // Record the update call for assertions.
          // The WHERE contains the order id — we infer it from context
          // by matching against what was passed in set().
          updateCalls.push(values as { id: string; status: string; refundFailedAt?: Date | null });
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: { __name?: string }) => ({
      where: () => {
        if (table?.__name === throwOnDelete) {
          throw new Error(`mock error for ${table?.__name}`);
        }
        const promise: Promise<void> & {
          returning: () => Array<{ id: string }>;
        } = Promise.resolve() as Promise<void> & {
          returning: () => Array<{ id: string }>;
        };
        promise.returning = () =>
          table?.__name === "cartItems"
            ? cartDeleteReturns
            : webhookDeleteReturns;
        return promise;
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    __name: "printOrders",
    id: "id",
    status: "status",
    createdAt: "created_at",
    stripeSessionId: "stripe_session_id",
    refundFailedAt: "refund_failed_at",
  },
  cartItems: {
    __name: "cartItems",
    id: "id",
    updatedAt: "updated_at",
  },
  webhookEventsProcessed: {
    __name: "webhookEventsProcessed",
    id: "id",
    processedAt: "processed_at",
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    refunds: {
      create: (...args: unknown[]) => mockRefundCreate(...args),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { GET } from "../route";
import { logError } from "@/lib/logger";

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/cleanup-stale-orders", {
    headers,
  });
}

describe("cron/cleanup-stale-orders", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    staleOrderRows = [];
    cartDeleteReturns = [];
    webhookDeleteReturns = [];
    throwOnDelete = null;
    throwOnSelect = false;
    updateCalls.length = 0;
    mockRefundCreate.mockResolvedValue({ id: "re_1" });
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong token", async () => {
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("refuses to run when CRON_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
  });

  it("runs all three sweeps and reports per-task counts", async () => {
    staleOrderRows = [{ id: "order-1", stripeSessionId: null }, { id: "order-2", stripeSessionId: null }];
    cartDeleteReturns = [{ id: "cart-1" }, { id: "cart-2" }, { id: "cart-3" }];
    webhookDeleteReturns = [{ id: "evt-1" }];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(2);
    expect(body.deletedCartItems).toBe(3);
    expect(body.prunedWebhookEvents).toBe(1);
    expect(body.cutoffs).toMatchObject({
      orders: expect.any(String),
      cartItems: expect.any(String),
      webhookEvents: expect.any(String),
    });
    // Each order got a cancel update with no refundFailedAt
    const cancelledStatuses = updateCalls.filter((c) => c.status === "cancelled");
    expect(cancelledStatuses).toHaveLength(2);
  });

  it("returns 0 across the board when nothing is stale", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(0);
    expect(body.deletedCartItems).toBe(0);
    expect(body.prunedWebhookEvents).toBe(0);
  });

  it("returns 500 with per-op results when cart delete fails (CON-137)", async () => {
    staleOrderRows = [{ id: "order-1", stripeSessionId: null }];
    webhookDeleteReturns = [{ id: "evt-1" }];
    throwOnDelete = "cartItems";

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(1);
    expect(body.deletedCartItems).toBe("error");
    expect(body.prunedWebhookEvents).toBe(1);
  });

  it("CON-159: issues a refund before cancelling a charged (pi_) row", async () => {
    staleOrderRows = [{ id: "order-pi", stripeSessionId: "pi_charged_123" }];

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(1);

    // Refund was issued with the PI id and idempotency key
    expect(mockRefundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_charged_123" }),
      expect.objectContaining({ idempotencyKey: "agent-cancel-refund:order-pi" })
    );

    // Row was cancelled
    const cancelledCall = updateCalls.find((c) => c.status === "cancelled");
    expect(cancelledCall).toBeDefined();
    // No refundFailedAt on success
    expect(cancelledCall?.refundFailedAt).toBeFalsy();
  });

  it("CON-159: sets refundFailedAt when the refund fails and still cancels the row", async () => {
    staleOrderRows = [{ id: "order-pi", stripeSessionId: "pi_charged_123" }];
    mockRefundCreate.mockRejectedValueOnce(new Error("stripe is down"));

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(1);

    // Row still cancelled
    const cancelledCall = updateCalls.find((c) => c.status === "cancelled");
    expect(cancelledCall).toBeDefined();
    // refundFailedAt is set so retry-failed-refunds can pick it up
    expect(cancelledCall?.refundFailedAt).toBeInstanceOf(Date);

    // Error was logged
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-stale-orders.refundCharged",
      expect.any(Error)
    );
  });

  it("CON-159: non-charged rows (null stripeSessionId) are cancelled without a refund call", async () => {
    staleOrderRows = [{ id: "order-uncharged", stripeSessionId: null }];

    await GET(makeRequest("Bearer test-secret"));

    expect(mockRefundCreate).not.toHaveBeenCalled();
    const cancelledCall = updateCalls.find((c) => c.status === "cancelled");
    expect(cancelledCall).toBeDefined();
    expect(cancelledCall?.refundFailedAt).toBeUndefined();
  });
});
