import {
  MATERIALS,
  CATEGORY_LABELS,
  FEATURED_MATERIAL_IDS,
  type MaterialMetadata,
  type MaterialCategory,
  type QuickFilter,
} from "./preset-library";

export { MATERIALS, CATEGORY_LABELS, FEATURED_MATERIAL_IDS };
export type { MaterialMetadata, MaterialCategory, QuickFilter };

/**
 * Condensed hero carousel — five category-level picks. Each entry
 * spreads from a real material row and overrides display name +
 * (for plastics / resin) color and PBR so the 3D torus reads
 * distinctly. The stock PLA White was losing silhouette detail
 * under studio lighting, so Plastics gets a warmer off-white
 * with clearcoat; Resin gets real transmission for translucency.
 */
const heroBase = (id: string): MaterialMetadata => {
  const hit = MATERIALS.find((m) => m.id === id);
  if (!hit) throw new Error(`HERO_MATERIALS: missing base material ${id}`);
  return hit;
};

export const HERO_MATERIALS: MaterialMetadata[] = [
  {
    ...heroBase("pla-white"),
    name: "Plastics",
    color: "#c4bca8",
    pbr: { metalness: 0, roughness: 0.42, clearcoat: 0.25 },
  },
  {
    ...heroBase("steel-316l"),
    name: "Steel",
  },
  {
    ...heroBase("resin-standard"),
    name: "Resin",
    color: "#e6dfcc",
    pbr: {
      metalness: 0,
      roughness: 0.08,
      clearcoat: 0.9,
      transmission: 0.85,
      ior: 1.5,
      thickness: 1.2,
    },
  },
  {
    ...heroBase("aluminum"),
    name: "Alloys",
  },
  {
    ...heroBase("tpu-flexible"),
    name: "TPU",
  },
];

export function getMaterialById(id: string): MaterialMetadata | undefined {
  return MATERIALS.find((m) => m.id === id);
}

export function getMaterialBySlug(slug: string): MaterialMetadata | undefined {
  return MATERIALS.find((m) => m.slug === slug);
}

export function getMaterialsByCategory(
  category: MaterialCategory
): MaterialMetadata[] {
  return MATERIALS.filter((m) => m.category === category);
}

export function getMaterialsByQuickFilter(
  filter: QuickFilter
): MaterialMetadata[] {
  switch (filter) {
    case "strong":
      return MATERIALS.filter((m) => m.properties.strength >= 4);
    case "flexible":
      return MATERIALS.filter((m) => m.properties.flexibility >= 4);
    case "budget":
      return MATERIALS.filter((m) => m.priceRange === "budget");
    case "detailed":
      return MATERIALS.filter((m) => m.properties.detail >= 4);
    case "heat-resistant":
      return MATERIALS.filter((m) => m.properties.heatResistance >= 4);
  }
}

export function getCompatibleMaterials(dimensions: {
  x: number;
  y: number;
  z: number;
}): MaterialMetadata[] {
  return MATERIALS.filter((m) => {
    const c = m.constraints.maxDimensions;
    return dimensions.x <= c.x && dimensions.y <= c.y && dimensions.z <= c.z;
  });
}

export function isModelCompatible(
  material: MaterialMetadata,
  dimensions: { x: number; y: number; z: number }
): boolean {
  const c = material.constraints.maxDimensions;
  return dimensions.x <= c.x && dimensions.y <= c.y && dimensions.z <= c.z;
}

export function getMaterialCategories(): {
  category: MaterialCategory;
  label: string;
  count: number;
}[] {
  const categories = new Map<MaterialCategory, number>();
  for (const m of MATERIALS) {
    categories.set(m.category, (categories.get(m.category) || 0) + 1);
  }
  return Array.from(categories.entries()).map(([category, count]) => ({
    category,
    label: CATEGORY_LABELS[category],
    count,
  }));
}
