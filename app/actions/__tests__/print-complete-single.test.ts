import { describe, it, expect, vi, beforeEach } from "vitest";

// completePrintOrder's SINGLE (non-two_step) happy path — the default
// checkout model — had no direct assertion on the Stripe session it
// builds (only the two_step branch and the multi-tab lock guard were
// covered). MTR-153. Scaffold mirrors print-two-step.test.ts /
// print-checkout-lock.test.ts.

let selectedOrder: Record<string, unknown> | null = null;
let claimReturns: Array<{ id: string }> = [];
const updateSet = vi.fn();
const updateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table?.__name === "fileAssets") {
          return {
            leftJoin: () => ({
              where: () => ({
                limit: () => [
                  { fileName: "Carabiner", originalFilename: "carabiner.stl" },
                ],
              }),
            }),
          };
        }
        return {
          where: () => (selectedOrder ? [selectedOrder] : []),
        };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return {
          where: (w: unknown) => {
            updateWhere(w);
            const promise: Promise<void> & {
              returning: () => Array<{ id: string }>;
            } = Promise.resolve() as Promise<void> & {
              returning: () => Array<{ id: string }>;
            };
            promise.returning = () => claimReturns;
            return promise;
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
    stripeSessionId: "stripe_session_id",
  },
  printOrderItems: { __name: "printOrderItems" },
  cartItems: { __name: "cartItems" },
  fileAssets: { __name: "fileAssets", id: "id", fileId: "file_id" },
  files: { __name: "files", id: "id", name: "name" },
}));

vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: vi.fn(async () => ({
    config: { id: "pla-white", color: "White" },
    material: { name: "PLA" },
    finishGroup: { name: "Standard" },
  })),
  findProvider: vi.fn(async () => ({ vendorId: "vendor-1", name: "Unionfab" })),
}));

const stripeCreate = vi.fn();
const stripeRetrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => stripeCreate(...args),
        retrieve: (...args: unknown[]) => stripeRetrieve(...args),
      },
    },
  }),
}));

vi.mock("@/lib/craftcloud/client", () => ({
  createCart: vi.fn(),
  createOrder: vi.fn(),
  createStripeCheckout: vi.fn(),
  getOrderStatus: vi.fn(),
  CraftCloudApiError: class CraftCloudApiError extends Error {
    isQuoteExpired() {
      return false;
    }
  },
}));

