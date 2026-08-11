import { describe, it, expect, vi, beforeEach } from "vitest";

// paySandboxProductionOrder coverage: the sandbox craftcloud-pay
// page's Pay action. Slim mock scaffolding — one order row, one
// PaymentIntent, and a spy on the shared captureFeeAndPlaceOrder.
let selectedOrder: Record<string, unknown> | null = null;
const updateSet = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (selectedOrder ? [selectedOrder] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    id: "id",
    userId: "user_id",
    status: "status",
    checkoutModel: "checkout_model",
    feePaymentIntentId: "fee_payment_intent_id",
    feeCapturedAt: "fee_captured_at",
  },
}));

const isMockCheckoutMode = vi.fn(() => true);
vi.mock("@/lib/craftcloud/client", () => ({
  isMockCheckoutMode: () => isMockCheckoutMode(),
}));

const stripeRetrievePI = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    paymentIntents: {
      retrieve: (...args: unknown[]) => stripeRetrievePI(...args),
    },
  }),
}));

const captureFeeAndPlaceOrder = vi.fn();
vi.mock("@/lib/stripe/reconcile-production-payments", () => ({
  captureFeeAndPlaceOrder: (...args: unknown[]) =>
    captureFeeAndPlaceOrder(...args),
}));

import { paySandboxProductionOrder } from "../sandbox-checkout";

const baseOrder = {
  id: "order-1",
  status: "awaiting_production_payment",
  checkoutModel: "two_step",
  feePaymentIntentId: "pi_fee_1",
};

describe("paySandboxProductionOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMockCheckoutMode.mockReturnValue(true);
    selectedOrder = { ...baseOrder };
    stripeRetrievePI.mockResolvedValue({ status: "requires_capture" });
    captureFeeAndPlaceOrder.mockResolvedValue(undefined);
  });

  it("captures the fee via the shared path and returns the paid redirect", async () => {
    const result = await paySandboxProductionOrder("order-1");

    expect(captureFeeAndPlaceOrder).toHaveBeenCalledWith(
      "order-1",
      "pi_fee_1"
    );
    expect(result).toEqual({
      redirectUrl: "/dashboard/orders?production=paid&orderId=order-1",
    });
  });

  it("refuses outside mock checkout mode — never touches Stripe", async () => {
    isMockCheckoutMode.mockReturnValue(false);

    const result = await paySandboxProductionOrder("order-1");

    expect(result).toEqual({ error: "Sandbox payments are disabled." });
    expect(stripeRetrievePI).not.toHaveBeenCalled();
    expect(captureFeeAndPlaceOrder).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-ordered row", async () => {
    selectedOrder = { ...baseOrder, status: "ordered" };

    const result = await paySandboxProductionOrder("order-1");

    expect(result).toEqual({
      redirectUrl: "/dashboard/orders?production=paid&orderId=order-1",
    });
    expect(captureFeeAndPlaceOrder).not.toHaveBeenCalled();
  });

  it("heals a lagging row when the fee was already captured", async () => {
    stripeRetrievePI.mockResolvedValue({ status: "succeeded" });

    const result = await paySandboxProductionOrder("order-1");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ordered" })
    );
    expect(captureFeeAndPlaceOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      redirectUrl: "/dashboard/orders?production=paid&orderId=order-1",
    });
  });

  it("reports an expired hold instead of capturing a canceled PI", async () => {
    stripeRetrievePI.mockResolvedValue({ status: "canceled" });

    const result = await paySandboxProductionOrder("order-1");

    expect(captureFeeAndPlaceOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: expect.stringContaining("expired"),
    });
  });

  it("rejects single-checkout orders and other users' orders", async () => {
    selectedOrder = { ...baseOrder, checkoutModel: "single" };
    expect(await paySandboxProductionOrder("order-1")).toEqual({
      error: "Order not found",
    });

    selectedOrder = null; // owner-scoped select found nothing
    expect(await paySandboxProductionOrder("order-1")).toEqual({
      error: "Order not found",
    });
  });
});
