import { describe, it, expect, vi, beforeEach } from "vitest";

// Swappable order row returned by the db.select mock.
let selectedOrder: unknown = null;
// Rows the conditional status UPDATE ... RETURNING reports.
let updateReturns: Array<{ id: string }> = [{ id: "order-id-1" }];
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (selectedOrder ? [selectedOrder] : []),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: (w: unknown) => {
            mockUpdateWhere(w);
            const p = Promise.resolve() as Promise<void> & {
              returning: () => Array<{ id: string }>;
            };
            p.returning = () => updateReturns;
            return p;
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    __name: "printOrders",
    id: "id",
    userId: "user_id",
    status: "status",
  },
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

const mockGetOrderStatus = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  getOrderStatus: (...a: unknown[]) => mockGetOrderStatus(...a),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { requestOrderRefund } from "../print";
import { logError } from "@/lib/logger";

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
    updateReturns = [{ id: "order-id-1" }];
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

describe("requestOrderRefund — MTR-132 agent-order (pi_ prefixed stripeSessionId)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refunds directly via the PaymentIntent id and skips the session lookup", async () => {
    // Agent auto-approved orders store the off-session PaymentIntent id
    // directly in stripeSessionId (lib/mcp/internal/orders.ts:353) —
    // sessions.retrieve("pi_…") would throw, so this path must bypass
    // it entirely and refund the PI id as-is.
    selectedOrder = {
      ...blockedOrder,
      stripeSessionId: "pi_agent_456",
    };

    const res = await requestOrderRefund("order-id-1");

    expect(res).toEqual({ success: true });
    // Never looks up a Checkout session for a PaymentIntent id.
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = mockRefundsCreate.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: "pi_agent_456" });
    expect(opts).toEqual({ idempotencyKey: "print-refund:order-id-1" });
  });

  it("rejects a session_claim: sentinel instead of attempting a refund", async () => {
    selectedOrder = {
      ...blockedOrder,
      stripeSessionId: "session_claim:abc123",
    };

    const res = await requestOrderRefund("order-id-1");

    expect(res).not.toEqual({ success: true });
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

describe("requestOrderRefund — `ordered` orders route to support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturns = [{ id: "order-id-1" }];
  });

  it("refuses a self-service refund for an ordered single-checkout order — CraftCloud has no cancel API, the print may still ship", async () => {
    selectedOrder = {
      ...blockedOrder,
      status: "ordered",
      craftCloudOrderId: "cc-live",
    };

    const res = await requestOrderRefund("order-id-1");

    if (!("error" in res)) throw new Error("expected error");
    expect(res.error).toMatch(/support@materialize\.cc/);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
    // No live CraftCloud read either — nothing about the answer depends on it.
    expect(mockGetOrderStatus).not.toHaveBeenCalled();
  });

  it("refuses statuses past blocked/ordered without touching Stripe", async () => {
    selectedOrder = { ...blockedOrder, status: "in_production" };

    const res = await requestOrderRefund("order-id-1");

    expect(res).toEqual({ error: "This order can't be refunded at this stage" });
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

describe("requestOrderRefund — conditional status write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...blockedOrder };
    updateReturns = [{ id: "order-id-1" }];
  });

  it("only flips the row to refunded while it is still blocked", async () => {
    await requestOrderRefund("order-id-1");

    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "refunded" });
    // The WHERE is a drizzle SQL object; its serialized chunks name the
    // status column guard alongside the id.
    const where = JSON.stringify(mockUpdateWhere.mock.calls[0][0], (_k, v) =>
      typeof v === "object" && v !== null && "table" in v ? undefined : v
    );
    expect(where).toContain("status");
    expect(where).toContain("blocked");
  });

  it("logs (and still reports success) when the fulfillment cron moved the row first", async () => {
    updateReturns = [];

    const res = await requestOrderRefund("order-id-1");

    expect(res).toEqual({ success: true });
    expect(logError).toHaveBeenCalledWith(
      "requestOrderRefund.statusWriteLost",
      expect.any(Error)
    );
  });
});
