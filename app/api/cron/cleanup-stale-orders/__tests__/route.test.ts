import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let updateReturns: Array<{ id: string }> = [];
const updateSet = vi.fn();
const updateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
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
    createdAt: "created_at",
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
    updateReturns = [];
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

  it("cancels stale cart_created orders and reports the count", async () => {
    updateReturns = [
      { id: "order-1" },
      { id: "order-2" },
      { id: "order-3" },
    ];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(3);
    expect(updateSet).toHaveBeenCalledWith({ status: "cancelled" });
  });

  it("returns 0 when nothing is stale", async () => {
    updateReturns = [];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(0);
  });
});
