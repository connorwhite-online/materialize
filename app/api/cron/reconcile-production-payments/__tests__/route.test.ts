/**
 * Tests for GET /api/cron/reconcile-production-payments (CON-146).
 *
 * Auth pattern mirrors place-auto-approved-orders/__tests__/route.test.ts:
 *   - 401 on no/wrong Bearer header (sweep NOT called)
 *   - 500 when CRON_SECRET is unset (fail-closed)
 *   - 200 and sweep called once on correct secret
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const reconcileMock = vi.fn();

vi.mock("@/lib/stripe/reconcile-production-payments", () => ({
  reconcileProductionPayments: (...args: unknown[]) => reconcileMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { GET } from "../route";

function makeRequest(authHeader: string | null) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request(
    "http://localhost/api/cron/reconcile-production-payments",
    { headers }
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  reconcileMock.mockReset();
  reconcileMock.mockResolvedValue({ scanned: 0, captured: 0, cancelled: 0 });
});

describe("reconcile-production-payments cron — auth gate", () => {
  it("401s with no authorization header", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("401s with wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("500s when CRON_SECRET is not configured (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("200 and calls reconcileProductionPayments exactly once on correct secret", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledOnce();
  });

  it("returns the sweep result in the body", async () => {
    reconcileMock.mockResolvedValue({ scanned: 3, captured: 2, cancelled: 1 });
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ scanned: 3, captured: 2, cancelled: 1 });
  });
});
