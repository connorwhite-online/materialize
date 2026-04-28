import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-test return shapes for the three sweep statements. Each one
// runs independently in the route's Promise.all, so the mock has to
// disambiguate by the table being targeted.
let orderUpdateReturns: Array<{ id: string }> = [];
let cartDeleteReturns: Array<{ id: string }> = [];
let webhookDeleteReturns: Array<{ id: string }> = [];
const updateSet = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    update: (table: { __name?: string }) => ({
      set: (values: unknown) => {
        updateSet({ table: table?.__name, values });
        return {
          where: () => {
            const promise: Promise<void> & {
              returning: () => Array<{ id: string }>;
            } = Promise.resolve() as Promise<void> & {
              returning: () => Array<{ id: string }>;
            };
            promise.returning = () => orderUpdateReturns;
            return promise;
          },
        };
      },
    }),
    delete: (table: { __name?: string }) => ({
      where: () => {
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

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { GET } from "../route";

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
    orderUpdateReturns = [];
    cartDeleteReturns = [];
    webhookDeleteReturns = [];
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong token", async () => {
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("runs all three sweeps and reports per-task counts", async () => {
    orderUpdateReturns = [{ id: "order-1" }, { id: "order-2" }];
    cartDeleteReturns = [
      { id: "cart-1" },
      { id: "cart-2" },
      { id: "cart-3" },
    ];
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
    expect(updateSet).toHaveBeenCalledWith({
      table: "printOrders",
      values: { status: "cancelled" },
    });
  });

  it("returns 0 across the board when nothing is stale", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(0);
    expect(body.deletedCartItems).toBe(0);
    expect(body.prunedWebhookEvents).toBe(0);
  });
});
