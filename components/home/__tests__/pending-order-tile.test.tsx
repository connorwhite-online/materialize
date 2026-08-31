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
const loader = readFileSync(
  resolve(__dirname, "../../../lib/dashboard/pending-orders.ts"),
  "utf8"
);

function order(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: "ord-1",
    status: "cart_created",
    material: "cc-config-uuid",
    fileAssetId: "asset-1",
    fileCount: 1,
    createdAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("PendingOrderTile", () => {
  it("lives under an Orders heading", () => {
    expect(dashboard).toContain(">Orders</h2>");
    expect(dashboard).not.toContain("Needs attention");
  });

  it("does not resolve CraftCloud materials for the tile", () => {
    expect(loader).not.toContain("getCraftCloudCatalog");
    expect(loader).not.toContain("findMaterialConfig");
    expect(source).not.toContain("materialName");
    expect(source).not.toContain("getMaterialById");
  });

  it("renders status, file count, and date — no material, vendor, or total", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile order={order()} />
    );
    expect(html).toContain("Pending payment");
    expect(html).toContain("1 file");
    expect(html).toMatch(/Aug/);
    expect(html).toMatch(/30/);
    expect(html).not.toContain("Caribiner");
    expect(html).not.toContain("PLA");
    expect(html).not.toContain("Panashape");
    expect(html).not.toMatch(/\$\d+\.\d{2}/);
    expect(html).toContain("<svg");
  });

  it("shows a plural file count for multi-item orders", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile order={order({ fileCount: 3 })} />
    );
    expect(html).toContain("3 files");
  });
});
