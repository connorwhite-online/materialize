import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// Per-test fixtures — same shape as handle-listing-purchase's tests.
// `purchaseRow` is what the dedup / lookup SELECT on `purchases`
// returns; `targetListing` resolves the listing name+slug for the
// notification; `buyerRow` resolves the buyer for the notification
// actor.
let purchaseRow: Record<string, unknown> | null = null;
let targetListing: Record<string, unknown> | null = null;
let buyerRow: Record<string, unknown> | null = null;

const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockNotifyRefundOnListing = vi.fn(
  async (_recipientId: string, _payload: unknown) => {}
);

type SelectIntent = "purchase" | "listing" | "user";
let nextSelectIntent: SelectIntent = "purchase";

function rowsForIntent(): unknown[] {
  if (nextSelectIntent === "purchase") {
    return purchaseRow ? [purchaseRow] : [];
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
            then: (resolve: (rows: unknown[]) => unknown) =>
              resolve(rowsForIntent()),
          }),
        };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: (w: unknown) => {
            mockUpdateWhere(w);
            return Promise.resolve();
          },
        };
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
  notifyRefundOnListing: (recipientId: string, payload: unknown) =>
    mockNotifyRefundOnListing(recipientId, payload),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { handleListingRefund } from "../handle-listing-refund";

function makeCharge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    payment_intent: "pi_test_123",
    refunded: true,
    amount: 1000,
    amount_refunded: 1000,
    ...overrides,
  } as Stripe.Charge;
}

beforeEach(() => {
  purchaseRow = {
    id: "purchase_123",
    buyerId: "user_buyer",
    fileId: "file_abc",
    projectId: null,
    amount: 1000,
    status: "completed",
  };
  targetListing = {
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
  mockUpdateSet.mockClear();
  mockUpdateWhere.mockClear();
  mockNotifyRefundOnListing.mockClear();
});

describe("handleListingRefund", () => {
  it("flips status to refunded on a full refund", async () => {
    await handleListingRefund(makeCharge());
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "refunded" });
  });

  it("notifies the creator on success", async () => {
    await handleListingRefund(makeCharge());
    expect(mockNotifyRefundOnListing).toHaveBeenCalledTimes(1);
    expect(mockNotifyRefundOnListing).toHaveBeenCalledWith(
      "user_creator",
      expect.objectContaining({
        actor: expect.objectContaining({ id: "user_buyer" }),
        listing: expect.objectContaining({
          kind: "file",
          name: "Test File",
        }),
        snippet: { amountCents: 1000, currency: "USD" },
      })
    );
  });

  it("routes to project listing when purchase.projectId is set", async () => {
    purchaseRow = {
      id: "purchase_456",
      buyerId: "user_buyer",
      fileId: null,
      projectId: "proj_xyz",
      amount: 2500,
      status: "completed",
    };
    targetListing = {
      name: "Test Project",
      slug: "test-project",
      ownerId: "user_creator",
    };
    await handleListingRefund(makeCharge());
    expect(mockNotifyRefundOnListing).toHaveBeenCalledWith(
      "user_creator",
      expect.objectContaining({
        listing: expect.objectContaining({
          kind: "project",
          slug: "test-project",
        }),
        snippet: { amountCents: 2500, currency: "USD" },
      })
    );
  });

  it("no-ops on partial refunds (amount_refunded < amount)", async () => {
    await handleListingRefund(
      makeCharge({ amount: 1000, amount_refunded: 400, refunded: false })
    );
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyRefundOnListing).not.toHaveBeenCalled();
  });

  it("no-ops on duplicate delivery (status already 'refunded')", async () => {
    purchaseRow = { ...purchaseRow!, status: "refunded" };
    await handleListingRefund(makeCharge());
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyRefundOnListing).not.toHaveBeenCalled();
  });

  it("no-ops when the charge doesn't match any purchases row", async () => {
    // Refund of a print order — purchases table has no matching
    // PaymentIntent so the handler must bail silently rather than
    // 500 the webhook.
    purchaseRow = null;
    await handleListingRefund(makeCharge());
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyRefundOnListing).not.toHaveBeenCalled();
  });

  it("no-ops when the charge has no payment_intent", async () => {
    await handleListingRefund(makeCharge({ payment_intent: null }));
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyRefundOnListing).not.toHaveBeenCalled();
  });
});
