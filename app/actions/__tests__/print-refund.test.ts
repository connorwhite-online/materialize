import { describe, it, expect, vi, beforeEach } from "vitest";

// Swappable order row returned by the db.select mock.
let selectedOrder: unknown = null;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (selectedOrder ? [selectedOrder] : []),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: { __name: "printOrders", id: "id", userId: "user_id" },
}));

const mockRefundsCreate = vi.fn(
  (_params: unknown, _opts?: unknown) => Promise.resolve({ id: "re_1" })
);
const mockSessionRetrieve = vi.fn((_id: unknown) =>
  Promise.resolve({ payment_intent: "pi_123" })
);

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: { retrieve: (id: unknown) => mockSessionRetrieve(id) },
    },
    refunds: {
      create: (params: unknown, opts?: unknown) =>
        mockRefundsCreate(params, opts),
    },
  }),
}));

vi.mock("@/lib/craftcloud/client", () => ({
  getOrderStatus: vi.fn(),
}));

import { requestOrderRefund } from "../print";

const blockedOrder = {
  id: "order-id-1",
  userId: "test-user-id",
  status: "blocked", // skips the live-status check; goes straight to refund
  craftCloudOrderId: null,
  stripeSessionId: "sess_1",
  checkoutModel: "single" as string | null,
};

describe("requestOrderRefund — refund idempotency (CON-46)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...blockedOrder };
  });

  it("issues the refund with a deterministic per-order idempotency key", async () => {
    const res = await requestOrderRefund("order-id-1");

    expect(res).toEqual({ success: true });
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);

    const [params, opts] = mockRefundsCreate.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: "pi_123" });
    // The key is what makes a double-click / retry dedupe at Stripe
    // rather than issuing a second refund.
    expect(opts).toEqual({ idempotencyKey: "print-refund:order-id-1" });
  });

  it("uses the same key across repeated calls for the same order", async () => {
    await requestOrderRefund("order-id-1");
    await requestOrderRefund("order-id-1");

    const keys = mockRefundsCreate.mock.calls.map(
      (c) => (c[1] as { idempotencyKey: string }).idempotencyKey
    );
    expect(keys).toEqual([
      "print-refund:order-id-1",
      "print-refund:order-id-1",
    ]);
  });
});

describe("requestOrderRefund — CON-160 two_step guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks self-service refund for two_step orders and does NOT flip status to refunded", async () => {
    selectedOrder = {
      ...blockedOrder,
      checkoutModel: "two_step",
      status: "ordered",
    };

    const res = await requestOrderRefund("order-id-1");

    // Must return an error routing to support — NOT success.
    expect(res).not.toEqual({ success: true });
    if (!("error" in res)) throw new Error("expected error");
    expect(res.error).toMatch(/two-step|support/i);

    // Must NOT issue a refund (would only refund the 3% fee).
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    // Must NOT flip the row to `refunded`.
    // (The db.update mock here doesn't capture the set values, but we
    // verify by checking the session was never retrieved — no attempt
    // to look up the PI from the Stripe session.)
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
  });

  it("single-checkout blocked order still refunds as before", async () => {
    selectedOrder = { ...blockedOrder, checkoutModel: "single" };

    const res = await requestOrderRefund("order-id-1");

    expect(res).toEqual({ success: true });
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });
});
