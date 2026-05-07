/**
 * Tests for cancelAutoApprovedOrder. Covers the time-gate, atomic
 * status flip, and refund/ledger cleanup. The refund + ledger
 * delete are best-effort — failures must NOT roll back the
 * cancellation, since the user already saw success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Configurable per-test
let mockUserId: string | null = "user-1";
let orderRow: Record<string, unknown> | null = null;
let updateClaimRows: Array<{ id: string }> = [];

const refundCreateMock = vi.fn();
const sendCancellationEmailMock = vi.fn();
const ledgerDeleteCalls: unknown[] = [];

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: { id: "id", userId: "user_id", status: "status" },
  fileAssets: { id: "id" },
  files: { id: "id" },
  tokenSpendingLedger: { printOrderId: "print_order_id" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(orderRow ? [orderRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateClaimRows),
        }),
      }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        ledgerDeleteCalls.push(w);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    refunds: {
      create: (...args: unknown[]) => refundCreateMock(...args),
    },
  }),
}));

vi.mock("@/lib/mcp/email", () => ({
  sendCancellationConfirmedEmail: (...args: unknown[]) =>
    sendCancellationEmailMock(...args),
}));

vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: vi.fn(),
  findProvider: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { cancelAutoApprovedOrder } from "../agent-orders";

beforeEach(() => {
  mockUserId = "user-1";
  orderRow = null;
  updateClaimRows = [];
  refundCreateMock.mockReset();
  refundCreateMock.mockResolvedValue({ id: "re_test" });
  sendCancellationEmailMock.mockReset();
  sendCancellationEmailMock.mockResolvedValue({ ok: true });
  ledgerDeleteCalls.length = 0;
});

const futureWindow = () => new Date(Date.now() + 5 * 60_000);
const pastWindow = () => new Date(Date.now() - 60_000);

const baseOrder = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: "order-1",
  userId: "user-1",
  confirmationToken: "tok-correct",
  status: "auto_approved",
  autoApprovedUntil: futureWindow(),
  stripeSessionId: "pi_test",
  totalPrice: 5000,
  serviceFee: 150,
  ...overrides,
});

describe("cancelAutoApprovedOrder", () => {
  it("rejects when the user is not signed in", async () => {
    mockUserId = null;
    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    expect("error" in result).toBe(true);
  });

  it("rejects when the order does not exist", async () => {
    orderRow = null;
    const result = await cancelAutoApprovedOrder({
      orderId: "missing",
      confirmationToken: "tok-correct",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/not found/i);
  });

  it("rejects when the confirmation token does not match", async () => {
    orderRow = baseOrder({ confirmationToken: "tok-different" });
    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/invalid/i);
    expect(refundCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when the order is already cancelled", async () => {
    orderRow = baseOrder({ status: "cancelled" });
    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/already cancelled/i);
    expect(refundCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when fulfillment has started (status past auto_approved)", async () => {
    orderRow = baseOrder({ status: "ordered" });
    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/no longer be cancelled|fulfillment/i);
    expect(refundCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when the cancellation window has passed", async () => {
    orderRow = baseOrder({ autoApprovedUntil: pastWindow() });
    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/window has closed/i);
    expect(refundCreateMock).not.toHaveBeenCalled();
  });

  it("happy path: flips status, refunds, deletes ledger, sends email", async () => {
    orderRow = baseOrder();
    updateClaimRows = [{ id: "order-1" }];

    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    expect(result).toEqual({ ok: true });
    expect(refundCreateMock).toHaveBeenCalledOnce();
    expect(refundCreateMock.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_test",
      reason: "requested_by_customer",
    });
    expect(ledgerDeleteCalls).toHaveLength(1);
    expect(sendCancellationEmailMock).toHaveBeenCalledOnce();
  });

  it("succeeds even when the Stripe refund call fails (logs but doesn't roll back)", async () => {
    orderRow = baseOrder();
    updateClaimRows = [{ id: "order-1" }];
    refundCreateMock.mockRejectedValue(new Error("stripe is down"));

    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    expect(result).toEqual({ ok: true });
    // Cancel still succeeded — the user has a cancelled order;
    // refund failure goes through dispute flow if needed.
    expect(sendCancellationEmailMock).toHaveBeenCalledOnce();
  });

  it("handles concurrent cancellation: claim returns 0 rows → graceful error", async () => {
    orderRow = baseOrder();
    updateClaimRows = []; // another worker won the claim

    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/window just closed|being placed/i);
    expect(refundCreateMock).not.toHaveBeenCalled();
  });

  it("does not attempt a refund when the order has no PaymentIntent on file", async () => {
    orderRow = baseOrder({ stripeSessionId: null });
    updateClaimRows = [{ id: "order-1" }];

    const result = await cancelAutoApprovedOrder({
      orderId: "order-1",
      confirmationToken: "tok-correct",
    });

    expect(result).toEqual({ ok: true });
    expect(refundCreateMock).not.toHaveBeenCalled();
  });
});
