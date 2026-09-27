import { describe, expect, it } from "vitest";
import { normalizeOrderStatus } from "../order-status";
import { isProductionPaymentConfirmed } from "../payment-confirmation";

describe("normalizeOrderStatus", () => {
  it("maps each vendor part to its newest status entry", () => {
    const result = normalizeOrderStatus("o1", {
      orderNumber: "CC-123",
      estDeliveryTime: { v1: "2-3" },
      status: [
        {
          vendorId: "v1",
          cancelled: false,
          orderStatus: [
            { type: "shipped", date: "2026-09-03T00:00:00Z" },
            { type: "ordered", date: "2026-09-01T00:00:00Z" },
            { type: "in_production", date: "2026-09-02T00:00:00Z" },
          ],
        },
      ],
    });
    expect(result).toEqual({
      orderId: "o1",
      orderNumber: "CC-123",
      vendorStatuses: [{ vendorId: "v1", status: "shipped" }],
    });
  });

  it("reports a cancelled part as cancelled regardless of history", () => {
    const result = normalizeOrderStatus("o1", {
      orderNumber: "CC-123",
      status: [
        {
          vendorId: "v1",
          cancelled: true,
          orderStatus: [{ type: "in_production", date: "2026-09-02" }],
        },
      ],
    });
    expect(result.vendorStatuses).toEqual([
      { vendorId: "v1", status: "cancelled" },
    ]);
  });

  it("falls back to array order when dates don't parse", () => {
    const result = normalizeOrderStatus("o1", {
      orderNumber: "CC-123",
      status: [
        {
          vendorId: "v1",
          cancelled: false,
          orderStatus: [
            { type: "ordered", date: "garbage" },
            { type: "in_production", date: "also garbage" },
          ],
        },
      ],
    });
    expect(result.vendorStatuses[0].status).toBe("in_production");
  });

  it("leaves out parts with no history, which reads as unpaid", () => {
    const result = normalizeOrderStatus("o1", {
      orderNumber: "CC-123",
      status: [{ vendorId: "v1", cancelled: false, orderStatus: [] }],
    });
    expect(result.vendorStatuses).toEqual([]);
    expect(isProductionPaymentConfirmed(result)).toBe(false);
  });

  it("feeds isProductionPaymentConfirmed without throwing", () => {
    const result = normalizeOrderStatus("o1", {
      orderNumber: "CC-123",
      status: [
        {
          vendorId: "v1",
          cancelled: false,
          orderStatus: [{ type: "ordered", date: "2026-09-01T00:00:00Z" }],
        },
      ],
    });
    expect(isProductionPaymentConfirmed(result)).toBe(true);
  });
});
