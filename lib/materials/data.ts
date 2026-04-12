export type MaterialCategory =
  | "plastic"
  | "metal"
  | "flexible"
  | "resin"
  | "ceramic"
  | "composite";

export type PrintingMethod =
  | "FDM"
  | "SLS"
  | "SLA"
  | "DMLS"
  | "MJF"
  | "DLP"
  | "Binder Jetting";

export type QuickFilter =
  | "strong"
  | "flexible"
  | "budget"
  | "detailed"
  | "heat-resistant";

export interface MaterialMetadata {
  id: string;
  name: string;
  slug: string;
  category: MaterialCategory;
  method: PrintingMethod;
  color: string;
  description: string;
  properties: {
    strength: 1 | 2 | 3 | 4 | 5;
    flexibility: 1 | 2 | 3 | 4 | 5;
    detail: 1 | 2 | 3 | 4 | 5;
    heatResistance: 1 | 2 | 3 | 4 | 5;
  };
  constraints: {
    maxDimensions: { x: number; y: number; z: number };
    minWallThickness: number;
    minDetail: number;
  };
  priceRange: "budget" | "mid" | "premium";
  // PBR properties for 3D rendering
  pbr: {
    metalness: number; // 0 = dielectric, 1 = metal
    roughness: number; // 0 = mirror, 1 = matte
    clearcoat?: number; // 0-1, adds a shiny lacquer layer
  };
}

export const MATERIALS: MaterialMetadata[] = [
  // --- PLASTICS (FDM) ---
  {
    id: "pla-white",
    name: "PLA White",
    slug: "pla-white",
    category: "plastic",
    method: "FDM",
    color: "#f0f0f0",
    description:
      "Affordable, biodegradable thermoplastic. Great for prototypes and decorative pieces. Not recommended for functional parts exposed to heat.",
    properties: { strength: 2, flexibility: 1, detail: 3, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 300, y: 300, z: 400 },
      minWallThickness: 1.0,
      minDetail: 0.5,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.55 },
  },
  {
    id: "pla-black",
    name: "PLA Black",
    slug: "pla-black",
    category: "plastic",
    method: "FDM",
    color: "#1a1a1a",
    description:
      "The same reliable PLA in a sleek black finish. Ideal for display models and prototyping.",
    properties: { strength: 2, flexibility: 1, detail: 3, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 300, y: 300, z: 400 },
      minWallThickness: 1.0,
      minDetail: 0.5,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.5 },
  },
  {
    id: "abs-white",
    name: "ABS White",
    slug: "abs-white",
    category: "plastic",
    method: "FDM",
    color: "#e8e4dc",
    description:
      "Tough engineering plastic with good heat resistance. Used in automotive parts, electronics housings, and functional prototypes.",
    properties: { strength: 3, flexibility: 2, detail: 2, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.45 },
  },

  // --- NYLON (SLS) ---
  {
    id: "nylon-pa12",
    name: "Nylon PA12",
    slug: "nylon-pa12",
    category: "plastic",
    method: "SLS",
    color: "#d4cfc7",
    description:
      "Versatile, strong, and slightly flexible. The go-to for functional parts. Excellent chemical resistance and durability.",
    properties: { strength: 4, flexibility: 3, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 0.7,
      minDetail: 0.3,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.8 },
  },
  {
    id: "nylon-pa12-black",
    name: "Nylon PA12 Black",
    slug: "nylon-pa12-black",
    category: "plastic",
    method: "SLS",
    color: "#2a2a2a",
    description:
      "Dyed black nylon for a professional finish. Same excellent mechanical properties as white PA12.",
    properties: { strength: 4, flexibility: 3, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 0.7,
      minDetail: 0.3,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.82 },
  },

  // --- RESIN (SLA) ---
  {
    id: "resin-standard",
    name: "Standard Resin",
    slug: "resin-standard",
    category: "resin",
    method: "SLA",
    color: "#c8bfaa",
    description:
      "High-detail photopolymer resin. Smooth surface finish ideal for jewelry, miniatures, and detailed prototypes.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.15, clearcoat: 0.8 },
  },
  {
    id: "resin-tough",
    name: "Tough Resin",
    slug: "resin-tough",
    category: "resin",
    method: "SLA",
    color: "#5a6e5a",
    description:
      "Engineering-grade resin that simulates ABS. Combines high detail with improved impact resistance.",
    properties: { strength: 3, flexibility: 2, detail: 5, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.2, clearcoat: 0.6 },
  },

  // --- FLEXIBLE ---
  {
    id: "tpu-flexible",
    name: "TPU Flexible",
    slug: "tpu-flexible",
    category: "flexible",
    method: "FDM",
    color: "#3a3a3a",
    description:
      "Rubber-like thermoplastic. Excellent for gaskets, seals, phone cases, and parts requiring elasticity.",
    properties: { strength: 2, flexibility: 5, detail: 2, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.5,
      minDetail: 1.0,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.65 },
  },
  {
    id: "nylon-pa11",
    name: "Nylon PA11",
    slug: "nylon-pa11",
    category: "flexible",
    method: "SLS",
    color: "#b8a88a",
    description:
      "Bio-based nylon with excellent flexibility and impact resistance. Great for snap-fits, living hinges, and wearables.",
    properties: { strength: 3, flexibility: 4, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 0.7,
      minDetail: 0.3,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.75 },
  },

  // --- METALS (DMLS) ---
  {
    id: "steel-316l",
    name: "Stainless Steel 316L",
    slug: "stainless-steel-316l",
    category: "metal",
    method: "DMLS",
    color: "#8a8a8a",
    description:
      "Corrosion-resistant stainless steel. Used in medical devices, food-grade equipment, and marine applications.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.35 },
  },
  {
    id: "aluminum",
    name: "Aluminum AlSi10Mg",
    slug: "aluminum-alsi10mg",
    category: "metal",
    method: "DMLS",
    color: "#b0b0b0",
    description:
      "Lightweight, strong aluminum alloy. Excellent for aerospace, automotive, and heat exchangers.",
    properties: { strength: 4, flexibility: 1, detail: 3, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.42 },
  },
  {
    id: "titanium",
    name: "Titanium Ti6Al4V",
    slug: "titanium-ti6al4v",
    category: "metal",
    method: "DMLS",
    color: "#6e6e72",
    description:
      "Premium aerospace-grade titanium. Unmatched strength-to-weight ratio, biocompatible, and extremely heat resistant.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.3 },
  },
];

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  plastic: "Plastic",
  metal: "Metal",
  flexible: "Flexible",
  resin: "Resin",
  ceramic: "Ceramic",
  composite: "Composite",
};

export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  strong: "Strong",
  flexible: "Flexible",
  budget: "Budget",
  detailed: "Detailed",
  "heat-resistant": "Heat Resistant",
};
