import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Per-caller caps on public, upstream-costly endpoints. The properties
 * pinned here are the ones a regression would quietly break:
 *   - the limiter fails OPEN (it sits in front of checkout),
 *   - IPv6 callers are keyed on their /64, not the full address,
 *   - signed-in callers are keyed by user id, not their (shared) IP,
 *   - the request that crosses the limit is the first one refused.
 */

const returningMock = vi.fn();
const valuesMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        valuesMock(v);
        return {
          onConflictDoUpdate: () => ({ returning: () => returningMock() }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  rateLimitCounters: {
    bucket: "bucket",
    windowStart: "window_start",
    count: "count",
  },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  consumeRateLimit,
  rateLimitAddress,
  rateLimitCallerKey,
  windowStartFor,
  RATE_LIMITS,
} from "../index";

const policy = { name: "test", limit: 3, windowMs: 60_000 };

describe("rateLimitAddress", () => {
  it("passes IPv4 through", () => {
    expect(rateLimitAddress("203.0.113.9")).toBe("203.0.113.9");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(rateLimitAddress("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("collapses every address in one /64 to the same key", () => {
    const a = rateLimitAddress("2001:db8:abcd:12::1");
    const b = rateLimitAddress("2001:0db8:abcd:0012:ffff:ffff:ffff:fffe");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
  });

  it("keeps different /64s apart", () => {
    expect(rateLimitAddress("2001:db8:abcd:12::1")).not.toBe(
      rateLimitAddress("2001:db8:abcd:13::1")
    );
  });

  it("handles a leading :: and zone ids", () => {
    expect(rateLimitAddress("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
});

describe("rateLimitCallerKey", () => {
  it("keys signed-in callers by user id, ignoring the IP", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9" });
    expect(rateLimitCallerKey(h, "user_1")).toBe("u:user_1");
  });

  it("keys anon callers by a hash, never the raw address", () => {
    const key = rateLimitCallerKey(
      new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }),
      null
    );
    expect(key).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.9");
  });

  it("gives two hosts in one /64 the same key", () => {
    const k = (ip: string) =>
      rateLimitCallerKey(new Headers({ "x-forwarded-for": ip }), null);
    expect(k("2001:db8::1")).toBe(k("2001:db8::2"));
  });

  it("returns null with no attributable caller", () => {
    expect(rateLimitCallerKey(new Headers(), null)).toBeNull();
  });
});

describe("consumeRateLimit", () => {
  beforeEach(() => {
    returningMock.mockReset();
    valuesMock.mockReset();
  });

  it("allows up to the limit and refuses the next request", async () => {
    returningMock.mockResolvedValueOnce([{ count: 3 }]);
    expect(await consumeRateLimit(policy, "ip:a", 0)).toEqual({ ok: true });

    returningMock.mockResolvedValueOnce([{ count: 4 }]);
    expect(await consumeRateLimit(policy, "ip:a", 15_000)).toEqual({
      ok: false,
      retryAfterSeconds: 45,
    });
  });

  it("counts into the window the request falls in", async () => {
    returningMock.mockResolvedValueOnce([{ count: 1 }]);
    await consumeRateLimit(policy, "ip:a", 125_000);
    expect(valuesMock).toHaveBeenCalledWith({
      bucket: "test:ip:a",
      windowStart: new Date(120_000),
      count: 1,
    });
  });

  it("fails open on a database error", async () => {
    returningMock.mockRejectedValueOnce(new Error("db down"));
    expect(await consumeRateLimit(policy, "ip:a")).toEqual({ ok: true });
  });

  it("allows an unattributable caller without touching the database", async () => {
    expect(await consumeRateLimit(policy, null)).toEqual({ ok: true });
    expect(valuesMock).not.toHaveBeenCalled();
  });
});

describe("policies", () => {
  it("windowStartFor floors to the window", () => {
    expect(windowStartFor(119_999, 60_000)).toBe(60_000);
  });

  it("leaves the quote poll far above one quote's worth of polls", () => {
    // poll-quotes.ts: 1.5s interval, 90s hard ceiling → ≤60 polls/quote.
    // A 429 counts toward the client's stale-priceId bail, so a real
    // buyer must never get near this.
    const pollsPerQuote = 90_000 / 1_500;
    const quotesAllowed = RATE_LIMITS.quoteStart.limit;
    expect(RATE_LIMITS.quotePoll.windowMs).toBe(RATE_LIMITS.quoteStart.windowMs);
    expect(RATE_LIMITS.quotePoll.limit).toBeGreaterThanOrEqual(
      pollsPerQuote * (quotesAllowed / 3)
    );
  });
});
