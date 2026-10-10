import { describe, it, expect } from "vitest";
import {
  displayPartName,
  formatOrderDate,
  formatOrderFileCount,
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
    fileAssetId: null,
    fileCount: 1,
    title: null,
    thumbnailUrl: null,
    thumbnails: [],
    quantity: 1,
    totalCents: null,
    materialName: null,
    materialColor: null,
    materialSwatch: null,
    createdAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("formatOrderFileCount", () => {
  it("always shows a count", () => {
    expect(formatOrderFileCount(1)).toBe("1 file");
    expect(formatOrderFileCount(3)).toBe("3 files");
  });
});

describe("formatOrderDate", () => {
  it("formats a short calendar date", () => {
    expect(formatOrderDate("2026-08-30T12:00:00.000Z")).toMatch(/Aug/);
    expect(formatOrderDate("2026-08-30T12:00:00.000Z")).toMatch(/30/);
    expect(formatOrderDate("2026-08-30T12:00:00.000Z")).toMatch(/2026/);
  });

  it("returns empty for invalid input", () => {
    expect(formatOrderDate("not-a-date")).toBe("");
  });
});

describe("sortHomeOrders", () => {
  it("puts attention-needed statuses ahead of auto_approved", () => {
    const rows = [
      order({ id: "auto", status: "auto_approved", createdAt: "2026-08-30T15:00:00.000Z" }),
      order({ id: "pay", status: "cart_created", createdAt: "2026-08-30T10:00:00.000Z" }),
      order({
        id: "agent",
        status: "awaiting_agent_approval",
        createdAt: "2026-08-30T12:00:00.000Z",
      }),
    ];
    expect(sortHomeOrders(rows).map((o) => o.id)).toEqual([
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
  it("sends agent-approval rows to the confirm page with their token", () => {
    // The confirm page 404s without ?token=; the tile used to omit it.
    expect(
      pendingOrderHref(
        order({ status: "awaiting_agent_approval", confirmationToken: "tok_A1-b" })
      )
    ).toBe("/orders/ord-1/confirm?token=tok_A1-b");
  });

  it("falls back to the detail page for an agent-approval row with no token", () => {
    expect(
      pendingOrderHref(order({ status: "awaiting_agent_approval" }))
    ).toBe("/dashboard/orders/ord-1");
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

describe("displayPartName", () => {
  it("drops a mesh extension from an upload filename", () => {
    expect(displayPartName("bracket.STL")).toBe("bracket");
    expect(displayPartName("Fan shroud v2")).toBe("Fan shroud v2");
    expect(displayPartName("  ")).toBeNull();
    expect(displayPartName(null)).toBeNull();
  });
});
