/**
 * Tests for the paid-listing checkout server action.
 *
 * Focus is on the gates that decide whether to mint a Stripe
 * Checkout session at all — a wrong-allow on any of these would
 * either route money to the wrong account (creator not onboarded)
 * or let a buyer double-pay for a listing they already own.
 *
 * The happy path itself is a thin pass-through to the Stripe SDK,
 * so the assertion there is just that we got `{ url }` back and
 * the SDK was called with sane shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = "user_buyer";
let listingRow: Record<string, unknown> | null = null;
let ownsListing = false;
const sessionCreateMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => (listingRow ? [listingRow] : []),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { id: "id" },
  projects: { id: "id" },
  users: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...xs: unknown[]) => ({ and: xs }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => sessionCreateMock(...args),
      },
    },
  }),
}));

const ownsFileMock = vi.fn();
const ownsProjectMock = vi.fn();
vi.mock("@/lib/entitlement", () => ({
  userOwnsFile: (...args: unknown[]) => ownsFileMock(...args),
  userOwnsProject: (...args: unknown[]) => ownsProjectMock(...args),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { createListingCheckoutSession } from "../checkout";

const HEALTHY_FILE = {
  id: "file_abc",
  name: "Test File",
  slug: "test-file",
  price: 1000,
  ownerId: "user_creator",
  status: "published",
  visibility: "public",
  thumbnailUrl: null,
  stripeAccountId: "acct_creator",
  stripeOnboardingComplete: true,
};

beforeEach(() => {
  mockUserId = "user_buyer";
  listingRow = HEALTHY_FILE;
  ownsListing = false;
  sessionCreateMock.mockReset();
  sessionCreateMock.mockResolvedValue({
    url: "https://stripe.test/checkout/cs_test_xyz",
  });
  ownsFileMock.mockReset();
  ownsProjectMock.mockReset();
  ownsFileMock.mockImplementation(async () => ownsListing);
  ownsProjectMock.mockImplementation(async () => ownsListing);
});

describe("createListingCheckoutSession", () => {
  it("returns a checkout URL on the happy path", async () => {
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect("url" in res).toBe(true);
    if (!("url" in res)) return;
    expect(res.url).toMatch(/stripe\.test\/checkout/);
    expect(sessionCreateMock).toHaveBeenCalledTimes(1);
    const args = sessionCreateMock.mock.calls[0][0];
    // 3% of $10.00 = 30 cents
    expect(args.payment_intent_data.application_fee_amount).toBe(30);
    expect(args.payment_intent_data.transfer_data.destination).toBe(
      "acct_creator"
    );
    expect(args.metadata.type).toBe("listing_purchase");
    expect(args.metadata.listingType).toBe("file");
    expect(args.metadata.listingId).toBe("file_abc");
    expect(args.metadata.amount).toBe("1000");
    expect(args.metadata.serviceFee).toBe("30");
  });

  it("rejects anon viewers with a sign-in message", async () => {
    mockUserId = null;
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/sign in/i) });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when no listing param is provided", async () => {
    const res = await createListingCheckoutSession({});
    expect(res).toEqual({ error: expect.stringMatching(/listing/i) });
  });

  it("rejects both params being set at once", async () => {
    const res = await createListingCheckoutSession({
      fileId: "file_abc",
      projectId: "proj_xyz",
    });
    expect(res).toEqual({ error: expect.stringMatching(/one/i) });
  });

  it("rejects when listing is not found", async () => {
    listingRow = null;
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/not found/i) });
  });

  it("rejects when the buyer is the listing owner", async () => {
    mockUserId = "user_creator";
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/own/i) });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when the listing is free (price=0)", async () => {
    listingRow = { ...HEALTHY_FILE, price: 0 };
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/free/i) });
  });

  it("rejects when the creator hasn't onboarded payouts", async () => {
    listingRow = { ...HEALTHY_FILE, stripeOnboardingComplete: false };
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({
      error: expect.stringMatching(/payouts/i),
    });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when the creator has no Stripe account", async () => {
    listingRow = { ...HEALTHY_FILE, stripeAccountId: null };
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({
      error: expect.stringMatching(/payouts/i),
    });
  });

  it("rejects when the buyer already owns the listing", async () => {
    ownsListing = true;
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/already/i) });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects unpublished listings", async () => {
    listingRow = { ...HEALTHY_FILE, status: "draft" };
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/not found/i) });
  });

  it("rejects private listings", async () => {
    listingRow = { ...HEALTHY_FILE, visibility: "private" };
    const res = await createListingCheckoutSession({ fileId: "file_abc" });
    expect(res).toEqual({ error: expect.stringMatching(/not found/i) });
  });

  it("routes the project path through userOwnsProject", async () => {
    listingRow = {
      ...HEALTHY_FILE,
      id: "proj_xyz",
      name: "Test Project",
      slug: "test-project",
      price: 2500,
    };
    ownsListing = true; // verifies the project entitlement helper is consulted
    const res = await createListingCheckoutSession({ projectId: "proj_xyz" });
    expect(res).toEqual({ error: expect.stringMatching(/already/i) });
    expect(ownsProjectMock).toHaveBeenCalledWith("user_buyer", "proj_xyz");
    expect(ownsFileMock).not.toHaveBeenCalled();
  });

  it("encodes a project's metadata.listingType correctly", async () => {
    listingRow = {
      ...HEALTHY_FILE,
      id: "proj_xyz",
      slug: "test-project",
      price: 2500,
    };
    await createListingCheckoutSession({ projectId: "proj_xyz" });
    const args = sessionCreateMock.mock.calls[0][0];
    expect(args.metadata.listingType).toBe("project");
    expect(args.metadata.listingId).toBe("proj_xyz");
    // 3% of $25 = 75 cents
    expect(args.payment_intent_data.application_fee_amount).toBe(75);
  });
});
