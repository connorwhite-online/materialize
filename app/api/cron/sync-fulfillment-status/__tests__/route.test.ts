import { describe, it, expect, vi, beforeEach } from "vitest";

const syncMock = vi.fn();

vi.mock("@/lib/craftcloud/fulfillment-sync", () => ({
  syncFulfillmentStatuses: (...args: unknown[]) => syncMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { GET } from "../route";

function makeRequest(authHeader: string | null) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/sync-fulfillment-status", {
    headers,
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  syncMock.mockReset();
  syncMock.mockResolvedValue({ scanned: 0, updated: 0, errors: 0 });
});

describe("sync-fulfillment-status cron — auth gate", () => {
  it("401s with no authorization header", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("401s with wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("500s when CRON_SECRET is not configured (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("200 with the sweep result on correct secret", async () => {
    syncMock.mockResolvedValue({ scanned: 3, updated: 2, errors: 0 });
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ scanned: 3, updated: 2, errors: 0 });
  });

  it("500s when any row errored", async () => {
    syncMock.mockResolvedValue({ scanned: 3, updated: 1, errors: 1 });
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
