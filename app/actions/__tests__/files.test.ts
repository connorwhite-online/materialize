import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockReturning = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();

// Queue of rows the mocked innerJoin().where() call resolves with, in
// call order. Defaults to empty (no collisions) when unseeded, which
// preserves the existing tests' assumptions; multi-asset collision
// tests below seed it explicitly.
let innerJoinResults: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return {
        values: (...a: unknown[]) => {
          mockValues(...a);
          const insertQuery = {
            onConflictDoNothing: () => insertQuery,
            returning: () => {
              mockReturning();
              return [{ id: "test-file-id", slug: "test-model-abc123" }];
            },
          };
          return insertQuery;
        },
      };
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return {
        set: (...a: unknown[]) => {
          mockSet(...a);
          return {
            where: (...w: unknown[]) => {
              mockWhere(...w);
              return Promise.resolve();
            },
          };
        },
      };
    },
    select: () => ({
      from: (...args: unknown[]) => {
        mockFrom(...args);
        mockSelect();
        const joinQuery = {
          innerJoin: () => joinQuery,
          leftJoin: () => joinQuery,
          where: () => {
            const next = (innerJoinResults.shift() ?? []) as unknown[];
            return Object.assign(next, {
              limit: () => next,
              orderBy: () => next,
            });
          },
        };
        return {
          // Bare .where() — `canWriteFile` calls .limit(1) after,
          // so we make the returned array chainable. The same path
          // serves the legacy direct `where()` callers that consume
          // the array directly via destructuring.
          where: () => {
            const row = {
              id: "test-file-id",
              userId: "test-user-id",
              slug: "test-slug",
              organizationId: null as string | null,
              visibility: "public" as const,
              status: "published" as const,
              price: 0,
            };
            const arr: typeof row[] = [row];
            return Object.assign(arr, {
              limit: () => arr,
            });
          },
          innerJoin: () => joinQuery,
          leftJoin: () => joinQuery,
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: {
    id: "id",
    userId: "user_id",
    status: "status",
    visibility: "visibility",
    slug: "slug",
    name: "name",
    thumbnailUrl: "thumbnail_url",
    organizationId: "organization_id",
  },
  fileAssets: { id: "id", fileId: "file_id", createdAt: "created_at" },
  collections: { id: "id", userId: "user_id" },
  collectionItems: { collectionId: "collection_id" },
  filePhotos: { id: "id", fileId: "file_id" },
  purchases: { id: "id", fileId: "file_id", projectId: "project_id" },
  projects: { id: "id", userId: "user_id" },
  projectFiles: { projectId: "project_id", fileId: "file_id" },
  users: {
    id: "id",
    username: "username",
    displayName: "display_name",
    avatarUrl: "avatar_url",
  },
  ownershipClaimIntents: {
    id: "id",
    raisedByUserId: "raised_by_user_id",
    existingFileId: "existing_file_id",
    contentHash: "content_hash",
    expiresAt: "expires_at",
    consumedAt: "consumed_at",
  },
  disputes: { id: "id", claimIntentId: "claim_intent_id" },
}));

// Mock the R2 storage layer so computeContentHash can run without a
// real R2 roundtrip. It reads via fetch(downloadUrl), so we stub
// generateDownloadUrl to return a data: URL and let fetch work on it.
vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn(async () =>
    // Tiny deterministic payload so the SHA-256 is stable across runs.
    "data:application/octet-stream;base64,AAEC"
  ),
  generateUploadUrl: vi.fn(async () => "https://example.com/upload"),
  deleteObject: vi.fn(async () => undefined),
  copyObject: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: (e: unknown) =>
    e instanceof Error &&
    (e.message.includes("NEXT_REDIRECT") || e.message.includes("REDIRECT")),
}));

import {
  createFileListing,
  publishFileListing,
  archiveFileListing,
} from "../files";

