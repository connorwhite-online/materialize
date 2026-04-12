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

  // --- MORE PLASTICS (FDM) ---
  {
    id: "petg",
    name: "PETG",
    slug: "petg",
    category: "plastic",
    method: "FDM",
    color: "#c8d4d8",
    description:
      "Tough and durable with excellent chemical resistance. Combines PLA's ease of printing with ABS-level strength. Food-safe grades available.",
    properties: { strength: 3, flexibility: 2, detail: 3, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 300, y: 300, z: 400 },
      minWallThickness: 1.0,
      minDetail: 0.6,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.35, clearcoat: 0.3 },
  },
  {
    id: "asa",
    name: "ASA",
    slug: "asa",
    category: "plastic",
    method: "FDM",
    color: "#dad5cc",
    description:
      "UV-resistant engineering plastic. Like ABS but holds up outdoors without yellowing. Ideal for automotive exterior and signage.",
    properties: { strength: 3, flexibility: 2, detail: 2, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.55 },
  },
  {
    id: "polycarbonate",
    name: "Polycarbonate",
    slug: "polycarbonate",
    category: "plastic",
    method: "FDM",
    color: "#d8dce0",
    description:
      "High-strength engineering plastic. Excellent impact resistance and heat tolerance. Used in safety equipment, lenses, and structural parts.",
    properties: { strength: 5, flexibility: 2, detail: 2, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.25, clearcoat: 0.5 },
  },
  {
    id: "pc-abs",
    name: "PC-ABS",
    slug: "pc-abs",
    category: "plastic",
    method: "FDM",
    color: "#c8ccd0",
    description:
      "Blend of polycarbonate and ABS. Good balance of strength, heat resistance, and printability. Common in automotive and electronics.",
    properties: { strength: 4, flexibility: 2, detail: 2, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.5 },
  },
  {
    id: "peek",
    name: "PEEK",
    slug: "peek",
    category: "plastic",
    method: "FDM",
    color: "#c9b788",
    description:
      "Ultra-high-performance thermoplastic. Aerospace and medical grade. Incredible strength-to-weight ratio, chemical resistance, and heat tolerance up to 250°C.",
    properties: { strength: 5, flexibility: 2, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 200, y: 200, z: 200 },
      minWallThickness: 1.5,
      minDetail: 1.0,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.45 },
  },

  // --- CARBON FIBER COMPOSITES ---
  {
    id: "petg-cf",
    name: "PETG Carbon Fiber",
    slug: "petg-cf",
    category: "composite",
    method: "FDM",
    color: "#1a1a1a",
    description:
      "PETG reinforced with chopped carbon fiber. Rigid, lightweight, and dimensionally stable. Great for functional prototypes and jigs.",
    properties: { strength: 4, flexibility: 1, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.7 },
  },
  {
    id: "nylon-cf",
    name: "Nylon Carbon Fiber",
    slug: "nylon-cf",
    category: "composite",
    method: "SLS",
    color: "#2a2a2a",
    description:
      "Carbon-filled nylon with exceptional stiffness and strength. Used for end-use mechanical parts, drone frames, and tooling.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 1.0,
      minDetail: 0.5,
    },
    priceRange: "premium",
    pbr: { metalness: 0.1, roughness: 0.6 },
  },
  {
    id: "nylon-gf",
    name: "Nylon Glass Fiber",
    slug: "nylon-gf",
    category: "composite",
    method: "SLS",
    color: "#e0dccc",
    description:
      "Glass-filled nylon with increased rigidity and thermal stability compared to pure nylon. Durable and cost-effective for functional parts.",
    properties: { strength: 4, flexibility: 2, detail: 3, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 1.0,
      minDetail: 0.5,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.75 },
  },

  // --- MORE RESINS (SLA/DLP) ---
  {
    id: "resin-clear",
    name: "Clear Resin",
    slug: "resin-clear",
    category: "resin",
    method: "SLA",
    color: "#e8e8e8",
    description:
      "Transparent photopolymer. After post-processing, produces optically clear parts ideal for fluidics, lenses, and translucent enclosures.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.05, clearcoat: 1.0 },
  },
  {
    id: "resin-high-temp",
    name: "High Temp Resin",
    slug: "resin-high-temp",
    category: "resin",
    method: "SLA",
    color: "#e8dcc0",
    description:
      "Heat-resistant resin withstanding up to 238°C. Used for molds, thermal forming tools, and hot air/fluid testing.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.2, clearcoat: 0.7 },
  },
  {
    id: "resin-castable",
    name: "Castable Resin",
    slug: "resin-castable",
    category: "resin",
    method: "SLA",
    color: "#9d3a70",
    description:
      "Burns out cleanly for investment casting. The gold standard for jewelry prototyping and small metal parts via lost-wax casting.",
    properties: { strength: 1, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.4,
      minDetail: 0.1,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.2, clearcoat: 0.8 },
  },
  {
    id: "resin-flexible",
    name: "Flexible Resin",
    slug: "resin-flexible",
    category: "flexible",
    method: "SLA",
    color: "#3c3c3c",
    description:
      "Soft, rubber-like photopolymer. Flexes and returns to shape. Great for grippers, gaskets, and ergonomic handles with high detail.",
    properties: { strength: 2, flexibility: 5, detail: 4, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.7,
      minDetail: 0.2,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.5 },
  },

  // --- MJF NYLONS ---
  {
    id: "mjf-pa12",
    name: "MJF PA12",
    slug: "mjf-pa12",
    category: "plastic",
    method: "MJF",
    color: "#3a3a3a",
    description:
      "HP Multi Jet Fusion nylon. Tighter tolerances than SLS, smoother surfaces, faster production. Excellent for short-run manufacturing.",
    properties: { strength: 4, flexibility: 3, detail: 4, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 380, y: 284, z: 380 },
      minWallThickness: 0.7,
      minDetail: 0.3,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.78 },
  },
  {
    id: "mjf-tpu",
    name: "MJF TPU",
    slug: "mjf-tpu",
    category: "flexible",
    method: "MJF",
    color: "#2e2e2e",
    description:
      "Flexible thermoplastic polyurethane via MJF. Good mechanical properties with consistent elasticity. Used for midsoles, wearables, and seals.",
    properties: { strength: 3, flexibility: 5, detail: 4, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 380, y: 284, z: 380 },
      minWallThickness: 1.2,
      minDetail: 0.5,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.55 },
  },

  // --- MORE METALS ---
  {
    id: "steel-17-4ph",
    name: "Stainless Steel 17-4 PH",
    slug: "stainless-steel-17-4ph",
    category: "metal",
    method: "DMLS",
    color: "#959595",
    description:
      "Precipitation-hardened stainless steel with excellent strength. Used in oil & gas, chemical processing, and marine applications.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.38 },
  },
  {
    id: "inconel-625",
    name: "Inconel 625",
    slug: "inconel-625",
    category: "metal",
    method: "DMLS",
    color: "#7a7570",
    description:
      "Nickel-chromium superalloy. Exceptional performance in extreme environments: jet engines, chemical plants, nuclear applications.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.5 },
  },
  {
    id: "cobalt-chrome",
    name: "Cobalt Chrome",
    slug: "cobalt-chrome",
    category: "metal",
    method: "DMLS",
    color: "#a8a8ad",
    description:
      "Biocompatible alloy with high wear resistance. Standard for dental and medical implants, and high-stress aerospace components.",
    properties: { strength: 5, flexibility: 1, detail: 4, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 200, y: 200, z: 250 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.28 },
  },
  {
    id: "copper",
    name: "Copper",
    slug: "copper",
    category: "metal",
    method: "DMLS",
    color: "#b8734a",
    description:
      "Pure copper for heat exchangers, RF antennas, and electrical applications. Excellent thermal and electrical conductivity.",
    properties: { strength: 3, flexibility: 2, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 200, y: 200, z: 200 },
      minWallThickness: 0.6,
      minDetail: 0.3,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.25 },
  },
  {
    id: "bronze",
    name: "Bronze",
    slug: "bronze",
    category: "metal",
    method: "Binder Jetting",
    color: "#a57a38",
    description:
      "Infiltrated bronze composite. Warm metallic finish ideal for sculptures, jewelry, and decorative parts. Affordable metal option.",
    properties: { strength: 3, flexibility: 1, detail: 4, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 200, y: 200, z: 180 },
      minWallThickness: 2.0,
      minDetail: 0.5,
    },
    priceRange: "premium",
    pbr: { metalness: 0.95, roughness: 0.45 },
  },
  {
    id: "silver",
    name: "Silver",
    slug: "silver",
    category: "metal",
    method: "DMLS",
    color: "#d8d8dd",
    description:
      "925 sterling silver for fine jewelry and decorative objects. High detail and natural luster after polishing.",
    properties: { strength: 2, flexibility: 2, detail: 5, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 80, y: 80, z: 80 },
      minWallThickness: 0.6,
      minDetail: 0.3,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.18 },
  },

  // --- CERAMIC / BINDER JETTING ---
  {
    id: "sandstone-color",
    name: "Full-Color Sandstone",
    slug: "full-color-sandstone",
    category: "ceramic",
    method: "Binder Jetting",
    color: "#e8d4a8",
    description:
      "Gypsum-based composite supporting full CMYK color printing. Unique for photorealistic figurines, architectural models, and art pieces.",
    properties: { strength: 1, flexibility: 1, detail: 4, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 380, y: 250, z: 200 },
      minWallThickness: 2.0,
      minDetail: 0.4,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.9 },
  },
  {
    id: "ceramic-porcelain",
    name: "Porcelain",
    slug: "porcelain",
    category: "ceramic",
    method: "Binder Jetting",
    color: "#f0ede5",
    description:
      "Glazed porcelain. Food-safe, dishwasher safe. Perfect for functional tableware, planters, and decorative ceramics.",
    properties: { strength: 2, flexibility: 1, detail: 4, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 180 },
      minWallThickness: 3.0,
      minDetail: 0.8,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.3, clearcoat: 0.9 },
  },

  // --- POLYJET / MULTI-JET ---
  {
    id: "vero-white",
    name: "VeroWhite",
    slug: "vero-white",
    category: "resin",
    method: "DLP",
    color: "#f8f8f8",
    description:
      "PolyJet photopolymer. High-resolution rigid plastic with smooth surfaces. Ideal for realistic prototypes and presentation models.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 290, y: 190, z: 200 },
      minWallThickness: 0.6,
      minDetail: 0.1,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.15, clearcoat: 0.8 },
  },
  {
    id: "agilus-black",
    name: "Agilus Black",
    slug: "agilus-black",
    category: "flexible",
    method: "DLP",
    color: "#1a1a1a",
    description:
      "PolyJet rubber-like material. Wide range of shore hardness options. Used in overmolding simulations and ergonomic grips.",
    properties: { strength: 2, flexibility: 5, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 290, y: 190, z: 200 },
      minWallThickness: 0.8,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.6 },
  },
];

/**
 * Curated list of featured materials for the home hero.
 * The most recognizable/iconic material from each category —
 * showcases breadth without overwhelming first-time users.
 */
export const FEATURED_MATERIAL_IDS = [
  "pla-white",       // Plastic — universal starter
  "petg",            // Plastic — modern favorite
  "polycarbonate",   // Engineering plastic
  "nylon-pa12",      // SLS nylon — functional parts
  "resin-standard",  // SLA resin — high detail
  "resin-clear",     // SLA resin — showpiece
  "tpu-flexible",    // Flexible standout
  "nylon-cf",        // Composite — carbon fiber
  "steel-316l",      // Metal — iconic stainless
  "aluminum",        // Metal — lightweight
  "titanium",        // Metal — premium
  "sandstone-color", // Unique — full color
] as const;

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