vi.mock("@/lib/env", () => ({
  getCheckoutModel: vi.fn(() => "single"),
  isSandboxMode: vi.fn(() => true),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed-id" }));

import { completePrintOrder } from "../print";

const baseOrder = {
  id: "order-1",
  userId: "test-user-id",
  fileAssetId: "asset-1",
  craftCloudOrderId: null as string | null,
  craftCloudCartId: "cart-abc",
  stripeSessionId: null as string | null,
  bridgeSessionId: null as string | null,
  bridgeSessionUrl: null as string | null,
  feePaymentIntentId: null as string | null,
  checkoutModel: "single",
  // materialSubtotal * quantity + shippingSubtotal === totalPrice, so
  // no implied vendor-minimum production-fee line by default.
  totalPrice: 4850,
  serviceFee: 135,
  materialSubtotal: 4500,
  shippingSubtotal: 350,
  quantity: 1,
  material: "pla-white",
  vendor: "vendor-1",
  vendorName: null,
  status: "cart_created" as string,
  shippingAddress: null as Record<string, unknown> | null,
  trackingInfo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseAddress = {
  email: "ada@example.com",
  shipping: {
    firstName: "Ada",
    lastName: "Lovelace",
    address: "123 Main",
    city: "London",
    zipCode: "NW15LR",
    countryCode: "GB",
  },
  billing: {
    firstName: "Ada",
    lastName: "Lovelace",
    address: "123 Main",
    city: "London",
    zipCode: "NW15LR",
    countryCode: "GB",
    isCompany: false,
  },
};

const callArgs = {
  orderId: "order-1",
  email: baseAddress.email,
  shipping: baseAddress.shipping,
  billing: baseAddress.billing,
};

type SessionCreateArgs = {
  line_items: Array<{
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
    quantity: number;
  }>;
  payment_intent_data: { capture_method?: string; metadata: Record<string, string> };
  metadata: Record<string, string>;
  success_url: string;
  cancel_url: string;
  mode: string;
};

describe("completePrintOrder (single checkout model — default happy path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...baseOrder };
    claimReturns = [{ id: "order-1" }];
    stripeCreate.mockResolvedValue({
      id: "sess_single",
      url: "https://stripe.test/single",
    });
  });

  it("mints a session with default (non-manual) capture and no two_step metadata", async () => {
    const result = await completePrintOrder(callArgs);

    expect(result).toEqual({ checkoutUrl: "https://stripe.test/single" });
    expect(stripeCreate).toHaveBeenCalledTimes(1);

    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.mode).toBe("payment");
    // Single-checkout: capture_method must be absent (Stripe defaults
    // to automatic capture) — this is the money-flow distinction from
    // two_step's manual-capture fee hold.
    expect(args.payment_intent_data.capture_method).toBeUndefined();
    expect(args.metadata).toMatchObject({
      printOrderId: "order-1",
      type: "print_order",
      checkoutModel: "single",
    });
  });

  it("builds print + shipping + service-fee line items with the correct amounts", async () => {
    await completePrintOrder(callArgs);

    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    // No implied production fee (totalPrice === material*qty + shipping)
    // → exactly 3 lines: print, shipping, fee.
    expect(args.line_items).toHaveLength(3);

    const [printLine, shippingLine, feeLine] = args.line_items;
    expect(printLine.price_data.unit_amount).toBe(4500);
    expect(printLine.quantity).toBe(1);
    expect(printLine.price_data.product_data.name).toContain("Carabiner");
    expect(printLine.price_data.product_data.description).toBe(
      "PLA White · Standard · by Unionfab"
    );

    expect(shippingLine.price_data.unit_amount).toBe(350);
    expect(shippingLine.price_data.product_data.name).toBe("Shipping");

    expect(feeLine.price_data.unit_amount).toBe(135);
    expect(feeLine.price_data.product_data.name).toBe("Service fee");
    // Single-mode fee description has no "authorized now" language —
    // that's two_step-specific copy.
    expect(feeLine.price_data.product_data.description).toBe(
      "Materialize platform fee (3%)"
    );
  });

  it("adds a vendor-minimum production-fee line when totalPrice exceeds material+shipping", async () => {
    selectedOrder = {
      ...baseOrder,
      totalPrice: 4850 + 500, // implied production fee of 500 cents
    };

    await completePrintOrder(callArgs);

    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.line_items).toHaveLength(4);
    const productionFeeLine = args.line_items.find(
      (l) => l.price_data.product_data.name === "Vendor minimum production fee"
    );
    expect(productionFeeLine).toBeDefined();
    expect(productionFeeLine!.price_data.unit_amount).toBe(500);
  });

  it("routes success_url to the plain dashboard redirect (no welcome flag) for authed checkout", async () => {
    await completePrintOrder(callArgs);

    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.success_url).toContain(
      "/dashboard/orders?payment=success&orderId=order-1"
    );
    expect(args.success_url).not.toContain("welcome=1");
    expect(args.cancel_url).toContain(
      "/dashboard/orders?payment=cancelled&orderId=order-1"
    );
  });

  it("routes success_url through the welcome flag for the anon-signup checkout tail", async () => {
    await completePrintOrder({ ...callArgs, isAnonFlow: true });

    const args = stripeCreate.mock.calls[0][0] as SessionCreateArgs;
    expect(args.success_url).toContain(
      "/dashboard/orders?welcome=1&payment=success&orderId=order-1"
    );
  });

  it("persists the Stripe session id + shipping address on the order row", async () => {
    await completePrintOrder(callArgs);

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSessionId: "sess_single",
        shippingAddress: expect.objectContaining({
          email: baseAddress.email,
          shipping: baseAddress.shipping,
          billing: baseAddress.billing,
        }),
      })
    );
  });
});