describe("createFileListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    innerJoinResults = [];
  });

  it("validates input and inserts file", async () => {
    const formData = new FormData();
    formData.set("name", "Test Model");
    formData.set("description", "A test model");
    formData.set("price", "9.99");
    formData.set("license", "cc_by");
    formData.set("tags", "test, model");
    formData.set(
      "assetsJson",
      JSON.stringify([
        {
          storageKey: "uploads/test-user-id/abc/test.stl",
          originalFilename: "test.stl",
          format: "stl",
          fileSize: 1024,
        },
      ])
    );

    // Will throw due to redirect mock
    await expect(createFileListing(formData)).rejects.toThrow("REDIRECT");

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        name: "Test Model",
        price: 999,
        license: "cc_by",
      })
    );
  });

  it("returns error for invalid input", async () => {
    const formData = new FormData();
    formData.set("name", ""); // empty name should fail
    formData.set("price", "-1");
    formData.set("license", "cc_by");

    const result = await createFileListing(formData);
    expect(result).toHaveProperty("error");
  });

  it("returns error for invalid license", async () => {
    const formData = new FormData();
    formData.set("name", "Test");
    formData.set("price", "0");
    formData.set("license", "bogus");

    const result = await createFileListing(formData);
    expect(result).toHaveProperty("error");
  });

  it("rejects repeated storage keys before hashing", async () => {
    const formData = new FormData();
    formData.set("name", "Repeated asset");
    formData.set("description", "");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set("tags", "");
    const asset = {
      storageKey: "uploads/test-user-id/a/model.stl",
      originalFilename: "model.stl",
      format: "stl",
      fileSize: 100,
    };
    formData.set("assetsJson", JSON.stringify([asset, asset]));

    const result = await createFileListing(formData);

    expect(result).toEqual({
      error: { name: ["The same uploaded file was attached more than once."] },
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // The generateDownloadUrl mock always resolves to the same fixed
  // base64 payload ("AAEC" -> bytes 00 01 02), so computeByteHashOnly
  // deterministically produces this SHA-256 for every asset in the
  // batch regardless of storageKey.
  const FIXED_BYTE_HASH =
    "ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc";

  it("blocks a multi-asset upload on a batched cross-user collision (2 assets, 1 upload)", async () => {
    const formData = new FormData();
    formData.set("name", "Multi Asset Model");
    formData.set("description", "desc");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set("tags", "test, model");
    formData.set(
      "assetsJson",
      JSON.stringify([
        {
          storageKey: "uploads/test-user-id/a/one.stl",
          originalFilename: "one.stl",
          format: "stl",
          fileSize: 100,
        },
        {
          storageKey: "uploads/test-user-id/b/two.stl",
          originalFilename: "two.stl",
          format: "stl",
          fileSize: 200,
        },
      ])
    );

    // Two queued rows: the batched cross-user query (hit) then the
    // batched same-user query (no hit) — one query each regardless
    // of asset count, per the collision-batching change.
    innerJoinResults = [[{
      contentHash: FIXED_BYTE_HASH,
      fileId: "existing-file-id",
      fileName: "Original Model",
      fileSlug: "original-model",
      thumbnailUrl: "https://example.com/original.webp",
      status: "published",
      visibility: "public",
      ownerUsername: "original-creator",
      ownerDisplayName: "Original Creator",
      ownerAvatarUrl: null,
    }], [], []];

    const result = await createFileListing(formData);

    expect(result).toEqual({
      duplicate: {
        claimIntentId: "test-file-id",
        file: {
          name: "Original Model",
          slug: "original-model",
          thumbnailUrl: "https://example.com/original.webp",
        },
        owner: {
          username: "original-creator",
          displayName: "Original Creator",
          avatarUrl: null,
        },
      },
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("allows a multi-asset upload through when the batched queries find no collisions", async () => {
    const formData = new FormData();
    formData.set("name", "Multi Asset Model");
    formData.set("description", "desc");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set("tags", "test, model");
    formData.set(
      "assetsJson",
      JSON.stringify([
        {
          storageKey: "uploads/test-user-id/a/one.stl",
          originalFilename: "one.stl",
          format: "stl",
          fileSize: 100,
        },
        {
          storageKey: "uploads/test-user-id/b/two.stl",
          originalFilename: "two.stl",
          format: "stl",
          fileSize: 200,
        },
      ])
    );

    innerJoinResults = [[], []];

    await expect(createFileListing(formData)).rejects.toThrow("REDIRECT");
    expect(mockInsert).toHaveBeenCalled();
  });
});

describe("publishFileListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates file status to published", async () => {
    await publishFileListing("test-file-id");
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith({ status: "published" });
  });
});

describe("archiveFileListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates file status to archived", async () => {
    await archiveFileListing("test-file-id");
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith({ status: "archived" });
  });
});
