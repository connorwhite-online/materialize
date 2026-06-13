/**
 * Tests for GET /api/cron/retry-failed-refunds (CON-146).
 *
 * Auth pattern mirrors place-auto-approved-orders route tests.
 * Also adds minimal logic coverage since this route has zero tests anywhere.
 *
 * Logic under test (route.ts):
 *   - Fetches printOrders where refundFailedAt IS NOT NULL
 *   - For each:
 *       - No stripeSessionId → logs + clears refundFailedAt, continues
 *       - stripe.refunds.create succeeds → clears refundFailedAt, recovered++
 *       - stripe.refunds.create fails → stillFailing++
 *   - Returns { scanned, recovered, stillFailing }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── per-test state ─────────────────────────────────────────

let stuckOrders: Array<{
  id: string;
  stripeSessionId: string | null;
  refundFailedAt: Date | null;
}> = [];

const refundCreateMock = vi.fn();

// Track db.update calls so we can verify refundFailedAt is cleared
const updateSetCalls: unknown[] = [];

// ─── mocks ──────────────────────────────────────────────────

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    id: "id",
    stripeSessionId: "stripe_session_id",
    refundFailedAt: "refund_failed_at",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(stuckOrders),
      }),
    }),
    update: () => ({
      set: (vals: unknown) => {
        updateSetCalls.push(vals);
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    refunds: {
      create: (...args: unknown[]) => refundCreateMock(...args),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// ─── import under test ──────────────────────────────────────

import { GET } from "../route";

// ─── helpers ────────────────────────────────────────────────

function makeRequest(authHeader: string | null) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/retry-failed-refunds", {
    headers,
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  stuckOrders = [];
  updateSetCalls.length = 0;
  refundCreateMock.mockReset();
  refundCreateMock.mockResolvedValue({ id: "re_test" });
});

// ─── auth gate ───────────────────────────────────────────────

describe("retry-failed-refunds cron — auth gate", () => {
  it("401s with no authorization header", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
  });

  it("401s with wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("500s when CRON_SECRET is not configured (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
  });

  it("200 with correct secret and empty queue", async () => {
    stuckOrders = [];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ scanned: 0, recovered: 0, stillFailing: 0 });
    expect(refundCreateMock).not.toHaveBeenCalled();
  });
});

// ─── logic coverage ──────────────────────────────────────────

describe("retry-failed-refunds cron — sweep logic", () => {
  it("happy path: refund succeeds, clears refundFailedAt, increments recovered", async () => {
    stuckOrders = [
      {
        id: "order-1",
        stripeSessionId: "pi_test123",
        refundFailedAt: new Date(Date.now() - 60_000),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ scanned: 1, recovered: 1, stillFailing: 0 });

    // Stripe refund must have been called with the same idempotency key
    expect(refundCreateMock).toHaveBeenCalledOnce();
    expect(refundCreateMock.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_test123",
      reason: "requested_by_customer",
    });
    expect(refundCreateMock.mock.calls[0][1]).toMatchObject({
      idempotencyKey: "agent-cancel-refund:order-1",
    });

    // refundFailedAt should have been cleared
    expect(updateSetCalls).toHaveLength(1);
    expect((updateSetCalls[0] as Record<string, unknown>).refundFailedAt).toBeNull();
  });

  it("failure path: Stripe throws, increments stillFailing (does not clear flag)", async () => {
    stuckOrders = [
      {
        id: "order-bad",
        stripeSessionId: "pi_failing",
        refundFailedAt: new Date(Date.now() - 60_000),
      },
    ];
    refundCreateMock.mockRejectedValue(new Error("Stripe unavailable"));

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ scanned: 1, recovered: 0, stillFailing: 1 });

    // refundFailedAt must NOT have been cleared on failure
    expect(updateSetCalls).toHaveLength(0);
  });

  it("order with no stripeSessionId: clears flag and logs, does not call stripe", async () => {
    stuckOrders = [
      {
        id: "order-nopi",
        stripeSessionId: null,
        refundFailedAt: new Date(Date.now() - 60_000),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    // No Stripe call — nothing to refund automatically
    expect(refundCreateMock).not.toHaveBeenCalled();
    // Flag should be cleared via db.update
    expect(updateSetCalls).toHaveLength(1);
    expect((updateSetCalls[0] as Record<string, unknown>).refundFailedAt).toBeNull();
  });

  it("mixed batch: one success + one failure → recovered=1 stillFailing=1", async () => {
    stuckOrders = [
      {
        id: "order-ok",
        stripeSessionId: "pi_ok",
        refundFailedAt: new Date(Date.now() - 60_000),
      },
      {
        id: "order-fail",
        stripeSessionId: "pi_fail",
        refundFailedAt: new Date(Date.now() - 60_000),
      },
    ];
    refundCreateMock.mockImplementation(
      async (params: { payment_intent: string }) => {
        if (params.payment_intent === "pi_fail")
          throw new Error("network error");
        return { id: "re_ok" };
      }
    );

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ scanned: 2, recovered: 1, stillFailing: 1 });
  });
});
