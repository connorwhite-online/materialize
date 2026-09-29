import { describe, it, expect, vi, beforeEach } from "vitest";

let selectRows: Array<Record<string, unknown>> = [];
let updateReturns: Array<{ id: string }> = [{ id: "order-1" }];
const mockUpdateSet = vi.fn();
const getOrderStatusMock = vi.fn();
const logErrorMock = vi.fn();
const sendPushMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectRows,
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: () => ({
            returning: async () => updateReturns,
          }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/craftcloud/client", () => ({
  getOrderStatus: (...args: unknown[]) => getOrderStatusMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

vi.mock("@/lib/push/send", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushMock(...args),
}));

import {
  nextFulfillmentStatus,
  pickVendorStatus,
  syncFulfillmentStatuses,
} from "../fulfillment-sync";

describe("nextFulfillmentStatus", () => {
  it("advances along the progress path", () => {
    expect(nextFulfillmentStatus("ordered", "in_production")).toBe("in_production");
    expect(nextFulfillmentStatus("ordered", "shipped")).toBe("shipped");
    expect(nextFulfillmentStatus("shipped", "received")).toBe("received");
  });

  it("never moves backwards or rewrites the same status", () => {
    expect(nextFulfillmentStatus("shipped", "in_production")).toBeNull();
    expect(nextFulfillmentStatus("in_production", "ordered")).toBeNull();
    expect(nextFulfillmentStatus("shipped", "shipped")).toBeNull();
    expect(nextFulfillmentStatus("ordered", undefined)).toBeNull();
  });

  it("applies blocked and cancelled from any polled state", () => {
    expect(nextFulfillmentStatus("in_production", "blocked")).toBe("blocked");
    expect(nextFulfillmentStatus("shipped", "cancelled")).toBe("cancelled");
    expect(nextFulfillmentStatus("blocked", "cancelled")).toBe("cancelled");
  });

  it("lets a blocked order resume at whatever CraftCloud reports", () => {
    expect(nextFulfillmentStatus("blocked", "ordered")).toBe("ordered");
    expect(nextFulfillmentStatus("blocked", "in_production")).toBe("in_production");
  });
});

describe("pickVendorStatus", () => {
  const status = {
    orderId: "cc-1",
    vendorStatuses: [
      { vendorId: "a", status: "ordered" as const },
      { vendorId: "b", status: "shipped" as const },
    ],
  };

  it("prefers the row's own vendor", () => {
    expect(pickVendorStatus(status, "b")).toBe("shipped");
  });

  it("falls back to the first part when the vendor is unknown", () => {
    expect(pickVendorStatus(status, null)).toBe("ordered");
    expect(pickVendorStatus(status, "zzz")).toBe("ordered");
  });

  it("is undefined when CraftCloud reports no parts", () => {
    expect(pickVendorStatus({ orderId: "cc-1", vendorStatuses: [] }, "a")).toBeUndefined();
  });
});

describe("syncFulfillmentStatuses", () => {
  beforeEach(() => {
    selectRows = [];
    updateReturns = [{ id: "order-1" }];
    mockUpdateSet.mockReset();
    getOrderStatusMock.mockReset();
    logErrorMock.mockReset();
    sendPushMock.mockReset();
  });

  it("writes the advanced status", async () => {
    selectRows = [
      { id: "order-1", userId: "buyer-1", status: "ordered", vendor: "a", craftCloudOrderId: "cc-1" },
    ];
    getOrderStatusMock.mockResolvedValue({
      orderId: "cc-1",
      vendorStatuses: [{ vendorId: "a", status: "shipped" }],
    });

    const result = await syncFulfillmentStatuses();

    expect(getOrderStatusMock).toHaveBeenCalledWith("cc-1");
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "shipped" });
    expect(result).toEqual({ scanned: 1, updated: 1, errors: 0 });
  });

  it("pushes the buyer when their order moves", async () => {
    selectRows = [
      { id: "order-1", userId: "buyer-1", status: "ordered", vendor: "a", craftCloudOrderId: "cc-1" },
    ];
    getOrderStatusMock.mockResolvedValue({
      orderId: "cc-1",
      vendorStatuses: [{ vendorId: "a", status: "shipped" }],
    });

    await syncFulfillmentStatuses();

    expect(sendPushMock).toHaveBeenCalledWith(
      "buyer-1",
      expect.objectContaining({
        title: "Your print has shipped",
        url: "/dashboard/orders/order-1",
      })
    );
  });

  it("skips the write when nothing changed", async () => {
    selectRows = [
      { id: "order-1", status: "ordered", vendor: "a", craftCloudOrderId: "cc-1" },
    ];
    getOrderStatusMock.mockResolvedValue({
      orderId: "cc-1",
      vendorStatuses: [{ vendorId: "a", status: "ordered" }],
    });

    const result = await syncFulfillmentStatuses();

    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
  });

  it("does not count a write a concurrent actor beat us to", async () => {
    selectRows = [
      { id: "order-1", status: "ordered", vendor: "a", craftCloudOrderId: "cc-1" },
    ];
    updateReturns = [];
    getOrderStatusMock.mockResolvedValue({
      orderId: "cc-1",
      vendorStatuses: [{ vendorId: "a", status: "in_production" }],
    });

    const result = await syncFulfillmentStatuses();
    expect(result.updated).toBe(0);
    // The other writer owns the transition, and its notification.
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("flags a vendor cancellation for a refund check", async () => {
    selectRows = [
      { id: "order-1", status: "in_production", vendor: "a", craftCloudOrderId: "cc-1" },
    ];
    getOrderStatusMock.mockResolvedValue({
      orderId: "cc-1",
      vendorStatuses: [{ vendorId: "a", status: "cancelled" }],
    });

    await syncFulfillmentStatuses();

    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "cancelled" });
    expect(logErrorMock).toHaveBeenCalledWith(
      "syncFulfillmentStatuses.vendorCancelled",
      expect.any(Error)
    );
  });

  it("keeps sweeping after one row fails", async () => {
    selectRows = [
      { id: "order-1", status: "ordered", vendor: "a", craftCloudOrderId: "cc-1" },
      { id: "order-2", status: "ordered", vendor: "a", craftCloudOrderId: "cc-2" },
    ];
    getOrderStatusMock.mockImplementation(async (id: string) => {
      if (id === "cc-1") throw new Error("CraftCloud 500");
      return { orderId: id, vendorStatuses: [{ vendorId: "a", status: "shipped" }] };
    });

    const result = await syncFulfillmentStatuses();

    expect(result).toEqual({ scanned: 2, updated: 1, errors: 1 });
  });
});
