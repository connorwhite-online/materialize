import { describe, it, expect } from "vitest";
import {
  pendingOrderHref,
  type PendingOrder,
} from "../pending-orders";

function order(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: "ord-1",
    status: "cart_created",
    material: null,
    vendorName: null,
    totalPrice: 0,
    serviceFee: 0,
    fileAssetId: null,
    fileName: "bracket",
    ...overrides,
  };
}

describe("pendingOrderHref", () => {
  it("sends agent-approval rows to the confirm page", () => {
    expect(
      pendingOrderHref(order({ status: "awaiting_agent_approval" }))
    ).toBe("/orders/ord-1/confirm");
  });

  it("sends two-step rows to the production-payment page", () => {
    expect(
      pendingOrderHref(order({ status: "awaiting_production_payment" }))
    ).toBe("/orders/ord-1/pay-production");
  });

  it("resumes a single-item draft in the quote configurator", () => {
    expect(
      pendingOrderHref(
        order({
          status: "cart_created",
          fileAssetId: "asset-1",
          material: "mat-9",
        })
      )
    ).toBe("/print/asset-1?material=mat-9");
  });

  it("falls back to the order detail page", () => {
    expect(pendingOrderHref(order({ status: "auto_approved" }))).toBe(
      "/dashboard/orders/ord-1"
    );
  });
});
