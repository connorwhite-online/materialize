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
        where: () => Object.assign([] as unknown[], { limit: () => [] }),
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
  files: { id: "id", userId: "user_id", slug: "slug", name: "name" },
  fileAssets: {
    id: "id",
    fileId: "file_id",
    contentHash: "content_hash",
    originalFilename: "original_filename",
    fileSize: "file_size",
  },
  collections: { id: "id" },
  collectionItems: { collectionId: "collection_id" },
  filePhotos: { id: "id" },
  purchases: { id: "id" },
  projects: { id: "id", userId: "user_id" },
  projectFiles: { projectId: "project_id", fileId: "file_id" },
  users: { id: "id", defaultUploadVisibility: "default_upload_visibility" },
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

  // After the dedup widening, every call to createDraftFileForPrint
  // can run up to three innerJoin queries in order:
  //   1. same-user byte-hash match
  //   2. same-user (filename, size) match (fallback when byte hash misses)
  //   3. cross-user byte-hash match (anti-piracy)
  // Tests below seed innerJoinResults to control which queries hit.

  it("returns the existing asset when the user already owns a matching hash", async () => {
    // Byte-hash self-dedupe wins on the first try; nothing else runs.
    innerJoinResults = [
      [
        {
          assetId: "existing-asset-id",
          fileId: "existing-file-id",
          fileSlug: "existing-slug",
          fileName: "Existing",
        },
      ],
    ];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toEqual({
      fileAssetId: "existing-asset-id",
      fileSlug: "existing-slug",
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("falls back to (filename, size) match when byte hash misses", async () => {
    // Byte-hash empty, filename+size hits.
    innerJoinResults = [
      [],
      [
        {
          assetId: "filename-hit-asset-id",
          fileId: "filename-hit-file-id",
          fileSlug: "filename-hit-slug",
          fileName: "Existing",
        },
      ],
    ];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toEqual({
      fileAssetId: "filename-hit-asset-id",
      fileSlug: "filename-hit-slug",
    });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("inserts a new row when no self-dedupe and no cross-user collision", async () => {
    // Byte-hash self empty, filename+size self empty, anti-piracy empty.
    innerJoinResults = [[], [], []];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toHaveProperty("fileAssetId");
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it("still rejects cross-user duplicates (anti-piracy unchanged)", async () => {
    // Both self-dedupe queries empty, anti-piracy fires last.
    innerJoinResults = [[], [], [{ id: "other-users-asset" }]];

    const result = await createDraftFileForPrint(baseParams);

    expect(result).toHaveProperty("error");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
