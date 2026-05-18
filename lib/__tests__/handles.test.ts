import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test responses for the unified handle namespace lookups.
// validateHandle and resolveHandle both query users + organizations;
// the mock routes by table name.

// Drizzle's query chain is awaitable AND chainable — make the mock
// match by giving the returned shape both `.limit()` (chain) and
// `.then()` (await). `resolveHandle` uses the awaitable form;
// `validateHandle` uses the chained `.limit(1)` form.
let usersRows: Array<{ id: string; username: string | null }> = [];
let orgsRows: Array<{ id: string; slug: string }> = [];

function chainable<T>(arr: T[]) {
  const obj: T[] & {
    limit: () => T[] & { limit: unknown; then: unknown };
    then: (cb: (val: T[]) => unknown) => Promise<unknown>;
  } = Object.assign(arr.slice(), {
    limit: () => chainable(arr),
    then: (cb: (val: T[]) => unknown) => Promise.resolve(arr).then(cb),
  });
  return obj;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        // Filter by the candidate handle so iterative collision-
        // checks (buildUniqueHandle's suffix walk) see different
        // results per candidate instead of all hitting the same
        // seed row.
        where: (filter: { __value?: string } | unknown) => {
          const value = (filter as { __value?: string })?.__value;
          if (table.__name === "users") {
            const matched = value
              ? usersRows.filter((r) => r.username === value)
              : usersRows;
            return chainable(matched);
          }
          if (table.__name === "organizations") {
            const matched = value
              ? orgsRows.filter((r) => r.slug === value)
              : orgsRows;
            return chainable(matched);
          }
          return chainable([]);
        },
      }),
    }),
  },
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm"
  );
  return {
    ...actual,
    // Bypass the real eq() so the mocked `where` can read the
    // intended value off a plain object. Tests don't care about the
    // SQL shape, only the candidate the query is searching for.
    eq: (_col: unknown, value: unknown) => ({ __value: value }),
  };
});

vi.mock("@/lib/db/schema", () => ({
  users: { __name: "users", id: "id", username: "username" },
  organizations: { __name: "organizations", id: "id", slug: "slug" },
}));

import { isReservedHandle, RESERVED_HANDLES } from "../handles/reserved";
import { buildUniqueHandle, validateHandle } from "../handles/validate";
import { resolveHandle } from "../handles/resolve";

beforeEach(() => {
  usersRows = [];
  orgsRows = [];
});

describe("isReservedHandle", () => {
  it("matches known top-level routes", () => {
    expect(isReservedHandle("files")).toBe(true);
    expect(isReservedHandle("dashboard")).toBe(true);
    expect(isReservedHandle("api")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isReservedHandle("FILES")).toBe(true);
    expect(isReservedHandle("Dashboard")).toBe(true);
  });

  it("returns false for non-reserved strings", () => {
    expect(isReservedHandle("connor")).toBe(false);
    expect(isReservedHandle("vercel")).toBe(false);
  });

  it("blocks the legacy account prefixes too", () => {
    expect(RESERVED_HANDLES.has("u")).toBe(true);
    expect(RESERVED_HANDLES.has("o")).toBe(true);
  });
});

describe("validateHandle", () => {
  it("rejects reserved words before hitting the DB", async () => {
    const conflict = await validateHandle("files");
    expect(conflict).toMatch(/reserved/i);
  });

  it("rejects when another user has the username", async () => {
    usersRows = [{ id: "user_2", username: "connor" }];
    const conflict = await validateHandle("connor");
    expect(conflict).toMatch(/already taken/i);
  });

  it("rejects when an org already owns the slug", async () => {
    orgsRows = [{ id: "org_1", slug: "vercel" }];
    const conflict = await validateHandle("vercel");
    expect(conflict).toMatch(/already taken/i);
  });

  it("allows the caller's own existing user row via ignoreUserId", async () => {
    usersRows = [{ id: "user_1", username: "connor" }];
    const conflict = await validateHandle("connor", { ignoreUserId: "user_1" });
    expect(conflict).toBeNull();
  });

  it("allows the caller's own existing org row via ignoreOrgId", async () => {
    orgsRows = [{ id: "org_1", slug: "vercel" }];
    const conflict = await validateHandle("vercel", { ignoreOrgId: "org_1" });
    expect(conflict).toBeNull();
  });

  it("flags an empty / whitespace handle", async () => {
    expect(await validateHandle("")).toMatch(/required/i);
    expect(await validateHandle("   ")).toMatch(/required/i);
  });
});

describe("buildUniqueHandle", () => {
  it("returns the base when nothing conflicts", async () => {
    const out = await buildUniqueHandle("acme");
    expect(out).toBe("acme");
  });

  it("appends -2 when the base is already taken", async () => {
    usersRows = [{ id: "user_a", username: "acme" }];
    const out = await buildUniqueHandle("acme");
    expect(out).toBe("acme-2");
  });

  it("sanitizes the stem before suffixing", async () => {
    const out = await buildUniqueHandle("Acme Co.");
    expect(out).toBe("acme-co-");
  });

  it("falls back to a default when the stem is empty after sanitization", async () => {
    // "team" is itself reserved (see lib/handles/reserved.ts) so
    // the suffix walk kicks in and returns "team-2".
    const out = await buildUniqueHandle("");
    expect(out).toBe("team-2");
  });
});

describe("resolveHandle", () => {
  it("returns null for unknown handles", async () => {
    expect(await resolveHandle("nobody")).toBeNull();
  });

  it("resolves a user when only the users row exists", async () => {
    usersRows = [{ id: "user_1", username: "connor" }];
    const result = await resolveHandle("connor");
    expect(result).toEqual({ kind: "user", userId: "user_1" });
  });

  it("resolves an org when only the org row exists", async () => {
    orgsRows = [{ id: "org_1", slug: "vercel" }];
    const result = await resolveHandle("vercel");
    expect(result).toEqual({ kind: "org", orgId: "org_1" });
  });

  it("prefers the user when (somehow) both rows exist", async () => {
    usersRows = [{ id: "user_1", username: "ambiguous" }];
    orgsRows = [{ id: "org_1", slug: "ambiguous" }];
    const result = await resolveHandle("ambiguous");
    expect(result).toEqual({ kind: "user", userId: "user_1" });
  });

  it("treats whitespace-only handles as not-found without hitting the DB", async () => {
    expect(await resolveHandle("   ")).toBeNull();
  });
});
