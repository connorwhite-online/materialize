import { beforeEach, describe, expect, it, vi } from "vitest";

let intentRows: unknown[] = [];
let openDisputeRows: unknown[] = [];
const insertedValues: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { _table?: string }) => {
        const rows =
          table?._table === "ownership_claim_intents"
            ? intentRows
            : openDisputeRows;
        const query = {
          innerJoin: () => query,
          where: () => query,
          limit: () => rows,
        };
        return query;
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertedValues.push(values);
        return Promise.resolve();
      },
    }),
    transaction: async (
      callback: (tx: {
        update: () => {
          set: () => {
            where: () => {
              returning: () => Array<{ id: string }>;
            };
          };
        };
        insert: () => {
          values: (values: unknown) => Promise<void>;
        };
      }) => Promise<void>
    ) =>
      callback({
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => [{ id: "intent-1" }],
            }),
          }),
        }),
        insert: () => ({
          values: (values: unknown) => {
            insertedValues.push(values);
            return Promise.resolve();
          },
        }),
      }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  disputes: {
    _table: "disputes",
    id: "id",
    fileId: "file_id",
    raisedByUserId: "raised_by_user_id",
    status: "status",
  },
  files: {
    id: "id",
    name: "name",
    slug: "slug",
    userId: "user_id",
    flaggedReason: "flagged_reason",
  },
  ownershipClaimIntents: {
    _table: "ownership_claim_intents",
    id: "id",
    raisedByUserId: "raised_by_user_id",
    existingFileId: "existing_file_id",
    storageKey: "storage_key",
    originalFilename: "original_filename",
    expiresAt: "expires_at",
    consumedAt: "consumed_at",
  },
}));

vi.mock("@/lib/email/templates/dispute-filed", () => ({
  sendDisputeFiledEmail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import { sendDisputeFiledEmail } from "@/lib/email/templates/dispute-filed";
import { duplicateUploadDispute } from "../disputes";

const validIntent = {
  id: "intent-1",
  raisedByUserId: "user-1",
  existingFileId: "file-1",
  storageKey: "uploads/user-1/receipt/model.stl",
  originalFilename: "model.stl",
  expiresAt: new Date(Date.now() + 60_000),
  fileName: "Existing model",
  fileSlug: "existing-model",
};

describe("duplicateUploadDispute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intentRows = [validIntent];
    openDisputeRows = [];
    insertedValues.length = 0;
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  });

  it("files a claim with the retained model and validated photo evidence", async () => {
    const result = await duplicateUploadDispute({
      claimIntentId: "intent-1",
      reason: "I designed this model from my own sketches.",
      evidencePhotoKeys: [
        "uploads/user-1/ownership-claim-photos/a/prototype.jpg",
        "uploads/user-1/ownership-claim-photos/b/sketch.png",
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(insertedValues).toEqual([
      {
        fileId: "file-1",
        raisedByUserId: "user-1",
        claimIntentId: "intent-1",
        reason: "I designed this model from my own sketches.",
        evidencePhotoKeys: [
          "uploads/user-1/ownership-claim-photos/a/prototype.jpg",
          "uploads/user-1/ownership-claim-photos/b/sketch.png",
        ],
      },
    ]);
    expect(sendDisputeFiledEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        claimKind: "duplicate_upload",
        originalFilename: "model.stl",
        evidencePhotoCount: 2,
      })
    );
  });

  it("does not allow another user to consume the claim receipt", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "attacker" } as never);

    const result = await duplicateUploadDispute({
      claimIntentId: "intent-1",
      reason: "This reason is long enough.",
      evidencePhotoKeys: [],
    });

    expect(result).toEqual({
      error: "This ownership claim is no longer available.",
    });
    expect(insertedValues).toHaveLength(0);
  });

  it("rejects evidence keys outside the authenticated user's prefix", async () => {
    const result = await duplicateUploadDispute({
      claimIntentId: "intent-1",
      reason: "This reason is long enough.",
      evidencePhotoKeys: ["photos/other-user/a/stolen.jpg"],
    });

    expect(result).toEqual({ error: "Invalid evidence photo." });
    expect(insertedValues).toHaveLength(0);
  });

  it("rejects expired claim receipts", async () => {
    intentRows = [{ ...validIntent, expiresAt: new Date(Date.now() - 1) }];

    const result = await duplicateUploadDispute({
      claimIntentId: "intent-1",
      reason: "This reason is long enough.",
      evidencePhotoKeys: [],
    });

    expect(result).toEqual({
      error: "This ownership claim has expired. Upload the file again.",
    });
    expect(insertedValues).toHaveLength(0);
  });
});
