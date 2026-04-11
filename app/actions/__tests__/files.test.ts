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

vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return {
        values: (...a: unknown[]) => {
          mockValues(...a);
          return {
            returning: () => {
              mockReturning();
              return [{ id: "test-file-id", slug: "test-model-abc123" }];
            },
          };
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
        return {
          where: () => [
            { id: "test-file-id", userId: "test-user-id", slug: "test-slug" },
          ],
          innerJoin: () => ({
            where: () => [], // no duplicates found
          }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { id: "id", userId: "user_id", status: "status" },
  fileAssets: { id: "id", fileId: "file_id" },
}));

import {
  createFileListing,
  publishFileListing,
  archiveFileListing,
} from "../files";

describe("createFileListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates input and inserts file", async () => {
    const formData = new FormData();
    formData.set("name", "Test Model");
    formData.set("description", "A test model");
    formData.set("price", "9.99");
    formData.set("license", "free");
    formData.set("tags", "test, model");
    formData.append("assetIds", "asset-1");

    // Will throw due to redirect mock
    await expect(createFileListing(formData)).rejects.toThrow("REDIRECT");

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        name: "Test Model",
        price: 999,
        license: "free",
      })
    );
    // Assets should be linked
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("returns error for invalid input", async () => {
    const formData = new FormData();
    formData.set("name", ""); // empty name should fail
    formData.set("price", "-1");
    formData.set("license", "free");

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
