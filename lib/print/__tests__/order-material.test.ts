import { describe, expect, it, vi } from "vitest";

const findMaterialConfig = vi.fn();
vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: (id: string) => findMaterialConfig(id),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { resolveOrderMaterials } from "../order-material";

describe("resolveOrderMaterials", () => {
  // printOrders.material holds a CraftCloud config UUID; the local
  // lookup alone left every live order labelled "Material".
  it("names a CraftCloud config id from the catalog", async () => {
    findMaterialConfig.mockResolvedValueOnce({
      material: { name: "SLS Nylon PA12" },
      config: { color: "Solid White", colorCode: "#f4f4f4" },
    });
    const out = await resolveOrderMaterials(["ac7fc3fa-cfg", null, "ac7fc3fa-cfg"]);
    expect(out.get("ac7fc3fa-cfg")).toEqual({
      name: "SLS Nylon PA12",
      method: "Solid White",
      color: "#f4f4f4",
    });
    expect(findMaterialConfig).toHaveBeenCalledTimes(1);
  });

  it("leaves unknown ids and catalog failures out", async () => {
    findMaterialConfig.mockResolvedValueOnce(null);
    findMaterialConfig.mockRejectedValueOnce(new Error("catalog down"));
    const out = await resolveOrderMaterials(["missing", "broken"]);
    expect(out.size).toBe(0);
  });
});
