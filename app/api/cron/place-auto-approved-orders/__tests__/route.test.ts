/**
 * Tests for the auto-approved-orders placement cron.
 *
 * Two safety properties matter:
 *   1. Auth: refuses any request without the matching CRON_SECRET.
 *   2. Atomic claim: the UPDATE WHERE clause restricts to status
 *      = 'auto_approved' AND autoApprovedUntil <= now, so:
 *        - rows still inside their cancel window aren't claimed,
 *        - rows another invocation already claimed don't double-fire.
 *
 *   Plus: handler errors are reported but don't poison the rest of
 *   the batch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const handlerMock = vi.fn();
let claimReturn: Array<{ id: string }> = [];

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    status: "status",
    autoApprovedUntil: "auto_approved_until",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(claimReturn),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/stripe/handle-print-order-payment", () => ({
  handlePrintOrderPayment: (...args: unknown[]) => handlerMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { GET } from "../route";

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  claimReturn = [];
  handlerMock.mockReset();
});

function makeRequest(authHeader: string | null) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/place-auto-approved-orders", {
    headers,
  });
}

describe("place-auto-approved-orders cron", () => {
  it("401s without the bearer token", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
  });

  it("401s with the wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer not-the-secret"));
    expect(res.status).toBe(401);
  });

  it("500s when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
  });

  it("returns 200 with zero work when no rows are due", async () => {
    claimReturn = [];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ claimed: 0, placed: 0, failed: 0 });
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("places each claimed order and reports the count", async () => {
    claimReturn = [{ id: "order-1" }, { id: "order-2" }];
    handlerMock.mockResolvedValue(undefined);

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ claimed: 2, placed: 2, failed: 0 });
    expect(handlerMock).toHaveBeenCalledTimes(2);
    expect(handlerMock).toHaveBeenCalledWith("order-1");
    expect(handlerMock).toHaveBeenCalledWith("order-2");
  });

  it("isolates handler failures and returns 500 with a per-row tally", async () => {
    claimReturn = [{ id: "ok-1" }, { id: "fail-1" }, { id: "ok-2" }];
    handlerMock.mockImplementation(async (id: string) => {
      if (id === "fail-1") throw new Error("CraftCloud is down");
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ claimed: 3, placed: 2, failed: 1 });
    // The other two orders still got placed — one bad row doesn't
    // poison the batch.
    expect(handlerMock).toHaveBeenCalledTimes(3);
  });
});
