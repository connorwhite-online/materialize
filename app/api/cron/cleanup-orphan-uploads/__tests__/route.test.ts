import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock state:
 *   fileAssetRows  — rows returned from db.select().from(fileAssets)
 *   r2Objects      — objects returned from ListObjectsV2Command
 *   throwOnDb      — if true, the DB select throws
 *   mockSend       — spy on the instance send method
 */

let fileAssetRows: Array<{ storageKey: string }> = [];
let claimIntentRows: Array<{ storageKey: string }> = [];
let disputeEvidenceRows: Array<{ evidencePhotoKeys: string[] }> = [];
let r2Objects: Array<{
  Key?: string;
  Size?: number;
  LastModified?: Date;
}> = [];
let throwOnDb = false;

const mockSend = vi.fn();

// Mock @aws-sdk/client-s3 so S3Client instances use mockSend.
vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mockSend;
  }
  class MockListObjectsV2Command {
    _type = "ListObjectsV2Command";
    constructor(public input: unknown) {}
  }
  class MockDeleteObjectsCommand {
    _type = "DeleteObjectsCommand";
    constructor(public input: unknown) {}
  }
  return {
    S3Client: MockS3Client,
    ListObjectsV2Command: MockListObjectsV2Command,
    DeleteObjectsCommand: MockDeleteObjectsCommand,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { _table?: string }) => {
        if (throwOnDb) throw new Error("db error");
        if (table?._table === "ownership_claim_intents") {
          return {
            leftJoin: () => ({
              where: () => Promise.resolve(claimIntentRows),
            }),
          };
        }
        if (table?._table === "disputes") {
          return {
            where: () => Promise.resolve(disputeEvidenceRows),
          };
        }
        return Promise.resolve(fileAssetRows);
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  fileAssets: { _table: "file_assets", storageKey: "storage_key" },
  ownershipClaimIntents: {
    _table: "ownership_claim_intents",
    id: "id",
    storageKey: "storage_key",
    expiresAt: "expires_at",
    toString: () => "ownership_claim_intents",
  },
  disputes: {
    _table: "disputes",
    id: "id",
    claimIntentId: "claim_intent_id",
    status: "status",
    createdAt: "created_at",
    resolvedAt: "resolved_at",
    evidencePhotoKeys: "evidence_photo_keys",
  },
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
  return new Request("http://localhost/api/cron/cleanup-orphan-uploads", {
    headers,
  });
}

/** Build a LastModified Date that is `hoursAgo` hours in the past. */
function objectAgedHours(hoursAgo: number): Date {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
}

