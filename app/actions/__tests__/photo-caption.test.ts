import { describe, it, expect, vi, beforeEach } from "vitest";

// CON-84: updatePhotoCaption now authorizes the photo's AUTHOR as well
// as the file owner (it previously gated on the file owner only, so a
// build author couldn't fix their own caption while the owner could
// silently rewrite anyone's). These tests pin both grant paths and the
// reject path.

let photoRow: {
  id: string;
  authorId: string;
  fileUserId: string;
} | null = null;

let updatedCaption: string | null | undefined;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => (photoRow ? [photoRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: { caption: string | null }) => ({
        where: () => {
          updatedCaption = vals.caption;
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  filePhotos: { id: "id", userId: "user_id", caption: "caption" },
  files: { id: "id", userId: "user_id" },
  users: {},
}));

vi.mock("@/lib/storage", () => ({ deleteObject: vi.fn() }));
vi.mock("@/lib/entitlement", () => ({ userHasUsedFile: vi.fn() }));
vi.mock("@/lib/notifications/notify", () => ({ notifyBuildOnFile: vi.fn() }));
vi.mock("@/lib/notifications/types", () => ({ makeSnippet: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { updatePhotoCaption } from "../photos";

beforeEach(() => {
  vi.clearAllMocks();
  updatedCaption = undefined;
});

describe("updatePhotoCaption", () => {
  it("lets the photo author edit their own caption (CON-84)", async () => {
    photoRow = {
      id: "ph_1",
      authorId: "test-user-id", // viewer is the build author
      fileUserId: "someone_else", // a different user owns the file
    };
    const result = await updatePhotoCaption("ph_1", "  new caption  ");
    expect((result as { success?: boolean }).success).toBe(true);
    expect(updatedCaption).toBe("new caption");
  });

  it("lets the file owner edit any caption on their file", async () => {
    photoRow = {
      id: "ph_1",
      authorId: "build_author",
      fileUserId: "test-user-id", // viewer owns the file
    };
    const result = await updatePhotoCaption("ph_1", "owner edit");
    expect((result as { success?: boolean }).success).toBe(true);
    expect(updatedCaption).toBe("owner edit");
  });

  it("rejects a viewer who is neither author nor file owner", async () => {
    photoRow = {
      id: "ph_1",
      authorId: "build_author",
      fileUserId: "file_owner",
    };
    const result = await updatePhotoCaption("ph_1", "nope");
    expect((result as { error?: string }).error).toBe("Photo not found");
    expect(updatedCaption).toBeUndefined();
  });

  it("stores null when the caption trims to empty", async () => {
    photoRow = {
      id: "ph_1",
      authorId: "test-user-id",
      fileUserId: "someone_else",
    };
    const result = await updatePhotoCaption("ph_1", "   ");
    expect((result as { success?: boolean }).success).toBe(true);
    expect(updatedCaption).toBeNull();
  });
});
