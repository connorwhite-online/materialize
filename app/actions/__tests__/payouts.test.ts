/**
 * Tests for the Stripe Connect payouts server actions. Focus is on
 * the account-creation invariant — we MUST reuse an existing
 * stripeAccountId rather than minting a new one each time, or a
 * single creator accumulates ghost Connect accounts the same way
 * billing.ts would accumulate Customers without dedup.
 *
 * Also covers the refresh-from-Stripe path that reconciles the
 * cached `stripeOnboardingComplete` flag — the payouts settings
 * page calls it on return-from-onboarding so the UI doesn't depend
 * on the account.updated webhook arriving first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = "user_creator";
let userRow: Record<string, unknown> | null = null;
let stripeAccount: Record<string, unknown> = {};
const accountCreateMock = vi.fn();
const accountLinkCreateMock = vi.fn();
const loginLinkCreateMock = vi.fn();
const updateSetMock = vi.fn();
const accountRetrieveMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  users: {
    id: "id",
    stripeAccountId: "stripe_account_id",
    stripeOnboardingComplete: "stripe_onboarding_complete",
    displayName: "display_name",
    username: "username",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(userRow ? [userRow] : []),
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updateSetMock(s);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    accounts: {
      create: (...args: unknown[]) => accountCreateMock(...args),
      retrieve: (...args: unknown[]) => accountRetrieveMock(...args),
      createLoginLink: (...args: unknown[]) => loginLinkCreateMock(...args),
    },
    accountLinks: {
      create: (...args: unknown[]) => accountLinkCreateMock(...args),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  getStripePayoutStatus,
  createStripePayoutOnboardingLink,
  refreshStripePayoutStatus,
  createStripePayoutDashboardLink,
} from "../payouts";

beforeEach(() => {
  mockUserId = "user_creator";
  userRow = {
    stripeAccountId: null,
    onboardingComplete: false,
    displayName: "Creator",
    username: "creator",
  };
  stripeAccount = {
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements: { disabled_reason: null, currently_due: [] },
  };
  accountCreateMock.mockReset();
  accountCreateMock.mockResolvedValue({ id: "acct_new" });
  accountLinkCreateMock.mockReset();
  accountLinkCreateMock.mockResolvedValue({
    url: "https://stripe.test/connect/onboarding",
  });
  loginLinkCreateMock.mockReset();
  loginLinkCreateMock.mockResolvedValue({
    url: "https://stripe.test/dashboard",
  });
  accountRetrieveMock.mockReset();
  accountRetrieveMock.mockImplementation(async () => stripeAccount);
  updateSetMock.mockReset();
});

describe("getStripePayoutStatus", () => {
  it("returns empty status for anon viewers", async () => {
    mockUserId = null;
    const status = await getStripePayoutStatus();
    expect(status).toEqual({
      connected: false,
      onboarded: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      disabledReason: null,
      pendingRequirements: 0,
    });
  });

  it("reflects the cached onboardingComplete flag", async () => {
    userRow = {
      stripeAccountId: "acct_creator",
      onboardingComplete: true,
    };
    const status = await getStripePayoutStatus();
    expect(status.connected).toBe(true);
    expect(status.onboarded).toBe(true);
  });
});

describe("createStripePayoutOnboardingLink", () => {
  it("creates a new Connect Express account on first call", async () => {
    const res = await createStripePayoutOnboardingLink();
    expect("url" in res).toBe(true);
    expect(accountCreateMock).toHaveBeenCalledTimes(1);
    const args = accountCreateMock.mock.calls[0][0];
    expect(args.type).toBe("express");
    expect(args.capabilities?.transfers?.requested).toBe(true);
    expect(args.capabilities?.card_payments?.requested).toBe(true);
    expect(args.metadata?.userId).toBe("user_creator");
    // The action MUST persist the new stripeAccountId back to the
    // users row, or a refresh later would create a second Connect
    // account — exactly the bug billing.ts had with Customers.
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeAccountId: "acct_new" })
    );
  });

  it("reuses an existing stripeAccountId — never mints a duplicate", async () => {
    userRow = {
      stripeAccountId: "acct_existing",
      displayName: "Creator",
      username: "creator",
    };
    const res = await createStripePayoutOnboardingLink();
    expect("url" in res).toBe(true);
    expect(accountCreateMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
    // Account link is created against the existing id.
    const linkArgs = accountLinkCreateMock.mock.calls[0][0];
    expect(linkArgs.account).toBe("acct_existing");
  });

  it("rejects anon viewers", async () => {
    mockUserId = null;
    const res = await createStripePayoutOnboardingLink();
    expect(res).toEqual({ error: expect.stringMatching(/unauth/i) });
    expect(accountCreateMock).not.toHaveBeenCalled();
  });
});

describe("refreshStripePayoutStatus", () => {
  it("returns empty when there's no connected account", async () => {
    userRow = { stripeAccountId: null, onboardingComplete: false };
    const status = await refreshStripePayoutStatus();
    expect(status.connected).toBe(false);
    expect(accountRetrieveMock).not.toHaveBeenCalled();
  });

  it("syncs charges_enabled / payouts_enabled from Stripe", async () => {
    userRow = {
      stripeAccountId: "acct_creator",
      onboardingComplete: false,
    };
    stripeAccount = {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [] },
    };
    const status = await refreshStripePayoutStatus();
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(true);
    expect(status.onboarded).toBe(true);
    // When the cached flag was stale we MUST persist the new value
    // so the next page load doesn't re-do this network call to
    // arrive at the same answer.
    expect(updateSetMock).toHaveBeenCalledWith({
      stripeOnboardingComplete: true,
    });
  });

  it("surfaces disabled_reason + pendingRequirements when Stripe restricts the account", async () => {
    userRow = {
      stripeAccountId: "acct_creator",
      onboardingComplete: true,
    };
    stripeAccount = {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        disabled_reason: "requirements.past_due",
        currently_due: ["individual.id_number", "tos_acceptance.date"],
      },
    };
    const status = await refreshStripePayoutStatus();
    expect(status.chargesEnabled).toBe(false);
    expect(status.disabledReason).toBe("requirements.past_due");
    expect(status.pendingRequirements).toBe(2);
    expect(status.detailsSubmitted).toBe(true);
  });

  it("does not write to the DB when the cached flag already matches", async () => {
    userRow = {
      stripeAccountId: "acct_creator",
      onboardingComplete: true,
    };
    stripeAccount = {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [] },
    };
    await refreshStripePayoutStatus();
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});

describe("createStripePayoutDashboardLink", () => {
  it("creates a login link against the user's connected account", async () => {
    userRow = { stripeAccountId: "acct_creator" };
    const res = await createStripePayoutDashboardLink();
    expect("url" in res).toBe(true);
    expect(loginLinkCreateMock).toHaveBeenCalledWith("acct_creator");
  });

  it("errors when the user isn't connected yet", async () => {
    userRow = { stripeAccountId: null };
    const res = await createStripePayoutDashboardLink();
    expect(res).toEqual({ error: expect.stringMatching(/not connected/i) });
    expect(loginLinkCreateMock).not.toHaveBeenCalled();
  });
});
