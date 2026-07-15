import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue of rows the mocked innerJoin().where() call resolves with, in
// call order — mirrors the pattern in
// app/actions/__tests__/files-dedupe.test.ts.
let innerJoinResults: unknown[][] = [];
const whereArgsCalls: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => {
        const query = {
          innerJoin: () => query,
          where: (...args: unknown[]) => {
            whereArgsCalls.push(args);
            return innerJoinResults.shift() ?? [];
          },
        };
        return query;
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: {
    id: "id",
    userId: "user_id",
    slug: "slug",
    name: "name",
    thumbnailUrl: "thumbnail_url",
    status: "status",
    visibility: "visibility",
  },
  fileAssets: {
    id: "id",
    fileId: "file_id",
    contentHash: "content_hash",
    originalFilename: "original_filename",
    fileSize: "file_size",
  },
  users: {
    id: "id",
    username: "username",
    displayName: "display_name",
    avatarUrl: "avatar_url",
  },
}));

vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn(async () => "https://example.com/download"),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import {
  checkByteHashCollisionBatch,
  findExistingSameUserAssetsBatch,
} from "../fingerprint-asset";

describe("checkByteHashCollisionBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    innerJoinResults = [];
    whereArgsCalls.length = 0;
  });

  it("returns an empty map and skips the query when there are no hashes", async () => {
    const result = await checkByteHashCollisionBatch([], "user-1");
    expect(result).toEqual(new Map());
    expect(whereArgsCalls).toHaveLength(0);
  });

  it("issues exactly one query for any number of hashes and returns the colliding subset", async () => {
    innerJoinResults = [[
      {
        contentHash: "hash-a",
        fileId: "file-a",
        fileName: "Public A",
        fileSlug: "public-a",
        thumbnailUrl: "a.webp",
        status: "published",
        visibility: "public",
        ownerUsername: "alice",
        ownerDisplayName: "Alice",
        ownerAvatarUrl: "alice.webp",
      },
      {
        contentHash: "hash-c",
        fileId: "file-c",
        fileName: "Private C",
        fileSlug: "private-c",
        thumbnailUrl: "c.webp",
        status: "draft",
        visibility: "private",
        ownerUsername: "carol",
        ownerDisplayName: "Carol",
        ownerAvatarUrl: "carol.webp",
      },
    ]];

    const result = await checkByteHashCollisionBatch(
      ["hash-a", "hash-b", "hash-c"],
      "user-1"
    );

    expect(whereArgsCalls).toHaveLength(1);
    expect(result.get("hash-a")).toEqual({
      fileId: "file-a",
      fileName: "Public A",
      fileSlug: "public-a",
      thumbnailUrl: "a.webp",
      ownerUsername: "alice",
      ownerDisplayName: "Alice",
      ownerAvatarUrl: "alice.webp",
    });
    expect(result.get("hash-c")).toEqual({
      fileId: "file-c",
      fileName: null,
      fileSlug: null,
      thumbnailUrl: null,
      ownerUsername: null,
      ownerDisplayName: null,
      ownerAvatarUrl: null,
    });
    expect(result.has("hash-b")).toBe(false);
  });

  it("matches the per-asset semantics: a hash with no cross-user row is not flagged", async () => {
    innerJoinResults = [[]];
    const result = await checkByteHashCollisionBatch(["hash-only-mine"], "user-1");
    expect(result.size).toBe(0);
  });
});

describe("findExistingSameUserAssetsBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    innerJoinResults = [];
    whereArgsCalls.length = 0;
  });

  it("returns empty maps and skips the query when there are no hashes or filenames", async () => {
    const result = await findExistingSameUserAssetsBatch("user-1", [
      { byteHash: null, originalFilename: "", fileSize: 0 },
    ]);
    expect(result.byHash.size).toBe(0);
    expect(result.byNameSize.size).toBe(0);
    expect(whereArgsCalls).toHaveLength(0);
  });

  it("issues exactly one query for the whole batch and buckets rows by hash and by name+size", async () => {
    innerJoinResults = [
      [
        {
          assetId: "asset-1",
          fileId: "file-1",
          fileSlug: "slug-1",
          fileName: "Name 1",
          contentHash: "hash-1",
          originalFilename: "model1.stl",
          fileSize: 100,
        },
        {
          assetId: "asset-2",
          fileId: "file-2",
          fileSlug: "slug-2",
          fileName: "Name 2",
          contentHash: null,
          originalFilename: "model2.stl",
          fileSize: 200,
        },
      ],
    ];

    const result = await findExistingSameUserAssetsBatch("user-1", [
      { byteHash: "hash-1", originalFilename: "model1.stl", fileSize: 100 },
      { byteHash: null, originalFilename: "model2.stl", fileSize: 200 },
      { byteHash: "hash-3", originalFilename: "model3.stl", fileSize: 300 },
    ]);

    expect(whereArgsCalls).toHaveLength(1);
    expect(result.byHash.get("hash-1")).toEqual({
      assetId: "asset-1",
      fileId: "file-1",
      fileSlug: "slug-1",
      fileName: "Name 1",
    });
    expect(result.byNameSize.get("model2.stl::200")).toEqual({
      assetId: "asset-2",
      fileId: "file-2",
      fileSlug: "slug-2",
      fileName: "Name 2",
    });
    // hash-3 had no matching row — absent from the map, exactly like
    // the per-asset findExistingSameUserAsset returning null.
    expect(result.byHash.has("hash-3")).toBe(false);
  });

  it("prioritizes the byte-hash key the same way the serial helper prioritizes hash over filename/size", async () => {
    // Simulates the case where a row matches both the hash IN-list
    // and would also match on filename/size — the caller (files.ts)
    // is responsible for checking byHash before byNameSize, which is
    // exactly what findExistingSameUserAsset did serially (hash
    // query first, filename/size query only as a fallback).
    innerJoinResults = [
      [
        {
          assetId: "asset-hash-hit",
          fileId: "file-hash-hit",
          fileSlug: "slug-hash-hit",
          fileName: "Hash hit",
          contentHash: "hash-1",
          originalFilename: "dup.stl",
          fileSize: 50,
        },
      ],
    ];

    const result = await findExistingSameUserAssetsBatch("user-1", [
      { byteHash: "hash-1", originalFilename: "dup.stl", fileSize: 50 },
    ]);

    expect(result.byHash.get("hash-1")?.assetId).toBe("asset-hash-hit");
    expect(result.byNameSize.get("dup.stl::50")?.assetId).toBe(
      "asset-hash-hit"
    );
  });
});
