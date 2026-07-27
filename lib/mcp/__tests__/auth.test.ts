import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashToken } from "../tokens";

interface FakePatRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

let selectedRow: FakePatRow | null = null;
const updateSet = vi.fn();
const updateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectedRow ? [selectedRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        updateSet(...args);
        return {
          where: (...w: unknown[]) => {
            updateWhere(...w);
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  personalAccessTokens: { id: "id", tokenHash: "token_hash" },
}));

import { verifyMaterializeToken, requireScope, MissingScopeError } from "../auth";
import type { MaterializeAuthExtra } from "../auth";
import type { Scope } from "../scopes";

const RAW_TOKEN = "mtl_pat_abcdefghijklmnopqrstuvwxyz1234567890";

function makeRow(overrides: Partial<FakePatRow> = {}): FakePatRow {
  return {
    id: "tok_123",
    userId: "user_abc",
    name: "Test agent",
    tokenHash: hashToken(RAW_TOKEN),
    prefix: "mtl_pat_abcdefgh",
    scopes: ["catalog:read", "files:read"],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("verifyMaterializeToken", () => {
  beforeEach(() => {
    selectedRow = null;
    updateSet.mockClear();
    updateWhere.mockClear();
  });

  it("returns undefined when no bearer token is present", async () => {
    const result = await verifyMaterializeToken(new Request("https://x"), undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined for tokens that don't match the materialize prefix", async () => {
    const result = await verifyMaterializeToken(
      new Request("https://x"),
      "Bearer wrong-shape-token"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the hash does not exist in the DB", async () => {
    selectedRow = null;
    const result = await verifyMaterializeToken(
      new Request("https://x"),
      RAW_TOKEN
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for revoked tokens", async () => {
    selectedRow = makeRow({ revokedAt: new Date("2026-01-15T00:00:00Z") });
    const result = await verifyMaterializeToken(
      new Request("https://x"),
      RAW_TOKEN
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for expired tokens", async () => {
    selectedRow = makeRow({ expiresAt: new Date("2020-01-01T00:00:00Z") });
    const result = await verifyMaterializeToken(
      new Request("https://x"),
      RAW_TOKEN
    );
    expect(result).toBeUndefined();
  });

  it("accepts a valid token and surfaces the user/scope context", async () => {
    selectedRow = makeRow();
    const result = await verifyMaterializeToken(
      new Request("https://x"),
      RAW_TOKEN
    );
    expect(result).toBeDefined();
    expect(result?.token).toBe(RAW_TOKEN);
    expect(result?.scopes).toEqual(["catalog:read", "files:read"]);
    expect(result?.extra.userId).toBe("user_abc");
    expect(result?.extra.tokenId).toBe("tok_123");
    expect(result?.extra.tokenName).toBe("Test agent");
  });

  it("updates lastUsedAt when the token has never been used", async () => {
    selectedRow = makeRow({ lastUsedAt: null });
    await verifyMaterializeToken(new Request("https://x"), RAW_TOKEN);
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet.mock.calls[0][0]).toHaveProperty("lastUsedAt");
  });

  it("skips the lastUsedAt update when the token was used in the last minute (rate-limit)", async () => {
    selectedRow = makeRow({ lastUsedAt: new Date(Date.now() - 5_000) });
    await verifyMaterializeToken(new Request("https://x"), RAW_TOKEN);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("updates lastUsedAt when the previous use was over a minute ago", async () => {
    selectedRow = makeRow({
      lastUsedAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    await verifyMaterializeToken(new Request("https://x"), RAW_TOKEN);
    expect(updateSet).toHaveBeenCalledTimes(1);
  });
});

// TEST-24 (2026-07-25 audit): requireScope/MissingScopeError back every
// requireScope(auth, scope) call in app/api/[transport]/route.ts (28 of
// them, one per registered MCP tool) but had zero direct unit tests of
// their own — the only coverage was indirect, through whichever
// tool-specific tests happened to exercise the gate. Pin the primitive's
// truth table directly.
describe("requireScope", () => {
  function authExtra(scopes: Scope[]): MaterializeAuthExtra {
    return {
      userId: "user_abc",
      tokenId: "tok_123",
      tokenName: "Test agent",
      scopes,
    };
  }

  it("does not throw when the required scope is present", () => {
    expect(() =>
      requireScope(authExtra(["catalog:read"]), "catalog:read")
    ).not.toThrow();
  });

  it("does not throw when the required scope is present among several", () => {
    expect(() =>
      requireScope(
        authExtra(["files:read", "catalog:read", "orders:read"]),
        "catalog:read"
      )
    ).not.toThrow();
  });

  it("throws MissingScopeError when the scope list is empty", () => {
    expect(() => requireScope(authExtra([]), "catalog:read")).toThrow(
      MissingScopeError
    );
  });

  it("throws MissingScopeError when other scopes are present but not the required one", () => {
    expect(() =>
      requireScope(authExtra(["files:read", "projects:read"]), "orders:create")
    ).toThrow(MissingScopeError);
  });

  it("attaches the missing scope to the thrown error and to the error message", () => {
    try {
      requireScope(authExtra(["files:read"]), "orders:create");
      expect.unreachable("requireScope should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      expect((err as MissingScopeError).scope).toBe("orders:create");
      expect((err as MissingScopeError).name).toBe("MissingScopeError");
      expect((err as Error).message).toContain("orders:create");
    }
  });

  it("is not satisfied by scope-string prefix/substring overlap (no implicit wildcarding)", () => {
    // "files:write" implies nothing about "files:read" — requireScope does
    // an exact membership check only, no prefix or hierarchy semantics.
    expect(() =>
      requireScope(authExtra(["files:write"]), "files:read")
    ).toThrow(MissingScopeError);
  });
});
