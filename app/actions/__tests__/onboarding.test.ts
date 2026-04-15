import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock — select() is the existence check, insert() writes
// the username row. Both get swapped per test via the closure
// variables below.
let dbSelectWhere: () => unknown[] = () => [];
const mockInsertValues = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => dbSelectWhere.apply(null, args as []),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        mockInsertValues(v);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", username: "username" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// Clerk client mock — test sets clerkUpdateImpl per case.
// Override the global @clerk/nextjs/server mock from
// vitest.setup.ts so we also get a clerkClient export.
let clerkUpdateImpl: (userId: string, data: unknown) => Promise<unknown> =
  async () => ({});
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "test-user-id" })),
  clerkClient: vi.fn(async () => ({
    users: {
      updateUser: (userId: string, data: unknown) =>
        clerkUpdateImpl(userId, data),
    },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

import { setUsernameFromEmail } from "../onboarding";

describe("setUsernameFromEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectWhere = () => [];
    clerkUpdateImpl = async () => ({});
  });

  it("allocates the email local-part on the happy path", async () => {
    const result = await setUsernameFromEmail("ada@example.com");
    expect(result).toEqual({ success: true, username: "ada" });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ username: "ada" })
    );
  });

  it("sanitizes disallowed characters from the prefix", async () => {
    const result = await setUsernameFromEmail("ada.lovelace+test@x.com");
    if (!("success" in result)) throw new Error("expected success");
    // The username schema only allows a-z0-9_- so + gets stripped.
    expect(result.username).toBe("adalovelacetest");
  });

  it("falls back to 'user' when the prefix is fully empty after sanitizing", async () => {
    // "." is stripped entirely (not in [a-z0-9_-]), so base === ""
    // and the fallback "user" kicks in. 4 chars >= min-3 so the
    // first attempt uses "user" as-is, no suffix.
    const result = await setUsernameFromEmail(".@x.com");
    if (!("success" in result)) throw new Error("expected success");
    expect(result.username).toBe("user");
  });

  it("suffixes with a short random tag when the prefix is too short", async () => {
    const result = await setUsernameFromEmail("jo@x.com");
    if (!("success" in result)) throw new Error("expected success");
    // "jo" is 2 chars, below the min-3, so it must get a suffix.
    expect(result.username).toMatch(/^jo-[a-z0-9_-]{4}$/);
  });

  it("retries when the DB already has a different user on that username", async () => {
    let calls = 0;
    dbSelectWhere = () => {
      calls++;
      if (calls === 1) return [{ id: "other-user-id" }]; // collision
      return []; // free on the second try
    };
    const result = await setUsernameFromEmail("ada@x.com");
    if (!("success" in result)) throw new Error("expected success");
    // Second attempt adds a suffix.
    expect(result.username).toMatch(/^ada-[a-z0-9_-]{4}$/);
  });

  it("retries when Clerk returns 422 (username taken)", async () => {
    let clerkCalls = 0;
    clerkUpdateImpl = async () => {
      clerkCalls++;
      if (clerkCalls === 1) {
        const err = new Error("username already taken") as Error & {
          status: number;
        };
        err.status = 422;
        throw err;
      }
      return {};
    };
    const result = await setUsernameFromEmail("ada@x.com");
    if (!("success" in result)) throw new Error("expected success");
    // Second attempt got a suffix appended.
    expect(result.username).toMatch(/^ada-[a-z0-9_-]{4}$/);
  });

  it("bails immediately with a provider-unavailable error on a non-422 Clerk failure", async () => {
    clerkUpdateImpl = async () => {
      const err = new Error("service down") as Error & { status: number };
      err.status = 500;
      throw err;
    };
    const result = await setUsernameFromEmail("ada@x.com");
    expect(result).toEqual({
      error: "Account provider is temporarily unavailable.",
    });
  });

  it("returns an error after 5 failed allocation attempts", async () => {
    // Every DB select reports a collision.
    dbSelectWhere = () => [{ id: "someone-else" }];
    const result = await setUsernameFromEmail("ada@x.com");
    expect(result).toEqual({ error: "Could not allocate a username" });
  });
});