describe("cron/cleanup-orphan-uploads", () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalAccountId = process.env.R2_ACCOUNT_ID;
  const originalAccessKey = process.env.R2_ACCESS_KEY_ID;
  const originalSecretKey = process.env.R2_SECRET_ACCESS_KEY;
  const originalBucket = process.env.R2_BUCKET_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    fileAssetRows = [];
    claimIntentRows = [];
    disputeEvidenceRows = [];
    r2Objects = [];
    throwOnDb = false;

    process.env.CRON_SECRET = "test-secret";
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.R2_BUCKET_NAME = "test-bucket";

    // Default mockSend: ListObjectsV2 returns r2Objects in one page;
    // DeleteObjects reflects back the requested keys as Deleted.
    mockSend.mockImplementation(
      (cmd: { _type: string; input: unknown }) => {
        if (cmd._type === "ListObjectsV2Command") {
          return Promise.resolve({
            Contents: r2Objects,
            IsTruncated: false,
            NextContinuationToken: undefined,
          });
        }
        if (cmd._type === "DeleteObjectsCommand") {
          const input = cmd.input as {
            Delete: { Objects: Array<{ Key: string }> };
          };
          return Promise.resolve({
            Deleted: input.Delete.Objects.map((o) => ({ Key: o.Key })),
            Errors: [],
          });
        }
        return Promise.resolve({});
      }
    );
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    if (originalAccountId === undefined) delete process.env.R2_ACCOUNT_ID;
    else process.env.R2_ACCOUNT_ID = originalAccountId;
    if (originalAccessKey === undefined) delete process.env.R2_ACCESS_KEY_ID;
    else process.env.R2_ACCESS_KEY_ID = originalAccessKey;
    if (originalSecretKey === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
    else process.env.R2_SECRET_ACCESS_KEY = originalSecretKey;
    if (originalBucket === undefined) delete process.env.R2_BUCKET_NAME;
    else process.env.R2_BUCKET_NAME = originalBucket;
  });

  // --- Auth ---

  it("rejects requests without any Authorization header → 401", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects requests with the wrong token → 401", async () => {
    const res = await GET(makeRequest("Bearer wrong-token"));
    expect(res.status).toBe(401);
  });

  it("rejects when CRON_SECRET is unset → 500 (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("CRON_SECRET not configured");
  });

  // --- Happy path ---

  it("returns 200 with zero counts when bucket is empty", async () => {
    r2Objects = [];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanned).toBe(0);
    expect(body.orphans).toBe(0);
    expect(body.deleted).toBe(0);
    expect(body.reclaimedBytes).toBe(0);
  });

  it("does NOT delete referenced keys even when older than 24h", async () => {
    fileAssetRows = [{ storageKey: "uploads/user/model.stl" }];
    r2Objects = [
      {
        Key: "uploads/user/model.stl",
        Size: 5000,
        LastModified: objectAgedHours(48),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanned).toBe(1);
    expect(body.orphans).toBe(0);
    expect(body.deleted).toBe(0);

    const deleteCalls = mockSend.mock.calls.filter(
      (c) => (c[0] as { _type: string })._type === "DeleteObjectsCommand"
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it("does NOT delete an original model retained as ownership evidence", async () => {
    claimIntentRows = [{ storageKey: "uploads/user/claimed-model.stl" }];
    r2Objects = [
      {
        Key: "uploads/user/claimed-model.stl",
        Size: 5000,
        LastModified: objectAgedHours(48),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect((await res.json()).orphans).toBe(0);
  });

  it("does NOT delete a photo attached to an ownership dispute", async () => {
    disputeEvidenceRows = [
      {
        evidencePhotoKeys: [
          "uploads/user/ownership-claim-photos/evidence/photo.jpg",
        ],
      },
    ];
    r2Objects = [
      {
        Key: "uploads/user/ownership-claim-photos/evidence/photo.jpg",
        Size: 5000,
        LastModified: objectAgedHours(48),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect((await res.json()).orphans).toBe(0);
  });

  it("does NOT delete unreferenced keys younger than 24h (age safety rail)", async () => {
    fileAssetRows = [];
    r2Objects = [
      {
        Key: "uploads/user/fresh.stl",
        Size: 1000,
        LastModified: objectAgedHours(12), // only 12h old
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orphans).toBe(0);
    expect(body.deleted).toBe(0);
  });

  it("deletes unreferenced keys older than 24h (the orphan case)", async () => {
    fileAssetRows = [{ storageKey: "uploads/user/referenced.stl" }];
    r2Objects = [
      {
        Key: "uploads/user/referenced.stl",
        Size: 2000,
        LastModified: objectAgedHours(30),
      },
      {
        Key: "uploads/user/orphan-a.stl",
        Size: 3000,
        LastModified: objectAgedHours(25),
      },
      {
        Key: "uploads/user/orphan-b.stl",
        Size: 1500,
        LastModified: objectAgedHours(50),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanned).toBe(3);
    expect(body.orphans).toBe(2);
    expect(body.deleted).toBe(2);
    expect(body.reclaimedBytes).toBe(4500); // 3000 + 1500

    // Verify the delete command included the right keys.
    const deleteCalls = mockSend.mock.calls.filter(
      (c) => (c[0] as { _type: string })._type === "DeleteObjectsCommand"
    );
    expect(deleteCalls).toHaveLength(1);
    const deleteInput = (
      deleteCalls[0][0] as {
        input: { Delete: { Objects: Array<{ Key: string }> } };
      }
    ).input;
    const deletedKeys = deleteInput.Delete.Objects.map((o: { Key: string }) => o.Key).sort();
    expect(deletedKeys).toEqual([
      "uploads/user/orphan-a.stl",
      "uploads/user/orphan-b.stl",
    ]);
  });

  it("never deletes objects without the uploads/ prefix (prefix safety rail)", async () => {
    fileAssetRows = [];
    r2Objects = [
      {
        Key: "thumbnails/user/thumb.jpg",
        Size: 500,
        LastModified: objectAgedHours(48),
      },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orphans).toBe(0);
    expect(body.deleted).toBe(0);
  });

  // --- Error paths ---

  it("returns 500 and logs when the DB select throws", async () => {
    throwOnDb = true;
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-orphan-uploads",
      expect.any(Error)
    );
  });

  it("returns 500 and logs when R2 credentials are missing", async () => {
    delete process.env.R2_ACCOUNT_ID;
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-orphan-uploads",
      expect.any(Error)
    );
  });
});
