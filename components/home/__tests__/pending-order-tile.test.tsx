import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingOrderTile } from "../pending-order-tile";
import type { PendingOrder } from "@/lib/dashboard/pending-orders";

const source = readFileSync(
  resolve(__dirname, "../pending-order-tile.tsx"),
  "utf8"
);
const dashboard = readFileSync(
  resolve(__dirname, "../home-dashboard.tsx"),
  "utf8"
);

function order(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: "ord-1",
    status: "cart_created",
    material: "cc-config-uuid",
    materialName: "PLA · Black",
    fileAssetId: "asset-1",
    fileName: "Caribiner Hook",
    fileCount: 1,
    materialCount: 1,
    ...overrides,
  };
}

describe("PendingOrderTile", () => {
  it("does not look up lib/materials swatches (CraftCloud ids never match)", () => {
    expect(source).not.toContain("getMaterialById");
    expect(source).not.toContain("@/lib/materials");
    expect(source).not.toContain("linear-gradient");
  });

  it("lives under an Orders heading, not Needs attention", () => {
    expect(dashboard).toContain(">Orders</h2>");
    expect(dashboard).not.toContain("Needs attention");
  });

  it("renders status, file, and material on separate lines — no total or vendor", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile order={order()} />
    );
    expect(html).toContain("Pending payment");
    expect(html).toContain("Caribiner Hook");
    expect(html).toContain("PLA · Black");
    expect(html).not.toContain("Panashape");
    expect(html).not.toContain("$8.26");
    expect(html).not.toMatch(/\$\d/);
    expect(html).toContain("<svg");
  });

  it("shows file and material counts for multi-item orders", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile
        order={order({
          fileName: null,
          materialName: null,
          fileCount: 3,
          materialCount: 2,
        })}
      />
    );
    expect(html).toContain("3 files");
    expect(html).toContain("2 materials");
  });

  it("uses distinct icons and short status labels", () => {
    expect(source).toContain("CreditCardIcon");
    expect(source).toContain("MailOpenIcon");
    expect(source).toContain("CheckCircle2Icon");
    expect(source).toContain("Factory");
    expect(source).toContain("Pending payment");
    expect(source).toContain("Complete payment");
    expect(source).toContain("Confirm order");
    expect(source).toContain("Placing soon");
  });
});
