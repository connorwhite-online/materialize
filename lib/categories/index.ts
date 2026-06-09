/**
 * Curated browse categories — the editorial taxonomy that powers the
 * category chips on /files and the per-item "Category" picker on the
 * upload / project / collection forms.
 *
 * This is a DISPLAY catalog, deliberately small and flat (no nested
 * subcategories in v1) so it reads cleanly as a row of filter chips
 * and a single Select. It is the cross-content classification axis —
 * files, projects, AND collections all store one optional `category`
 * slug from this list. It is intentionally distinct from:
 *
 *   - free-form `tags`        — uncurated, creator-authored keywords
 *   - `designTags`            — physical-property hints (strong, …)
 *   - `lib/materials`         — what to PRINT it in, not what it IS
 *
 * Categories are stored as plain text slugs (not a Postgres enum) so
 * the taxonomy can grow without a migration — the same posture as
 * `files.recommendedMaterialId`. Validation happens at the app layer
 * via `isCategoryId` / the zod helper below, so an unknown slug from
 * a stale client is rejected on write and ignored on read.
 *
 * `keywords` feed search: a query that matches a category's label,
 * id, or keywords surfaces every item in that category (see the
 * browse page + /api/search), so "gps" or "drone" pulls the right
 * shelf even when no item literally spells it out in its name.
 */

export interface Category {
  /** URL-safe slug stored on the row and used in `?category=`. */
  id: string;
  /** Human label shown on chips and in the Select. */
  label: string;
  /** One-line description for the picker / SEO. */
  description: string;
  /**
   * Extra search synonyms. The label + id are always searched too,
   * so only list words NOT already obvious from the label.
   */
  keywords: string[];
}

/**
 * The catalog. Ordered roughly by how common each shelf is on a
 * general 3D-print marketplace (decor / household / functional lead;
 * niche verticals trail). Chips render in this order.
 */
