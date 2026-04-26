import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test control over which rows the self-dedupe / anti-piracy
// queries resolve with. Both queries go through innerJoin().where()
// so we hand out rows in call order.
let innerJoinResults: unknown[][] = [];
const mockInsertValues = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => [],
        innerJoin: () => ({
          where: () => {
            const next = innerJoinResults.shift() ?? [];
            return Object.assign(next, {
              limit: () => next,
            });
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        mockInsertValues(v);
        return {
          returning: () => [
            { id: "new-file-id", slug: "new-model-abc123" },
          ],
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { id: "id", userId: "user_id", slug: "slug" },
  fileAssets: { id: "id", fileId: "file_id", contentHash: "content_hash" },
  collections: { id: "id" },
  collectionItems: { collectionId: "collection_id" },
  filePhotos: { id: "id" },
  purchases: { id: "id" },
  projects: { id: "id", userId: "user_id" },
  projectFiles: { projectId: "project_id", fileId: "file_id" },
}));

vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn(async () =>
    "data:application/octet-stream;base64,AAEC"
  ),
  generateUploadUrl: vi.fn(async () => "https://example.com/upload"),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: (e: unknown) =>
    e instanceof Error &&
    (e.message.includes("NEXT_REDIRECT") || e.message.includes("REDIRECT")),
}));

import { createDraftFileForPrint } from "../files";

const baseParams = {
  storageKey: "uploads/test-user-id/abc/test.stl",
  originalFilename: "test.stl",
  format: "stl" as const,
  fileSize: 1024,
};

describe("createDraftFileForPrint self-dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    innerJoinResults = [];
  });

  it("returns the existing asset when the user already owns a matching hash", async () => {
    // Self-dedupe query returns a hit — cross-user query never runs.
    innerJoinResults = [
      [{ assetId: "existing-asset-id", fileSlug: "existing-slug" }],
    ];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toEqual({
      fileAssetId: "existing-asset-id",
      fileSlug: "existing-slug",
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("inserts a new row when neither query matches", async () => {
    // 1st call = self-dedupe (empty), 2nd call = anti-piracy (empty)
    innerJoinResults = [[], []];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toHaveProperty("fileAssetId");
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it("still rejects cross-user duplicates (anti-piracy unchanged)", async () => {
    // Self-dedupe empty, anti-piracy hit
    innerJoinResults = [[], [{ id: "other-users-asset" }]];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toHaveProperty("error");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
