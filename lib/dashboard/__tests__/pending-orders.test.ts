import { describe, it, expect } from "vitest";
import {
  formatOrderFileLine,
  formatOrderMaterialLine,
  formatPendingMaterialName,
  orderNeedsAttention,
  pendingOrderHref,
  sortHomeOrders,
  type PendingOrder,
} from "../pending-orders";

function order(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: "ord-1",
    status: "cart_created",
    material: null,
    materialName: null,
    fileAssetId: null,
    fileName: "bracket",
    fileCount: 1,
    materialCount: 0,
    ...overrides,
  };
}

describe("formatPendingMaterialName", () => {
  it("joins material and color", () => {
    expect(formatPendingMaterialName("PLA", "Black")).toBe("PLA · Black");
  });

  it("omits missing pieces and never echoes a UUID", () => {
    expect(formatPendingMaterialName("PLA", null)).toBe("PLA");
    expect(formatPendingMaterialName(null, "Black")).toBe("Black");
    expect(formatPendingMaterialName(undefined, "")).toBeNull();
    expect(formatPendingMaterialName(null, null)).toBeNull();
  });
});

describe("formatOrderFileLine / formatOrderMaterialLine", () => {
  it("uses the file name for a single file", () => {
    expect(formatOrderFileLine(1, "Caribiner Hook")).toBe("Caribiner Hook");
  });

  it("counts files when there are several", () => {
    expect(formatOrderFileLine(3, "Caribiner Hook")).toBe("3 files");
  });

  it("uses the material label for a single material", () => {
    expect(formatOrderMaterialLine(1, "PLA · Black")).toBe("PLA · Black");
  });

  it("counts materials when there are several", () => {
    expect(formatOrderMaterialLine(2, "PLA · Black")).toBe("2 materials");
  });

  it("hides the material line when none are known", () => {
    expect(formatOrderMaterialLine(0, null)).toBeNull();
  });
});

describe("sortHomeOrders", () => {
  it("puts attention-needed statuses ahead of auto_approved", () => {
    const rows = [
      order({ id: "auto", status: "auto_approved" }),
      order({ id: "pay", status: "cart_created" }),
      order({ id: "agent", status: "awaiting_agent_approval" }),
    ];
    const createdAtById = new Map([
      ["auto", 300],
      ["pay", 100],
      ["agent", 200],
    ]);
    expect(sortHomeOrders(rows, createdAtById).map((o) => o.id)).toEqual([
      "agent",
      "pay",
      "auto",
    ]);
  });

  it("marks only actionable statuses as needing attention", () => {
    expect(orderNeedsAttention("cart_created")).toBe(true);
    expect(orderNeedsAttention("awaiting_production_payment")).toBe(true);
    expect(orderNeedsAttention("awaiting_agent_approval")).toBe(true);
    expect(orderNeedsAttention("auto_approved")).toBe(false);
  });
});

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
