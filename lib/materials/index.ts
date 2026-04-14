import {
  MATERIALS,
  CATEGORY_LABELS,
  FEATURED_MATERIAL_IDS,
  type MaterialMetadata,
  type MaterialCategory,
  type QuickFilter,
} from "./data";

export { MATERIALS, CATEGORY_LABELS, FEATURED_MATERIAL_IDS };
export type { MaterialMetadata, MaterialCategory, QuickFilter };

/**
 * Featured materials in the order specified by FEATURED_MATERIAL_IDS.
 * Filters out any IDs that don't exist (guard against typos).
 */
export const FEATURED_MATERIALS: MaterialMetadata[] = FEATURED_MATERIAL_IDS
  .map((id) => MATERIALS.find((m) => m.id === id))
  .filter((m): m is MaterialMetadata => Boolean(m));

/**
 * Condensed hero carousel — five category-level picks instead of
 * the full featured set. Each entry spreads from a real material
 * row and overrides display name + (for plastics) color/PBR so the
 * 3D torus reads distinctly in each one. The stark #f0f0f0 on the
 * stock PLA White was losing silhouette detail on the viewer, so
 * the plastics pick uses a warmer off-white with a small clearcoat
 * highlight for more definition.
 */
const baseMaterial = (id: string): MaterialMetadata => {
  const hit = MATERIALS.find((m) => m.id === id);
  if (!hit) throw new Error(`HERO_MATERIALS: missing base material ${id}`);
  return hit;
};

export const HERO_MATERIALS: MaterialMetadata[] = [
  {
    ...baseMaterial("pla-white"),
    name: "Plastics",
    // Warm off-white with a soft clearcoat — the stock #f0f0f0
    // / 0.55 roughness combo blew out to a matte blob that lost
    // the torus silhouette under the studio lighting.
    color: "#c4bca8",
    pbr: { metalness: 0, roughness: 0.42, clearcoat: 0.25 },
  },
  {
    ...baseMaterial("steel-316l"),
    name: "Steel",
  },
  {
    ...baseMaterial("resin-standard"),
    name: "Resin",
    // Real translucency via transmission — the torus reads as a
    // glassy resin cast instead of a painted plastic shell.
    // ior ~1.5 matches typical photopolymer, thickness drives
    // how much the back-face refracts through the volume.
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
    ...baseMaterial("aluminum"),
    name: "Alloys",
  },
  {
    ...baseMaterial("tpu-flexible"),
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
