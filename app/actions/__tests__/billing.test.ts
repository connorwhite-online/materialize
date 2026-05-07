/**
 * Tests for the billing server actions. Focused on the
 * customer-dedup invariant — we MUST reuse an existing
 * stripe_customer_id rather than minting a new one each time, or
 * a single user accumulates ghost Stripe customers.
 *
 * Also covers session metadata (the webhook handler keys on
 * metadata.type=billing_setup + metadata.userId, so missing
 * either would silently break the SetupIntent → saved-card path).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = "user-1";
let userRow: Record<string, unknown> | null = null;
const updateSetMock = vi.fn();
const customerCreateMock = vi.fn();
const sessionCreateMock = vi.fn();
const detachMock = vi.fn();
const retrievePMMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
  currentUser: async () => ({
    primaryEmailAddress: { emailAddress: "test@example.com" },
    firstName: "Test",
    lastName: "User",
  }),
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", stripeCustomerId: "stripe_customer_id" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(userRow ? [userRow] : []),
        }),
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
    customers: {
      create: (...args: unknown[]) => customerCreateMock(...args),
    },
    checkout: {
      sessions: {
        create: (...args: unknown[]) => sessionCreateMock(...args),
      },
    },
    paymentMethods: {
      detach: (...args: unknown[]) => detachMock(...args),
      retrieve: (...args: unknown[]) => retrievePMMock(...args),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createBillingSetupSession,
  removePaymentMethod,
  getPaymentMethodSummary,
} from "../billing";

beforeEach(() => {
  mockUserId = "user-1";
  userRow = { stripeCustomerId: null, defaultPaymentMethod: null };
  updateSetMock.mockReset();
  customerCreateMock.mockReset();
  customerCreateMock.mockResolvedValue({ id: "cus_new" });
  sessionCreateMock.mockReset();
  sessionCreateMock.mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/cs_test_xyz",
  });
  detachMock.mockReset();
  detachMock.mockResolvedValue(undefined);
  retrievePMMock.mockReset();
});

describe("createBillingSetupSession", () => {
  it("rejects unauthenticated callers", async () => {
    mockUserId = null;
    const result = await createBillingSetupSession();
    expect("error" in result).toBe(true);
  });

  it("creates a new Stripe customer when none exists, then persists it", async () => {
    userRow = { stripeCustomerId: null };

    const result = await createBillingSetupSession();
    expect("url" in result).toBe(true);

    expect(customerCreateMock).toHaveBeenCalledOnce();
    const customerArgs = customerCreateMock.mock.calls[0][0];
    expect(customerArgs.email).toBe("test@example.com");
    expect(customerArgs.metadata.materialize_user_id).toBe("user-1");

    // Persisted on the user row so subsequent calls reuse it
    expect(updateSetMock).toHaveBeenCalledWith({
      stripeCustomerId: "cus_new",
    });
  });

  it("reuses an existing stripe_customer_id (no duplicate customer creation)", async () => {
    userRow = { stripeCustomerId: "cus_existing" };

    const result = await createBillingSetupSession();
    expect("url" in result).toBe(true);

    expect(customerCreateMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();

    // Session is minted against the existing customer
    const sessionArgs = sessionCreateMock.mock.calls[0][0];
    expect(sessionArgs.customer).toBe("cus_existing");
  });

  it("tags the session with billing_setup metadata so the webhook can route it", async () => {
    userRow = { stripeCustomerId: "cus_existing" };

    await createBillingSetupSession();

    const sessionArgs = sessionCreateMock.mock.calls[0][0];
    expect(sessionArgs.mode).toBe("setup");
    expect(sessionArgs.metadata.type).toBe("billing_setup");
    expect(sessionArgs.metadata.userId).toBe("user-1");
    expect(sessionArgs.payment_method_types).toContain("card");
  });

  it("returns an error if Stripe yields no checkout URL", async () => {
    userRow = { stripeCustomerId: "cus_existing" };
    sessionCreateMock.mockResolvedValue({ url: null });

    const result = await createBillingSetupSession();
    expect("error" in result).toBe(true);
  });
});

describe("removePaymentMethod", () => {
  it("detaches the saved PM and clears the column", async () => {
    userRow = { defaultPaymentMethod: "pm_existing" };
    const result = await removePaymentMethod();

    expect(result).toEqual({ ok: true });
    expect(detachMock).toHaveBeenCalledWith("pm_existing");
    expect(updateSetMock).toHaveBeenCalledWith({
      defaultPaymentMethod: null,
    });
  });

  it("clears the column even when Stripe detach fails (PM may already be gone in Stripe)", async () => {
    userRow = { defaultPaymentMethod: "pm_existing" };
    detachMock.mockRejectedValue(new Error("Resource not found"));

    const result = await removePaymentMethod();
    expect(result).toEqual({ ok: true });
    expect(updateSetMock).toHaveBeenCalledWith({
      defaultPaymentMethod: null,
    });
  });

  it("is a no-op for users with no saved PM", async () => {
    userRow = { defaultPaymentMethod: null };
    const result = await removePaymentMethod();

    expect(result).toEqual({ ok: true });
    expect(detachMock).not.toHaveBeenCalled();
  });
});

describe("getPaymentMethodSummary", () => {
  it("returns null when no PM is on file", async () => {
    userRow = { defaultPaymentMethod: null };
    const result = await getPaymentMethodSummary();
    expect(result).toBeNull();
  });

  it("returns a brand/last4 summary when a PM is on file", async () => {
    userRow = { defaultPaymentMethod: "pm_test" };
    retrievePMMock.mockResolvedValue({
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
    });

    const result = await getPaymentMethodSummary();
    expect(result).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
  });

  it("returns null when Stripe lookup fails (defensive)", async () => {
    userRow = { defaultPaymentMethod: "pm_test" };
    retrievePMMock.mockRejectedValue(new Error("Stripe is down"));

    const result = await getPaymentMethodSummary();
    expect(result).toBeNull();
  });
});
