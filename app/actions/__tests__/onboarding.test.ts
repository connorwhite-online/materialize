import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock — select() is the existence check, insert() writes
// the username row. `dbSelectWhere` returns the rows for the
// USERS-table lookup; the unified handle validator also queries
// organizations, which we always treat as empty here (no collision
// with org slugs in any of these cases).
let dbSelectWhere: () => unknown[] = () => [];
const mockInsertValues = vi.fn();

function chainable<T>(arr: T[]) {
  return Object.assign(arr, { limit: () => arr });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: (...args: unknown[]) => {
          // Organizations lookup (from validateHandle) — never a
          // collision in these tests; let the chainable .limit() ride
          // on an empty array.
          if (table?.__name === "organizations") return chainable([]);
          return chainable(dbSelectWhere.apply(null, args as []));
        },
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
  users: { __name: "users", id: "id", username: "username" },
  organizations: { __name: "organizations", id: "id", slug: "slug" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// Clerk client mock — test sets clerkUpdateImpl per case.
// Override the global @clerk/nextjs/server mock from
// vitest.setup.ts so we also get a clerkClient export.
let clerkUpdateImpl: (userId: string, data: unknown) => Promise<unknown> =
  async () => ({});
// Every username value actually sent to Clerk, in order. Lets a test
// assert we didn't spend a round trip on a value Clerk was always
// going to reject.
let clerkUpdateCalls: unknown[] = [];
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "test-user-id" })),
  clerkClient: vi.fn(async () => ({
    users: {
      updateUser: (userId: string, data: unknown) => {
        clerkUpdateCalls.push(data);
        return clerkUpdateImpl(userId, data);
      },
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
    clerkUpdateCalls = [];
  });

  it("allocates the email local-part on the happy path", async () => {
    const result = await setUsernameFromEmail("lovelace@example.com");
    expect(result).toEqual({ success: true, username: "lovelace" });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ username: "lovelace" })
    );
  });

  // Regression: MIN_USERNAME_LENGTH must track Clerk's own username
  // minimum. A 3-char prefix used to be sent to Clerk as-is and came
  // back 422 — recoverable here (the loop retries with a suffix) but
  // fatal in setUsername, which surfaced it as a dead-end error
  // during the production-instance migration.
  it("suffixes a 3-char prefix rather than sending Clerk a value it rejects", async () => {
    const result = await setUsernameFromEmail("ada@example.com");
    if (!("success" in result)) throw new Error("expected success");
    expect(result.username).toMatch(/^ada-[a-z0-9_-]{4}$/);
    // One Clerk call, not a wasted 422 followed by a retry.
    expect(clerkUpdateCalls).toHaveLength(1);
  });

  it("sanitizes disallowed characters from the prefix", async () => {
    const result = await setUsernameFromEmail("ada.lovelace+test@x.com");
    if (!("success" in result)) throw new Error("expected success");
    // The username schema only allows a-z0-9_- so + gets stripped.
    expect(result.username).toBe("adalovelacetest");
  });

  it("falls back to 'user' when the prefix is fully empty after sanitizing", async () => {
    // "." is stripped entirely (not in [a-z0-9_-]), so base === ""
    // and the fallback "user" kicks in. At exactly 4 chars it meets
    // MIN_USERNAME_LENGTH, so the first attempt uses it as-is.
    const result = await setUsernameFromEmail(".@x.com");
    if (!("success" in result)) throw new Error("expected success");
    expect(result.username).toBe("user");
  });

  it("suffixes with a short random tag when the prefix is too short", async () => {
    const result = await setUsernameFromEmail("jo@x.com");
    if (!("success" in result)) throw new Error("expected success");
    // "jo" is 2 chars, below MIN_USERNAME_LENGTH, so it needs a suffix.
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
