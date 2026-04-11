import { describe, it, expect } from "vitest";
import {
  MATERIALS,
  getMaterialById,
  getMaterialBySlug,
  getMaterialsByCategory,
  getMaterialsByQuickFilter,
  getCompatibleMaterials,
  isModelCompatible,
  getMaterialCategories,
} from "../index";

describe("MATERIALS", () => {
  it("has materials defined", () => {
    expect(MATERIALS.length).toBeGreaterThan(0);
  });

  it("all materials have required fields", () => {
    for (const m of MATERIALS) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.slug).toBeTruthy();
      expect(m.category).toBeTruthy();
      expect(m.method).toBeTruthy();
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.description).toBeTruthy();
      expect(m.constraints.maxDimensions.x).toBeGreaterThan(0);
      expect(m.constraints.minWallThickness).toBeGreaterThan(0);
    }
  });

  it("all materials have unique ids", () => {
    const ids = MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all materials have unique slugs", () => {
    const slugs = MATERIALS.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("properties are in range 1-5", () => {
    for (const m of MATERIALS) {
      for (const value of Object.values(m.properties)) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe("getMaterialById", () => {
  it("finds existing material", () => {
    const m = getMaterialById("pla-white");
    expect(m).toBeDefined();
    expect(m!.name).toBe("PLA White");
  });

  it("returns undefined for non-existent id", () => {
    expect(getMaterialById("nonexistent")).toBeUndefined();
  });
});

describe("getMaterialBySlug", () => {
  it("finds existing material by slug", () => {
    const m = getMaterialBySlug("pla-white");
    expect(m).toBeDefined();
    expect(m!.id).toBe("pla-white");
  });

  it("returns undefined for non-existent slug", () => {
    expect(getMaterialBySlug("nonexistent")).toBeUndefined();
  });
});

describe("getMaterialsByCategory", () => {
  it("filters by plastic", () => {
    const plastics = getMaterialsByCategory("plastic");
    expect(plastics.length).toBeGreaterThan(0);
    expect(plastics.every((m) => m.category === "plastic")).toBe(true);
  });

  it("filters by metal", () => {
    const metals = getMaterialsByCategory("metal");
    expect(metals.length).toBeGreaterThan(0);
    expect(metals.every((m) => m.category === "metal")).toBe(true);
  });

  it("returns empty for category with no materials", () => {
    const ceramics = getMaterialsByCategory("ceramic");
    expect(ceramics).toEqual([]);
  });
});

describe("getMaterialsByQuickFilter", () => {
  it("strong filter returns high-strength materials", () => {
    const strong = getMaterialsByQuickFilter("strong");
    expect(strong.length).toBeGreaterThan(0);
    expect(strong.every((m) => m.properties.strength >= 4)).toBe(true);
  });

  it("flexible filter returns high-flexibility materials", () => {
    const flexible = getMaterialsByQuickFilter("flexible");
    expect(flexible.length).toBeGreaterThan(0);
    expect(flexible.every((m) => m.properties.flexibility >= 4)).toBe(true);
  });

  it("budget filter returns budget materials", () => {
    const budget = getMaterialsByQuickFilter("budget");
    expect(budget.length).toBeGreaterThan(0);
    expect(budget.every((m) => m.priceRange === "budget")).toBe(true);
  });

  it("detailed filter returns high-detail materials", () => {
    const detailed = getMaterialsByQuickFilter("detailed");
    expect(detailed.length).toBeGreaterThan(0);
    expect(detailed.every((m) => m.properties.detail >= 4)).toBe(true);
  });

  it("heat-resistant filter returns heat-resistant materials", () => {
    const heatRes = getMaterialsByQuickFilter("heat-resistant");
    expect(heatRes.length).toBeGreaterThan(0);
    expect(heatRes.every((m) => m.properties.heatResistance >= 4)).toBe(true);
  });
});

describe("getCompatibleMaterials", () => {
  it("returns all materials for small dimensions", () => {
    const compatible = getCompatibleMaterials({ x: 10, y: 10, z: 10 });
    expect(compatible.length).toBe(MATERIALS.length);
  });

  it("filters out materials that are too small", () => {
    // Resin has max 145x145x185, so 200x200x200 should exclude it
    const compatible = getCompatibleMaterials({ x: 200, y: 200, z: 200 });
    const hasResin = compatible.some((m) => m.category === "resin");
    expect(hasResin).toBe(false);
    expect(compatible.length).toBeLessThan(MATERIALS.length);
  });

  it("returns empty for very large dimensions", () => {
    const compatible = getCompatibleMaterials({ x: 9999, y: 9999, z: 9999 });
    expect(compatible.length).toBe(0);
  });
});

describe("isModelCompatible", () => {
  it("returns true for small model", () => {
    const pla = getMaterialById("pla-white")!;
    expect(isModelCompatible(pla, { x: 50, y: 50, z: 50 })).toBe(true);
  });

  it("returns false when model exceeds one dimension", () => {
    const resin = getMaterialById("resin-standard")!;
    expect(isModelCompatible(resin, { x: 200, y: 50, z: 50 })).toBe(false);
  });
});

describe("getMaterialCategories", () => {
  it("returns categories with counts", () => {
    const categories = getMaterialCategories();
    expect(categories.length).toBeGreaterThan(0);

    for (const cat of categories) {
      expect(cat.category).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.count).toBeGreaterThan(0);
    }
  });

  it("counts match actual materials", () => {
    const categories = getMaterialCategories();
    const total = categories.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(MATERIALS.length);
  });
});