export const CATEGORIES: Category[] = [
  {
    id: "art-sculpture",
    label: "Art & Sculpture",
    description: "Statues, busts, wall art, and decorative sculpture.",
    keywords: ["art", "sculpture", "statue", "bust", "abstract", "wall art", "decor"],
  },
  {
    id: "home-living",
    label: "Home & Living",
    description: "Decor and everyday objects for the home — vases, planters, lamps, kitchen.",
    keywords: ["home", "household", "kitchen", "bathroom", "vase", "planter", "lamp", "furniture", "decor"],
  },
  {
    id: "organization",
    label: "Storage & Organization",
    description: "Boxes, bins, holders, racks, and drawer organizers.",
    keywords: ["storage", "organizer", "organiser", "box", "bin", "holder", "rack", "drawer", "container", "tray"],
  },
  {
    id: "gadgets",
    label: "Gadgets & Electronics",
    description: "Phone stands, cases, cable management, and enclosures for boards like Raspberry Pi and Arduino.",
    keywords: ["gadget", "electronics", "phone", "case", "stand", "charger", "cable", "raspberry pi", "arduino", "enclosure", "esp32", "pcb"],
  },
  {
    id: "toys-games",
    label: "Toys & Games",
    description: "Toys, puzzles, fidgets, and board-game pieces.",
    keywords: ["toy", "game", "puzzle", "fidget", "board game", "dice", "playset", "kids"],
  },
  {
    id: "tabletop",
    label: "Tabletop & Miniatures",
    description: "Miniatures, terrain, and accessories for tabletop RPGs and wargames.",
    keywords: ["miniature", "mini", "dnd", "d&d", "dungeons", "wargame", "terrain", "warhammer", "rpg", "figurine", "tabletop"],
  },
  {
    id: "props-cosplay",
    label: "Props & Cosplay",
    description: "Costume props, helmets, masks, armor, and replica builds.",
    keywords: ["cosplay", "prop", "costume", "helmet", "mask", "armor", "armour", "replica", "weapon"],
  },
  {
    id: "fashion",
    label: "Fashion & Wearables",
    description: "Wearables and accessories — buckles, clips, hats, and footwear.",
    keywords: ["fashion", "wearable", "clothing", "shoe", "hat", "buckle", "accessory", "belt"],
  },
  {
    id: "jewelry",
    label: "Jewelry",
    description: "Rings, pendants, earrings, and other jewelry.",
    keywords: ["jewelry", "jewellery", "ring", "pendant", "earring", "bracelet", "necklace", "charm"],
  },
  {
    id: "tools",
    label: "Tools & Functional",
    description: "Jigs, fixtures, brackets, mounts, and functional helpers.",
    keywords: ["tool", "jig", "fixture", "clamp", "bracket", "mount", "functional", "hook", "holder", "workshop"],
  },
  {
    id: "replacement-parts",
    label: "Replacement Parts",
    description: "Spare and replacement parts to repair things you already own.",
    keywords: ["replacement", "spare", "repair", "knob", "clip", "fix", "part", "broken"],
  },
  {
    id: "mechanical",
    label: "Mechanical & Engineering",
    description: "Gears, bearings, mechanisms, and robotics components.",
    keywords: ["mechanical", "gear", "bearing", "engineering", "robotics", "actuator", "mechanism", "linkage", "servo"],
  },
  {
    id: "automotive",
    label: "Automotive",
    description: "Parts and accessories for cars, motorcycles, and other vehicles.",
    keywords: ["car", "auto", "automotive", "vehicle", "motorcycle", "truck", "dashboard", "garage"],
  },
  {
    id: "hobby-rc",
    label: "Hobby & RC",
    description: "RC vehicles, drones, FPV, scale models, and dioramas.",
    keywords: ["rc", "drone", "quadcopter", "fpv", "remote control", "model", "scale model", "diorama", "train", "plane", "gps"],
  },
  {
    id: "outdoor-garden",
    label: "Outdoor & Garden",
    description: "Garden, yard, camping, and other outdoor gear.",
    keywords: ["garden", "outdoor", "plant", "yard", "camping", "hiking", "patio", "bird"],
  },
  {
    id: "education",
    label: "Education & Science",
    description: "Teaching aids, science models, anatomy, and lab equipment.",
    keywords: ["education", "science", "school", "learning", "anatomy", "math", "lab", "physics", "stem"],
  },
  {
    id: "sports-fitness",
    label: "Sports & Fitness",
    description: "Gear and accessories for sports, cycling, and fitness.",
    keywords: ["sport", "fitness", "gym", "bike", "bicycle", "cycling", "exercise", "ball"],
  },
  {
    id: "pets",
    label: "Pets",
    description: "Accessories for dogs, cats, aquariums, and other animals.",
    keywords: ["pet", "dog", "cat", "animal", "aquarium", "fish", "bird feeder", "tag"],
  },
  {
    id: "seasonal",
    label: "Seasonal & Holiday",
    description: "Ornaments and decorations for holidays and the seasons.",
    keywords: ["holiday", "christmas", "halloween", "easter", "seasonal", "ornament", "decoration", "thanksgiving"],
  },
  {
    id: "office",
    label: "Office & Stationery",
    description: "Desk organizers, pen holders, and other office supplies.",
    keywords: ["office", "desk", "pen", "stationery", "business card", "cable", "clip"],
  },
  {
    id: "health-medical",
    label: "Health & Medical",
    description: "Assistive devices, prosthetics, braces, and medical aids.",
    keywords: ["medical", "prosthetic", "health", "assistive", "brace", "orthotic", "accessibility"],
  },
];

/** Tuple of every valid category id — feeds the zod enum. */
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [
  string,
  ...string[],
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** label lookup keyed by id (`|| id` fallback at call sites). */
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label])
);

export function getCategoryById(id: string | null | undefined): Category | undefined {
  if (!id) return undefined;
  return CATEGORY_BY_ID.get(id);
}

export function isCategoryId(id: string | null | undefined): boolean {
  return !!id && CATEGORY_BY_ID.has(id);
}

export function getCategoryLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return CATEGORY_BY_ID.get(id)?.label ?? null;
}

/**
 * Category slugs whose label / id / keywords match a free-text query.
 * Used by search to let "drone" or "gps" surface the Hobby & RC shelf
 * even when the item's own name says neither. Case-insensitive
 * substring match, mirroring the ilike semantics used for names.
 */
export function categoryIdsMatchingQuery(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: string[] = [];
  for (const c of CATEGORIES) {
    const haystack = [c.id, c.label, ...c.keywords].join(" ").toLowerCase();
    if (haystack.includes(needle)) out.push(c.id);
  }
  return out;
}
