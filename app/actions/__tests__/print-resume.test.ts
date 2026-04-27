import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test row the db.select mock will return. Let tests swap in
// different printOrders shapes without rebuilding the whole mock.
let selectedOrder: unknown = null;
// Whether the atomic-claim UPDATE().returning() in resumePrintOrder
// finds a row to claim. Default to "we won the claim" so the
// happy-path fresh-session test runs as it always did.
let claimReturns: Array<{ id: string }> = [{ id: "order-id-1" }];
const mockDbUpdateSet = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        // printOrders lookup — returns the test's current order row.
        // fileAssets lookup (for Stripe line-item naming) — returns a
        // single asset row the catalog helpers will decorate.
        if (table?.__name === "fileAssets") {
          return {
            leftJoin: () => ({
              where: () => ({
                limit: () => [
                  {
                    fileName: "Caribiner",
                    originalFilename: "caribiner.stl",
                  },
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
      set: (...args: unknown[]) => {
        mockDbUpdateSet(...args);
        return {
          where: (..._w: unknown[]) => {
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
  printOrders: { __name: "printOrders", id: "id", userId: "user_id" },
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

const mockCreate = vi.fn();
const mockRetrieve = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockCreate(...args),
        retrieve: (...args: unknown[]) => mockRetrieve(...args),
      },
    },
  }),
}));

vi.mock("@/lib/craftcloud/client", () => ({
  createCart: vi.fn(),
  createOrder: vi.fn(),
  getOrderStatus: vi.fn(),
}));

import { resumePrintOrder } from "../print";

const baseOrder = {
  id: "order-id-1",
  userId: "test-user-id",
  fileAssetId: "asset-1",
  craftCloudOrderId: null,
  craftCloudCartId: "cart-abc",
  stripeSessionId: null as string | null,
  totalPrice: 5000,
  serviceFee: 150,
  material: "pla-white",
  vendor: "vendor-1",
  status: "cart_created" as const,
  shippingAddress: {
    email: "hi@example.com",
    shipping: {},
    billing: {},
  },
  trackingInfo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("resumePrintOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = null;
    claimReturns = [{ id: "order-id-1" }];
  });

  it("returns the existing Stripe URL when the session is still open", async () => {
    selectedOrder = { ...baseOrder, stripeSessionId: "sess_existing" };
    mockRetrieve.mockResolvedValueOnce({
      status: "open",
      url: "https://stripe.test/existing",
    });

    const result = await resumePrintOrder("order-id-1");

    expect(mockRetrieve).toHaveBeenCalledWith("sess_existing");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/existing" });
  });

  it("mints a fresh Stripe session when the existing one is expired", async () => {
    selectedOrder = { ...baseOrder, stripeSessionId: "sess_expired" };
    mockRetrieve.mockResolvedValueOnce({
      status: "expired",
      url: null,
    });
    mockCreate.mockResolvedValueOnce({
      id: "sess_new",
      url: "https://stripe.test/new",
    });

    const result = await resumePrintOrder("order-id-1");

    expect(mockRetrieve).toHaveBeenCalledWith("sess_expired");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      stripeSessionId: "sess_new",
    });
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/new" });
  });

  it("creates a session when the order has no Stripe session yet", async () => {
    selectedOrder = { ...baseOrder, stripeSessionId: null };
    mockCreate.mockResolvedValueOnce({
      id: "sess_first",
      url: "https://stripe.test/first",
    });

    const result = await resumePrintOrder("order-id-1");

    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ checkoutUrl: "https://stripe.test/first" });
  });

  it("errors when the order is not in cart_created", async () => {
    selectedOrder = { ...baseOrder, status: "ordered" };
    const result = await resumePrintOrder("order-id-1");
    expect(result).toEqual({ error: "Order already processed" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 'in progress' when the atomic claim is lost mid-flight", async () => {
    // Sibling tab/device already started a Resume — they hold the
    // claim sentinel, no real id has landed yet. We must NOT mint a
    // second Stripe session.
    selectedOrder = {
      ...baseOrder,
      stripeSessionId: "session_claim:other-worker",
    };
    claimReturns = [];
    const result = await resumePrintOrder("order-id-1");
    expect(result).toEqual({
      error: "Checkout already in progress. Please refresh and try again.",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("errors when the order has no saved address", async () => {
    selectedOrder = { ...baseOrder, shippingAddress: null };
    const result = await resumePrintOrder("order-id-1");
    expect(result).toEqual({ error: "Order has no saved address" });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
