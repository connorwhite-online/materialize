import { describe, it, expect, vi, beforeEach } from "vitest";

let existing: Array<{ id: string }> = [];
const inserted: Array<Record<string, unknown>> = [];
let insertFailures = 0;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(existing) }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (insertFailures > 0) {
            insertFailures--;
            return Promise.reject(new Error("unique violation"));
          }
          inserted.push(v);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({ users: { id: "id" } }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const getUser = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ users: { getUser } }),
}));

import { ensureUserRow } from "../ensure-user-row";

const clerkUser = {
  username: "reviewer",
  firstName: "App",
  lastName: "Reviewer",
  hasImage: false,
  imageUrl: "https://img.clerk.com/placeholder",
  updatedAt: Date.UTC(2026, 9, 1),
};

describe("ensureUserRow", () => {
  beforeEach(() => {
    existing = [];
    inserted.length = 0;
    insertFailures = 0;
    getUser.mockReset();
    getUser.mockResolvedValue(clerkUser);
  });

  it("does nothing when the row already exists", async () => {
    existing = [{ id: "user_1" }];
    expect(await ensureUserRow("user_1")).toBe(true);
    expect(getUser).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("creates the row from Clerk, stamped with Clerk's updatedAt so later webhooks still apply", async () => {
    expect(await ensureUserRow("user_1")).toBe(true);
    expect(inserted[0]).toEqual({
      id: "user_1",
      username: "reviewer",
      displayName: "App Reviewer",
      avatarUrl: null,
      updatedAt: new Date(Date.UTC(2026, 9, 1)),
    });
  });

  it("drops the username rather than fail when it collides", async () => {
    insertFailures = 1;
    expect(await ensureUserRow("user_1")).toBe(true);
    expect(inserted[0]).toMatchObject({ id: "user_1", username: null });
  });

  it("returns false when Clerk can't be reached", async () => {
    getUser.mockRejectedValue(new Error("down"));
    expect(await ensureUserRow("user_1")).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});
