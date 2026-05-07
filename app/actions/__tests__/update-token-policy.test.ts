/**
 * Tests for updateTokenSpendingPolicy. The Zod schema has a few
 * cross-field invariants worth pinning:
 *   - period budget >= per-order limit
 *   - confirm-above <= per-order limit
 *   - cancellationWindowMinutes in [0, 60]
 *   - all amounts >= 50 cents
 *
 * Plus the auth + ownership boundary: a user can only edit policies
 * on their own tokens (the WHERE clause restricts by userId).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = "user-1";
let updateReturning: Array<{ id: string }> = [];
const updateSetMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  personalAccessTokens: {
    id: "id",
    userId: "user_id",
    spendingPolicy: "spending_policy",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updateSetMock(s);
        return {
          where: () => ({
            returning: () => Promise.resolve(updateReturning),
          }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/mcp/tokens", () => ({ generateToken: vi.fn() }));
vi.mock("@/lib/mcp/scopes", () => ({
  isValidScope: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateTokenSpendingPolicy } from "../tokens";

const validPolicy = {
  perOrderLimitCents: 5000,
  periodBudgetCents: 20000,
  periodWindow: "month" as const,
};

beforeEach(() => {
  mockUserId = "user-1";
  updateReturning = [{ id: "tok-1" }];
  updateSetMock.mockReset();
});

describe("updateTokenSpendingPolicy", () => {
  it("rejects unauthenticated callers", async () => {
    mockUserId = null;
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: validPolicy,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected reject");
    expect(result.error).toMatch(/unauthorized/i);
  });

  it("accepts a valid policy", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: validPolicy,
    });
    expect(result).toEqual({ ok: true });
    expect(updateSetMock).toHaveBeenCalledWith({
      spendingPolicy: validPolicy,
    });
  });

  it("accepts null (clearing the policy)", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: null,
    });
    expect(result).toEqual({ ok: true });
    expect(updateSetMock).toHaveBeenCalledWith({ spendingPolicy: null });
  });

  it("rejects when period budget is less than per-order limit", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: { ...validPolicy, periodBudgetCents: 1000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected reject");
    expect(result.error).toMatch(/period budget/i);
  });

  it("rejects when confirmAboveCents exceeds per-order limit", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: {
        ...validPolicy,
        confirmAboveCents: 6000, // > perOrderLimitCents
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected reject");
    expect(result.error).toMatch(/confirm/i);
  });

  it("rejects amounts below the floor (50¢)", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: { ...validPolicy, perOrderLimitCents: 10 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects cancellationWindowMinutes above the cap (60)", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: { ...validPolicy, cancellationWindowMinutes: 90 },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a 0-minute cancellation window (instant fulfillment)", async () => {
    const result = await updateTokenSpendingPolicy({
      tokenId: "tok-1",
      policy: { ...validPolicy, cancellationWindowMinutes: 0 },
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns 'token not found' when the WHERE filter matches no rows", async () => {
    updateReturning = [];
    const result = await updateTokenSpendingPolicy({
      tokenId: "someone-elses-token",
      policy: validPolicy,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected reject");
    expect(result.error).toMatch(/not found/i);
  });
});
