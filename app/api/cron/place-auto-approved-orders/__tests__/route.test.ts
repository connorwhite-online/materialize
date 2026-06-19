/**
 * Tests for the auto-approved-orders placement cron.
 *
 * Two safety properties matter:
 *   1. Auth: refuses any request without the matching CRON_SECRET.
 *   2. Atomic claim: the UPDATE WHERE clause restricts to status
 *      = 'auto_approved' AND autoApprovedUntil <= now, so:
 *        - rows still inside their cancel window aren't claimed,
 *        - rows another invocation already claimed don't double-fire.
 *   3. CON-159: Stuck charged rows (cart_created + pi_ stripeSessionId
 *      + null craftCloudOrderId) are retried, not silently abandoned.
 *
 *   Plus: handler errors are reported but don't poison the rest of
 *   the batch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const handlerMock = vi.fn();
// Phase-1 claim (auto_approved → cart_created)
let claimReturn: Array<{ id: string }> = [];
// Phase-2 stuck rows (SELECT from cart_created where pi_ + no cc order)
let stuckSelectReturn: Array<{ id: string }> = [];

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    status: "status",
    autoApprovedUntil: "auto_approved_until",
    stripeSessionId: "stripe_session_id",
    craftCloudOrderId: "craft_cloud_order_id",
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
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(stuckSelectReturn),
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
  // The sweep is gated behind the agent-billing kill switch; enable it
  // so the placement-logic tests below exercise the DB path. The
  // "skips when disabled" test clears it explicitly.
  process.env.MATERIALIZE_AGENT_BILLING_ENABLED = "true";
  claimReturn = [];
  stuckSelectReturn = [];
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

  it("skips (no DB touch) when agent billing is disabled", async () => {
    delete process.env.MATERIALIZE_AGENT_BILLING_ENABLED;
    // If the guard didn't short-circuit, the handler would be reachable
    // for any claimed row — assert it's never called and the body marks
    // the skip. This is the cost guard: no DB query on a per-invocation
    // basis when the experimental feature is off.
    claimReturn = [{ id: "would-place" }];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ skipped: "agent billing disabled" });
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("returns 200 with zero work when no rows are due", async () => {
    claimReturn = [];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ claimed: 0, placed: 0, failed: 0 });
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("places each claimed order and reports the count", async () => {
    claimReturn = [{ id: "order-1" }, { id: "order-2" }];
    handlerMock.mockResolvedValue(undefined);

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ claimed: 2, placed: 2, failed: 0 });
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
    expect(body).toEqual({
      claimed: 3,
      freshClaimed: 3,
      retriedStuck: 0,
      placed: 2,
      failed: 1,
    });
    // The other two orders still got placed — one bad row doesn't
    // poison the batch.
    expect(handlerMock).toHaveBeenCalledTimes(3);
  });

  it("CON-159: retries stuck cart_created rows with pi_ stripeSessionId", async () => {
    // A previous run's handler threw after placement, leaving a charged
    // row in cart_created with a pi_ id and no craftCloudOrderId.
    stuckSelectReturn = [{ id: "stuck-1" }];
    handlerMock.mockResolvedValue(undefined);

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retriedStuck).toBe(1);
    expect(body.claimed).toBe(1); // 0 fresh + 1 stuck
    expect(handlerMock).toHaveBeenCalledWith("stuck-1");
  });

  it("CON-159: deduplicates when a row appears in both fresh and stuck lists", async () => {
    // A row just transitioned auto_approved → cart_created (fresh) also
    // matches the stuck WHERE. It should only be processed once.
    claimReturn = [{ id: "order-1" }];
    stuckSelectReturn = [{ id: "order-1" }];
    handlerMock.mockResolvedValue(undefined);

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();
    expect(body.claimed).toBe(1);
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(body.retriedStuck).toBe(0); // deduplicated
  });
});
