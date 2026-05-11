import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// Per-test fixtures:
//   - existingPurchase: row returned by the dedup SELECT on
//     `purchases` (null = first delivery, otherwise = duplicate)
//   - targetListing: row returned by the SELECT on files/projects to
//     resolve the listing's owner + display fields (null = listing
//     deleted between checkout and webhook)
//   - buyerRow: row returned by the SELECT on users to resolve the
//     buyer's identity for the notification (null = best-effort
//     swallow path)
let existingPurchase: Record<string, unknown> | null = null;
let targetListing: Record<string, unknown> | null = null;
let buyerRow: Record<string, unknown> | null = null;

// Spies to assert what the handler tried to write.
const mockInsertValues = vi.fn();
const mockNotifyPurchaseOnListing = vi.fn(async () => {});

// Distinguishes which table each chained select is reading from —
// the handler does three reads (purchases, target listing, buyer)
// and we need each to return its own row shape.
type SelectIntent = "purchase" | "listing" | "user";
let nextSelectIntent: SelectIntent = "purchase";

function rowsForIntent(): unknown[] {
  if (nextSelectIntent === "purchase") {
    return existingPurchase ? [existingPurchase] : [];
  }
  if (nextSelectIntent === "user") {
    return buyerRow ? [buyerRow] : [];
  }
  return targetListing ? [targetListing] : [];
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name: string }) => {
        nextSelectIntent =
          table.__name === "purchases"
            ? "purchase"
            : table.__name === "users"
              ? "user"
              : "listing";
        return {
          where: () => ({
            limit: () => rowsForIntent(),
            // Awaiting the .where() result (no .limit() / no .then() chain)
            // — drizzle returns a thenable on the builder so the test
            // mock needs to be one too.
            then: (resolve: (rows: unknown[]) => unknown) =>
              resolve(rowsForIntent()),
          }),
        };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        mockInsertValues(v);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  purchases: { __name: "purchases", id: "id", stripePaymentIntentId: "pi" },
  files: { __name: "files", id: "id" },
  projects: { __name: "projects", id: "id" },
  users: { __name: "users", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...xs: unknown[]) => ({ and: xs }),
}));

vi.mock("@/lib/notifications/notify", () => ({
  notifyPurchaseOnListing: (
    recipientId: string,
    payload: unknown
  ) => mockNotifyPurchaseOnListing(recipientId, payload),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { handleListingPurchase } from "../handle-listing-purchase";

function makeSession(overrides: Partial<Stripe.Checkout.Session> = {}) {
  return {
    payment_intent: "pi_test_123",
    metadata: {
      type: "listing_purchase",
      buyerId: "user_buyer",
      listingType: "file",
      listingId: "file_abc",
      amount: "1000",
      serviceFee: "30",
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

beforeEach(() => {
  existingPurchase = null;
  targetListing = {
    id: "file_abc",
    name: "Test File",
    slug: "test-file",
    ownerId: "user_creator",
  };
  buyerRow = {
    id: "user_buyer",
    username: "buyer",
    displayName: "Buyer",
    avatarUrl: null,
  };
  nextSelectIntent = "purchase";
  mockInsertValues.mockClear();
  mockNotifyPurchaseOnListing.mockClear();
});

describe("handleListingPurchase", () => {
  it("inserts a completed purchases row on first delivery", async () => {
    await handleListingPurchase(makeSession());
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerId: "user_buyer",
        fileId: "file_abc",
        projectId: null,
        amount: 1000,
        serviceFee: 30,
        creatorPayout: 970,
        stripePaymentIntentId: "pi_test_123",
        status: "completed",
      })
    );
  });

  it("routes project listings to projectId, not fileId", async () => {
    targetListing = {
      id: "proj_xyz",
      name: "Test Project",
      slug: "test-project",
      ownerId: "user_creator",
    };
    await handleListingPurchase(
      makeSession({
        metadata: {
          type: "listing_purchase",
          buyerId: "user_buyer",
          listingType: "project",
          listingId: "proj_xyz",
          amount: "2500",
          serviceFee: "75",
        },
      })
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: null,
        projectId: "proj_xyz",
        amount: 2500,
        creatorPayout: 2425,
      })
    );
  });

  it("skips insert on duplicate delivery (dedup by paymentIntentId)", async () => {
    existingPurchase = { id: "existing_purchase" };
    await handleListingPurchase(makeSession());
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockNotifyPurchaseOnListing).not.toHaveBeenCalled();
  });

  it("notifies the creator on success", async () => {
    await handleListingPurchase(makeSession());
    expect(mockNotifyPurchaseOnListing).toHaveBeenCalledTimes(1);
    expect(mockNotifyPurchaseOnListing).toHaveBeenCalledWith(
      "user_creator",
      expect.objectContaining({
        actor: expect.objectContaining({ id: "user_buyer" }),
        listing: expect.objectContaining({
          kind: "file",
          name: "Test File",
          slug: "test-file",
        }),
        snippet: { amountCents: 1000, currency: "USD" },
      })
    );
  });

  it("throws when buyerId is missing", async () => {
    const session = makeSession({
      metadata: {
        type: "listing_purchase",
        listingType: "file",
        listingId: "file_abc",
        amount: "1000",
        serviceFee: "30",
      },
    });
    await expect(handleListingPurchase(session)).rejects.toThrow(/buyer/i);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("throws when listingType is invalid", async () => {
    const session = makeSession({
      metadata: {
        type: "listing_purchase",
        buyerId: "user_buyer",
        listingType: "collection", // not a real target kind
        listingId: "x",
        amount: "1000",
        serviceFee: "30",
      },
    });
    await expect(handleListingPurchase(session)).rejects.toThrow(
      /listingType/i
    );
  });

  it("throws when amount is non-numeric", async () => {
    const session = makeSession({
      metadata: {
        type: "listing_purchase",
        buyerId: "user_buyer",
        listingType: "file",
        listingId: "file_abc",
        amount: "free",
        serviceFee: "0",
      },
    });
    await expect(handleListingPurchase(session)).rejects.toThrow(/amount/i);
  });

  it("throws when payment_intent is missing", async () => {
    const session = makeSession({ payment_intent: null });
    await expect(handleListingPurchase(session)).rejects.toThrow(
      /payment_intent/i
    );
  });
});
