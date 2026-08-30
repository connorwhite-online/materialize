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

function order(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: "ord-1",
    status: "cart_created",
    material: "cc-config-uuid",
    materialName: "PLA · Black",
    vendorName: "Panashape",
    totalPrice: 800,
    serviceFee: 26,
    fileAssetId: "asset-1",
    fileName: "Caribiner Hook",
    ...overrides,
  };
}

describe("PendingOrderTile", () => {
  it("does not look up lib/materials swatches (CraftCloud ids never match)", () => {
    expect(source).not.toContain("getMaterialById");
    expect(source).not.toContain("@/lib/materials");
    expect(source).not.toContain("linear-gradient");
    expect(source).not.toContain("bg-muted\" />");
  });

  it("renders a status icon + label, material text, vendor, and price", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile order={order()} />
    );
    expect(html).toContain("Pending Payment");
    expect(html).toContain("Caribiner Hook");
    expect(html).toContain("Panashape");
    expect(html).toContain("PLA · Black");
    expect(html).toContain("$8.26");
    // SVG status icon, not an empty color chip
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/style="[^"]*background:\s*linear-gradient/);
  });

  it("uses distinct icons per pending status", () => {
    expect(source).toContain("CreditCardIcon");
    expect(source).toContain("MailOpenIcon");
    expect(source).toContain("CheckCircle2Icon");
    expect(source).toContain("Factory");
  });

  it("falls back title to material name when file name is missing", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile
        order={order({ fileName: null, materialName: "Nylon · Natural" })}
      />
    );
    expect(html).toContain("Nylon · Natural");
  });
});
