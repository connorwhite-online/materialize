import { describe, it, expect } from "vitest";
import { isProductionPaymentConfirmed } from "../payment-confirmation";
import type { OrderStatusResponse, OrderStatus } from "../types";

function statusResponse(statuses: OrderStatus[]): OrderStatusResponse {
  return {
    orderId: "order-1",
    vendorStatuses: statuses.map((status, i) => ({
      vendorId: `vendor-${i + 1}`,
      status,
    })),
  };
}

describe("isProductionPaymentConfirmed", () => {
  it.each(["ordered", "in_production", "shipped", "received"] as const)(
    "returns true when a vendor reports %s",
    (status) => {
      expect(isProductionPaymentConfirmed(statusResponse([status]))).toBe(true);
    }
  );

  it("returns false when vendorStatuses is empty", () => {
    expect(isProductionPaymentConfirmed(statusResponse([]))).toBe(false);
  });

  it("returns false when only blocked/cancelled entries exist", () => {
    expect(
      isProductionPaymentConfirmed(statusResponse(["blocked", "cancelled"]))
    ).toBe(false);
  });

  it("returns true when a paid status appears alongside a blocked vendor", () => {
    expect(
      isProductionPaymentConfirmed(statusResponse(["blocked", "in_production"]))
    ).toBe(true);
  });
});
