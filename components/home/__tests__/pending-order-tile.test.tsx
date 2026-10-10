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

describe("PendingOrderTile", () => {
  it("lives under an Orders heading", () => {
    expect(dashboard).toContain(">Orders</h2>");
    expect(dashboard).not.toContain("Needs attention");
  });

  it("resolves materials on a short budget so a cold catalog can't stall home", () => {
    expect(loader).toContain("resolveOrderMaterials");
    expect(loader).toContain("MATERIAL_BUDGET_MS");
    expect(source).not.toContain("getMaterialById");
  });

  it("shows material, swatch and total when they resolved", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile
        order={order({
          title: "Fan shroud",
          materialName: "PLA",
          materialColor: "Black",
          materialSwatch: "#111111",
          totalCents: 2410,
        })}
      />
    );
    expect(html).toContain("PLA · Black");
    expect(html).toContain("#111111");
    expect(html).toContain("$24.10");
    expect(html).toContain("Ordered Aug 30, 2026");
  });

  it("falls back to the file count and date when nothing else resolved", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile order={order()} />
    );
    expect(html).toContain("Pending payment");
    expect(html).toContain("1 file");
    expect(html).toMatch(/Aug/);
    expect(html).toMatch(/30/);
    expect(html).not.toContain("Panashape");
    expect(html).not.toMatch(/\$\d+\.\d{2}/);
    expect(html).toContain("<svg");
  });

  it("leads with the part's name and thumbnail", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile
        order={order({
          title: "Fan shroud",
          thumbnailUrl: "/api/thumbnails/file-1",
          quantity: 2,
        })}
      />
    );
    expect(html).toContain("Fan shroud");
    expect(html).toContain("/api/thumbnails/file-1");
    expect(html).toContain("×2");
    expect(html).not.toContain("1 file");
  });

  it("fans a multi-file order's parts as a stack and badges the overflow", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile
        order={order({
          title: "Fan shroud",
          fileCount: 5,
          thumbnails: ["/api/thumbnails/a", null, "/api/thumbnails/c"],
        })}
      />
    );
    expect(html).toContain("Fan shroud + 4 more");
    expect(html).toContain("/api/thumbnails/a");
    expect(html).toContain("/api/thumbnails/c");
    expect(html).toContain("+2");
  });

  it("shows a plural file count for multi-item orders", () => {
    const html = renderToStaticMarkup(
      <PendingOrderTile order={order({ fileCount: 3 })} />
    );
    expect(html).toContain("3 files");
  });
});
