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
    transmission?: number; // 0-1, how much light passes through (glass/resin)
    ior?: number; // index of refraction, usually ~1.5 for resin/glass
    thickness?: number; // volume thickness for refraction depth
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

  // --- MORE FDM PLASTICS ---
  {
    id: "pla-grey",
    name: "PLA Grey",
    slug: "pla-grey",
    category: "plastic",
    method: "FDM",
    color: "#909090",
    description:
      "Neutral grey PLA — photographs well and hides layer lines better than pure white. Ideal for product mockups and presentation models.",
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
    id: "pla-red",
    name: "PLA Red",
    slug: "pla-red",
    category: "plastic",
    method: "FDM",
    color: "#c02a2a",
    description:
      "Vivid red PLA. Pops under daylight and works well for display pieces, tabletop minis, and bold prototypes.",
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
    id: "pla-blue",
    name: "PLA Blue",
    slug: "pla-blue",
    category: "plastic",
    method: "FDM",
    color: "#1f5fb8",
    description:
      "Deep blue PLA. Rich, saturated color with a semi-matte finish. A go-to for engineering prototypes that need to read clearly in photos.",
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
    id: "pla-green",
    name: "PLA Green",
    slug: "pla-green",
    category: "plastic",
    method: "FDM",
    color: "#2c8d4a",
    description:
      "Forest green PLA. Natural-looking tone suited to organic shapes, planters, and nature-themed models.",
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
    id: "abs-black",
    name: "ABS Black",
    slug: "abs-black",
    category: "plastic",
    method: "FDM",
    color: "#1a1a1a",
    description:
      "Black ABS for tougher enclosures and parts that'll see real use. Better heat tolerance than PLA, common in automotive and electronics housings.",
    properties: { strength: 3, flexibility: 2, detail: 2, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.45 },
  },
  {
    id: "petg-black",
    name: "PETG Black",
    slug: "petg-black",
    category: "plastic",
    method: "FDM",
    color: "#101010",
    description:
      "PETG in a glossy black finish. Tough, chemical-resistant, and slightly more forgiving than ABS. A reliable pick for functional parts.",
    properties: { strength: 3, flexibility: 2, detail: 3, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 300, y: 300, z: 400 },
      minWallThickness: 1.0,
      minDetail: 0.6,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.3, clearcoat: 0.4 },
  },
  {
    id: "petg-clear",
    name: "PETG Clear",
    slug: "petg-clear",
    category: "plastic",
    method: "FDM",
    color: "#e8f0f0",
    description:
      "Semi-transparent PETG. Lets light through without the brittleness of standard clear resins. Good for light pipes, covers, and enclosures.",
    properties: { strength: 3, flexibility: 2, detail: 3, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 300, y: 300, z: 400 },
      minWallThickness: 1.0,
      minDetail: 0.6,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.15, clearcoat: 0.7 },
  },
  {
    id: "polypropylene-fdm",
    name: "Polypropylene",
    slug: "polypropylene-fdm",
    category: "plastic",
    method: "FDM",
    color: "#d8d4ce",
    description:
      "Lightweight and chemically inert. Excellent fatigue resistance makes it the go-to for living hinges, snap-fits, and chemical-contact parts.",
    properties: { strength: 2, flexibility: 4, detail: 2, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.5,
      minDetail: 1.0,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.55 },
  },
  {
    id: "nylon-6",
    name: "Nylon 6",
    slug: "nylon-6",
    category: "plastic",
    method: "FDM",
    color: "#d8d4c4",
    description:
      "Tougher and more impact-resistant than PA12. Good for gears, bushings, and wear surfaces. Absorbs moisture so post-print drying is important.",
    properties: { strength: 4, flexibility: 3, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.7 },
  },
  {
    id: "hips",
    name: "HIPS",
    slug: "hips",
    category: "plastic",
    method: "FDM",
    color: "#ecebe6",
    description:
      "High-Impact Polystyrene. Lightweight and easy to paint or sand. Often used for signage, light diffusers, and display prototypes.",
    properties: { strength: 2, flexibility: 2, detail: 3, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 300 },
      minWallThickness: 1.2,
      minDetail: 0.8,
    },
    priceRange: "budget",
    pbr: { metalness: 0, roughness: 0.55 },
  },

  // --- MORE SLS ---
  {
    id: "alumide",
    name: "Alumide",
    slug: "alumide",
    category: "composite",
    method: "SLS",
    color: "#a8a49a",
    description:
      "Nylon infused with aluminum powder. Metallic-looking finish with the printability of plastic. Rigid and dimensionally stable — great for design models.",
    properties: { strength: 3, flexibility: 1, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 1.0,
      minDetail: 0.5,
    },
    priceRange: "mid",
    pbr: { metalness: 0.4, roughness: 0.65 },
  },
  {
    id: "polypropylene-sls",
    name: "Polypropylene (SLS)",
    slug: "polypropylene-sls",
    category: "plastic",
    method: "SLS",
    color: "#dcdad2",
    description:
      "SLS-printed PP with true injection-molding properties. Living hinges, fluid channels, and chemically resistant housings benefit from this process.",
    properties: { strength: 3, flexibility: 4, detail: 3, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 0.8,
      minDetail: 0.4,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.7 },
  },
  {
    id: "nylon-pa12-gf",
    name: "Nylon PA12 Glass-Filled",
    slug: "nylon-pa12-gf",
    category: "composite",
    method: "SLS",
    color: "#d8d2c0",
    description:
      "Glass-bead-filled PA12. Significantly stiffer and more thermally stable than pure PA12. Ideal for structural components and jigs.",
    properties: { strength: 4, flexibility: 2, detail: 3, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 0.8,
      minDetail: 0.4,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.78 },
  },
  {
    id: "nylon-pa12-mf",
    name: "Nylon PA12 Mineral-Filled",
    slug: "nylon-pa12-mf",
    category: "composite",
    method: "SLS",
    color: "#c8c2b6",
    description:
      "Mineral-filled PA12 with increased stiffness and improved surface finish. A cost-effective choice for load-bearing mechanical parts.",
    properties: { strength: 4, flexibility: 2, detail: 3, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 340, y: 340, z: 600 },
      minWallThickness: 0.8,
      minDetail: 0.4,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.8 },
  },

  // --- MORE MJF ---
  {
    id: "mjf-pa11",
    name: "MJF PA11",
    slug: "mjf-pa11",
    category: "plastic",
    method: "MJF",
    color: "#403c38",
    description:
      "Bio-based PA11 via Multi Jet Fusion. Superior ductility and impact resistance compared to PA12. Great for snap-fits and hinges.",
    properties: { strength: 4, flexibility: 4, detail: 4, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 380, y: 284, z: 380 },
      minWallThickness: 0.7,
      minDetail: 0.3,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.75 },
  },
  {
    id: "mjf-pa12-gb",
    name: "MJF PA12 Glass Beads",
    slug: "mjf-pa12-gb",
    category: "composite",
    method: "MJF",
    color: "#3a3a3a",
    description:
      "Glass-bead-filled PA12 via MJF. Stiffer and more heat-resistant than pure PA12, with the smooth MJF finish. Structural parts and housings.",
    properties: { strength: 4, flexibility: 2, detail: 4, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 380, y: 284, z: 380 },
      minWallThickness: 0.8,
      minDetail: 0.4,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.78 },
  },
  {
    id: "mjf-pp",
    name: "MJF Polypropylene",
    slug: "mjf-pp",
    category: "plastic",
    method: "MJF",
    color: "#dcd7cc",
    description:
      "Polypropylene via HP Multi Jet Fusion. Tight tolerances, chemical resistance, and high ductility. Good for fluid-handling and living hinges.",
    properties: { strength: 3, flexibility: 4, detail: 4, heatResistance: 3 },
    constraints: {
      maxDimensions: { x: 380, y: 284, z: 380 },
      minWallThickness: 0.8,
      minDetail: 0.4,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.72 },
  },

  // --- MORE RESINS ---
  {
    id: "resin-grey",
    name: "Grey Resin",
    slug: "resin-grey",
    category: "resin",
    method: "SLA",
    color: "#7a7a7a",
    description:
      "The workhorse SLA resin. Neutral grey is ideal for concept models and visually reading details — no color bias in photography.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.2, clearcoat: 0.6 },
  },
  {
    id: "resin-white",
    name: "White Resin",
    slug: "resin-white",
    category: "resin",
    method: "SLA",
    color: "#f0f0f0",
    description:
      "Clean white SLA resin. The classic 'jewelry display' finish. Paintable and ideal for presentation-ready models.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.18, clearcoat: 0.7 },
  },
  {
    id: "resin-black",
    name: "Black Resin",
    slug: "resin-black",
    category: "resin",
    method: "SLA",
    color: "#1a1a1a",
    description:
      "Deep black SLA. Hides layer lines well and looks premium on camera. Used for product photography, lenses housings, and display models.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.18, clearcoat: 0.8 },
  },
  {
    id: "resin-durable",
    name: "Durable Resin",
    slug: "resin-durable",
    category: "resin",
    method: "SLA",
    color: "#d8d4c8",
    description:
      "Polypropylene-like resin with excellent wear resistance and flexibility. Good for low-friction assemblies and parts that need to flex without snapping.",
    properties: { strength: 3, flexibility: 4, detail: 5, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.6,
      minDetail: 0.15,
    },
    priceRange: "mid",
    pbr: { metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  },
  {
    id: "resin-rigid",
    name: "Rigid Resin",
    slug: "resin-rigid",
    category: "resin",
    method: "SLA",
    color: "#e6e2d8",
    description:
      "Glass-filled engineering resin. Extremely stiff and thermally stable. Used for jigs, fixtures, and molds for short-run injection work.",
    properties: { strength: 4, flexibility: 1, detail: 5, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.6,
      minDetail: 0.15,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  },
  {
    id: "resin-dental-model",
    name: "Dental Model Resin",
    slug: "resin-dental-model",
    category: "resin",
    method: "SLA",
    color: "#e8d8c0",
    description:
      "Ivory-tinted resin for dental study models and orthodontic aligners. High accuracy and a natural tooth color.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.4,
      minDetail: 0.08,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.25, clearcoat: 0.6 },
  },
  {
    id: "resin-biomed-clear",
    name: "BioMed Clear",
    slug: "resin-biomed-clear",
    category: "resin",
    method: "SLA",
    color: "#e4e8eb",
    description:
      "Biocompatible medical-grade clear resin. Used for in-mouth dental applications, skin-contact parts, and short-term medical devices.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 2 },
    constraints: {
      maxDimensions: { x: 145, y: 145, z: 185 },
      minWallThickness: 0.5,
      minDetail: 0.1,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.08, clearcoat: 1.0 },
  },

  // --- MORE METALS ---
  {
    id: "steel-15-5ph",
    name: "Stainless Steel 15-5 PH",
    slug: "stainless-steel-15-5ph",
    category: "metal",
    method: "DMLS",
    color: "#939393",
    description:
      "Precipitation-hardening stainless steel. Higher toughness than 17-4 PH with similar corrosion resistance. Aerospace and defense applications.",
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
    id: "steel-304l",
    name: "Stainless Steel 304L",
    slug: "stainless-steel-304l",
    category: "metal",
    method: "DMLS",
    color: "#8e8e8e",
    description:
      "Classic austenitic stainless steel with excellent weldability and corrosion resistance. Widely used in food, chemical, and architectural applications.",
    properties: { strength: 4, flexibility: 2, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.4 },
  },
  {
    id: "tool-steel-h13",
    name: "Tool Steel H13",
    slug: "tool-steel-h13",
    category: "metal",
    method: "DMLS",
    color: "#6e6e6e",
    description:
      "Hot-work tool steel. Exceptional wear resistance and dimensional stability at high temperatures. The go-to for injection mold inserts.",
    properties: { strength: 5, flexibility: 1, detail: 4, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.45 },
  },
  {
    id: "maraging-steel",
    name: "Maraging Steel 1.2709",
    slug: "maraging-steel-1-2709",
    category: "metal",
    method: "DMLS",
    color: "#7c7a78",
    description:
      "Ultra-high-strength tool steel. Heat-treatable to exceptional hardness. Used for high-stress tooling, molds, and aerospace components.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.42 },
  },
  {
    id: "aluminum-6061",
    name: "Aluminum A6061",
    slug: "aluminum-a6061",
    category: "metal",
    method: "DMLS",
    color: "#c0c0c0",
    description:
      "Classic wrought aluminum alloy in additive form. Excellent strength-to-weight, good machinability, and standard for structural aerospace parts.",
    properties: { strength: 4, flexibility: 1, detail: 3, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.4 },
  },
  {
    id: "titanium-grade2",
    name: "Titanium Grade 2",
    slug: "titanium-grade-2",
    category: "metal",
    method: "DMLS",
    color: "#787878",
    description:
      "Commercially pure titanium. Softer and more formable than Ti6Al4V. Medical implants, chemical processing, and marine hardware.",
    properties: { strength: 4, flexibility: 2, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.35 },
  },
  {
    id: "inconel-718",
    name: "Inconel 718",
    slug: "inconel-718",
    category: "metal",
    method: "DMLS",
    color: "#807a72",
    description:
      "Age-hardenable nickel superalloy. Retains strength at extreme temperatures — jet engine hot sections, rocket nozzles, turbine blades.",
    properties: { strength: 5, flexibility: 1, detail: 3, heatResistance: 5 },
    constraints: {
      maxDimensions: { x: 250, y: 250, z: 325 },
      minWallThickness: 0.5,
      minDetail: 0.2,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.48 },
  },
  {
    id: "gold-18k",
    name: "18K Gold",
    slug: "18k-gold",
    category: "metal",
    method: "DMLS",
    color: "#d4a94a",
    description:
      "18-karat gold for fine jewelry and luxury objects. Direct metal printing eliminates casting for small-run high-value pieces.",
    properties: { strength: 2, flexibility: 2, detail: 5, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 80, y: 80, z: 80 },
      minWallThickness: 0.6,
      minDetail: 0.3,
    },
    priceRange: "premium",
    pbr: { metalness: 1, roughness: 0.15 },
  },
  {
    id: "brass",
    name: "Brass",
    slug: "brass",
    category: "metal",
    method: "Binder Jetting",
    color: "#b89952",
    description:
      "Infiltrated brass composite. Warm yellow metallic finish ideal for decorative hardware, musical instrument parts, and jewelry.",
    properties: { strength: 3, flexibility: 1, detail: 4, heatResistance: 4 },
    constraints: {
      maxDimensions: { x: 200, y: 200, z: 180 },
      minWallThickness: 2.0,
      minDetail: 0.5,
    },
    priceRange: "premium",
    pbr: { metalness: 0.95, roughness: 0.4 },
  },

  // --- MORE POLYJET ---
  {
    id: "vero-black",
    name: "VeroBlack",
    slug: "vero-black",
    category: "resin",
    method: "DLP",
    color: "#121212",
    description:
      "Rigid black PolyJet photopolymer. High-resolution prints with crisp edges. Ideal for presentation models and appearance prototypes.",
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
    id: "vero-clear",
    name: "VeroClear",
    slug: "vero-clear",
    category: "resin",
    method: "DLP",
    color: "#ecedef",
    description:
      "Transparent PolyJet photopolymer. Glass-like appearance after polishing. Used for visualizing internal geometry and clear enclosures.",
    properties: { strength: 2, flexibility: 1, detail: 5, heatResistance: 1 },
    constraints: {
      maxDimensions: { x: 290, y: 190, z: 200 },
      minWallThickness: 0.6,
      minDetail: 0.1,
    },
    priceRange: "premium",
    pbr: { metalness: 0, roughness: 0.06, clearcoat: 1.0 },
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
