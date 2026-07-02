import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type StragglerRow = {
  assetId: string;
  fileId: string | null;
  ownerUserId: string;
  storageKey: string;
  format: string;
  fileUnit: "mm" | "cm" | "in";
};

let stragglers: StragglerRow[] = [];
let selectThrows: Error | null = null;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => {
              if (selectThrows) return Promise.reject(selectThrows);
              return Promise.resolve(stragglers);
            },
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  fileAssets: {
    id: "id",
    fileId: "file_id",
    storageKey: "storage_key",
    format: "format",
    fileUnit: "file_unit",
    geometryHash: "geometry_hash",
    createdAt: "created_at",
  },
  files: {
    id: "id",
    userId: "user_id",
  },
}));

const fingerprintHelper = vi.fn();
vi.mock("@/lib/hashing/fingerprint-asset", () => ({
  fingerprintAndPersistAsset: (...args: unknown[]) =>
    fingerprintHelper(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { GET } from "../route";

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request(
    "http://localhost/api/cron/sweep-fingerprint-stragglers",
    { headers }
  );
}

describe("cron/sweep-fingerprint-stragglers", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    stragglers = [];
    selectThrows = null;
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(fingerprintHelper).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong token", async () => {
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(fingerprintHelper).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(fingerprintHelper).not.toHaveBeenCalled();
  });

  it("returns zero counts when nothing is stale", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanned).toBe(0);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.cutoff).toEqual(expect.any(String));
    expect(fingerprintHelper).not.toHaveBeenCalled();
  });

  it("calls the fingerprint helper for each straggler row", async () => {
    stragglers = [
      {
        assetId: "asset-1",
        fileId: "file-1",
        ownerUserId: "user-1",
        storageKey: "uploads/user-1/a.stl",
        format: "stl",
        fileUnit: "mm",
      },
      {
        assetId: "asset-2",
        fileId: "file-2",
        ownerUserId: "user-2",
        storageKey: "uploads/user-2/b.obj",
        format: "obj",
        fileUnit: "in",
      },
    ];
    fingerprintHelper.mockResolvedValue(undefined);

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanned).toBe(2);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);

    expect(fingerprintHelper).toHaveBeenCalledTimes(2);
    expect(fingerprintHelper).toHaveBeenCalledWith({
      assetId: "asset-1",
      fileId: "file-1",
      ownerUserId: "user-1",
      storageKey: "uploads/user-1/a.stl",
      format: "stl",
      fileUnit: "mm",
    });
    expect(fingerprintHelper).toHaveBeenCalledWith({
      assetId: "asset-2",
      fileId: "file-2",
      ownerUserId: "user-2",
      storageKey: "uploads/user-2/b.obj",
      format: "obj",
      fileUnit: "in",
    });
  });

  it("counts a row as failed when the helper throws", async () => {
    stragglers = [
      {
        assetId: "asset-good",
        fileId: "file-good",
        ownerUserId: "user-1",
        storageKey: "uploads/user-1/a.stl",
        format: "stl",
        fileUnit: "mm",
      },
      {
        assetId: "asset-bad",
        fileId: "file-bad",
        ownerUserId: "user-1",
        storageKey: "uploads/user-1/b.stl",
        format: "stl",
        fileUnit: "mm",
      },
    ];
    fingerprintHelper.mockImplementation((p: { assetId: string }) => {
      if (p.assetId === "asset-bad") throw new Error("boom");
      return Promise.resolve();
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    // MTR-144: failed>0 now surfaces as a 500 so Vercel cron monitoring
    // flags it, matching cleanup-stale-orders / reconcile-production-payments
    // / place-auto-approved-orders.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.scanned).toBe(2);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
  });

  it("returns 500 when the select itself throws", async () => {
    selectThrows = new Error("db down");
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(fingerprintHelper).not.toHaveBeenCalled();
  });
});
