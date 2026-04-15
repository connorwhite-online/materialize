import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock — we'll swap out what db.select().from().where()
// returns per test via the `dbOrder` holder. db.update() tracks
// calls so we can verify the heal/write branches.
let dbOrder: Record<string, unknown> | null = null;
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (dbOrder ? [dbOrder] : []),
      }),
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
  printOrders: { id: "id", status: "status" },
}));

// CraftCloud createOrder mock — per test we assert whether it
// was called, and what it returned.
const mockCreateOrder = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
}));

import { handlePrintOrderPayment } from "../handle-print-order-payment";

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

describe("handlePrintOrderPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbOrder = null;
  });

  it("throws when the print order does not exist", async () => {
    dbOrder = null;
    await expect(handlePrintOrderPayment("missing")).rejects.toThrow(
      /Print order not found/
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("is a no-op when the order status has already advanced (duplicate delivery)", async () => {
    dbOrder = {
      id: "order-1",
      status: "ordered",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "cc-1",
      shippingAddress: baseAddress,
    };
    await handlePrintOrderPayment("order-1");
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("is a no-op when status is 'shipped' (later state, duplicate delivery)", async () => {
    dbOrder = {
      id: "order-1",
      status: "shipped",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "cc-1",
      shippingAddress: baseAddress,
    };
    await handlePrintOrderPayment("order-1");
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("heals a partial commit (craftCloudOrderId set, status still cart_created) without re-calling createOrder", async () => {
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: "cc-prev", // previous call set this
      shippingAddress: baseAddress,
    };
    await handlePrintOrderPayment("order-1");
    // Must not call createOrder again.
    expect(mockCreateOrder).not.toHaveBeenCalled();
    // Must update status to "ordered".
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "ordered" });
  });

  it("throws when cart id is missing", async () => {
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: null,
      craftCloudOrderId: null,
      shippingAddress: baseAddress,
    };
    await expect(handlePrintOrderPayment("order-1")).rejects.toThrow(
      /Missing cart or address/
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("throws when shipping address is missing", async () => {
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: null,
      shippingAddress: null,
    };
    await expect(handlePrintOrderPayment("order-1")).rejects.toThrow(
      /Missing cart or address/
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("happy path: places the CraftCloud order and writes the id + status", async () => {
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: null,
      shippingAddress: baseAddress,
    };
    mockCreateOrder.mockResolvedValue({ orderId: "cc-new", status: "ordered" });

    await handlePrintOrderPayment("order-1");

    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        cartId: "cart-1",
        user: expect.objectContaining({
          emailAddress: "ada@example.com",
        }),
      })
    );
    expect(mockUpdateSet).toHaveBeenCalledWith({
      craftCloudOrderId: "cc-new",
      status: "ordered",
    });
  });

  it("propagates CraftCloud errors so the webhook can 5xx and Stripe retries", async () => {
    dbOrder = {
      id: "order-1",
      status: "cart_created",
      craftCloudCartId: "cart-1",
      craftCloudOrderId: null,
      shippingAddress: baseAddress,
    };
    mockCreateOrder.mockRejectedValue(new Error("CraftCloud 500"));

    await expect(handlePrintOrderPayment("order-1")).rejects.toThrow(
      "CraftCloud 500"
    );
    // Critically, the DB update must NOT have fired — the order
    // row stays at status=cart_created so the next webhook
    // delivery can retry cleanly.
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});
