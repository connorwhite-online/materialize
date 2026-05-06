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

import { verifyMaterializeToken } from "../auth";

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
