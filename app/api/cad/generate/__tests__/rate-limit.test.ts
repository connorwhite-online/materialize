import { describe, it, expect, vi, beforeEach } from "vitest";

// Configurable rows returned by the mocked select chain.
let rows: Array<{ count: number; oldest: string | null }> = [];
let shouldThrow = false;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          if (shouldThrow) return Promise.reject(new Error("db down"));
          return Promise.resolve(rows);
        },
      }),
    }),
  },
}));

// Schema is only referenced for column handles inside the sql`` template.
vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    userId: "user_id",
    createdAt: "created_at",
  },
}));

import {
  resolveCadRateLimitConfig,
  checkCadGenerateRateLimit,
} from "../rate-limit";

beforeEach(() => {
  rows = [];
  shouldThrow = false;
});

describe("resolveCadRateLimitConfig", () => {
  it("uses generous defaults when env is unset", () => {
    const cfg = resolveCadRateLimitConfig({} as NodeJS.ProcessEnv);
    expect(cfg.limit).toBe(40);
    expect(cfg.windowMs).toBe(10 * 60_000);
  });

  it("reads positive overrides from env", () => {
    const cfg = resolveCadRateLimitConfig({
      CAD_GENERATE_MAX_PER_WINDOW: "5",
      CAD_GENERATE_WINDOW_MINUTES: "2",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.limit).toBe(5);
    expect(cfg.windowMs).toBe(2 * 60_000);
  });

  it("falls back (not disables) on non-positive / garbage values", () => {
    const cfg = resolveCadRateLimitConfig({
      CAD_GENERATE_MAX_PER_WINDOW: "0",
      CAD_GENERATE_WINDOW_MINUTES: "-3",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.limit).toBe(40);
    expect(cfg.windowMs).toBe(10 * 60_000);
  });
});

describe("checkCadGenerateRateLimit", () => {
  const config = { limit: 3, windowMs: 60_000 };
  const now = 1_000_000_000_000;

  it("allows when under the cap", async () => {
    rows = [{ count: 2, oldest: new Date(now - 30_000).toISOString() }];
    const res = await checkCadGenerateRateLimit("u1", now, config);
    expect(res.ok).toBe(true);
  });

  it("allows at exactly limit-1", async () => {
    rows = [{ count: 2, oldest: null }];
    const res = await checkCadGenerateRateLimit("u1", now, config);
    expect(res.ok).toBe(true);
  });

  it("rejects at the cap with a precise retry-after", async () => {
    // Oldest row is 40s into a 60s window → 20s until a slot frees.
    const oldest = new Date(now - 40_000).toISOString();
    rows = [{ count: 3, oldest }];
    const res = await checkCadGenerateRateLimit("u1", now, config);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.count).toBe(3);
      expect(res.limit).toBe(3);
      expect(res.windowMinutes).toBe(1);
      expect(res.retryAfterSeconds).toBe(20);
    }
  });

  it("retry-after is at least 1 second", async () => {
    // Oldest exactly at the window edge → would compute 0, clamped to 1.
    rows = [{ count: 5, oldest: new Date(now - 60_000).toISOString() }];
    const res = await checkCadGenerateRateLimit("u1", now, config);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSeconds).toBe(1);
  });

  it("fails open on a DB error", async () => {
    shouldThrow = true;
    const res = await checkCadGenerateRateLimit("u1", now, config);
    expect(res.ok).toBe(true);
  });

  it("treats an empty result as zero count", async () => {
    rows = [];
    const res = await checkCadGenerateRateLimit("u1", now, config);
    expect(res.ok).toBe(true);
  });
});
