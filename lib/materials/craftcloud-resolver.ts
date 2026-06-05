import "server-only";

import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

/**
 * Bridge our editorial material library (`lib/materials`, ids like
 * "pla-white") to the live CraftCloud catalog (opaque UUID material
 * ids) so a file's stated `recommendedMaterialId` can pre-scope the
 * print quote flow.
 *
 * Why match by NAME and not a hardcoded id table: CraftCloud material
 * ids are opaque UUIDs that differ per environment and can churn when
 * the catalog updates. Curated name match-specs resolve at runtime
 * against whatever catalog is live, so they survive that churn and work
 * the same in sandbox and prod.
 *
 * What we return is a CraftCloud *material* id (not a config/color id):
 * the configurator's `preselectMaterialId` scopes the picker to a
 * material, and the user still chooses finish / colour / vendor. So we
 * only need to land on the right material, not a specific colour — which
 * keeps the matching robust.
 *
 * Conservative by design: if no confident match exists, return null and
 * the flow falls back to the full unscoped picker (today's behaviour).
 * A wrong scope is worse than no scope.
 *
 * Long-term ownership of this table is tracked in CON-92 — validate the
 * specs against the live catalog and extend as the editorial library
 * grows.
 */

interface MatchSpec {
  /** Lowercased tokens that must ALL appear in the CraftCloud material name. */
  allOf: string[];
  /**
   * Tie-breaker token. When several materials match `allOf` (e.g. SLS vs
   * HP MJF Nylon PA12), prefer the one whose name also contains this.
   */
  prefer?: string;
}

/**
 * Editorial preset id → CraftCloud material name match-spec. Colour
 * variants of the same base material (pla-white / pla-black) share a
 * spec because colour is chosen downstream in the picker.
 */
const MATCH_SPECS: Record<string, MatchSpec> = {
  "pla-white": { allOf: ["pla"] },
  "pla-black": { allOf: ["pla"] },
  "abs-white": { allOf: ["abs"] },
  // Two CraftCloud nylon PA12 lines (SLS and HP MJF); our preset is SLS.
  "nylon-pa12": { allOf: ["nylon", "pa12"], prefer: "sls" },
  "nylon-pa12-black": { allOf: ["nylon", "pa12"], prefer: "sls" },
  "nylon-pa11": { allOf: ["nylon", "pa11"] },
  "resin-standard": { allOf: ["resin"], prefer: "standard" },
  "resin-tough": { allOf: ["resin"], prefer: "tough" },
  "tpu-flexible": { allOf: ["tpu"] },
  "steel-316l": { allOf: ["316l"] },
  // Matches both "Aluminum" and "Aluminium" spellings.
  aluminum: { allOf: ["alumin"] },
  titanium: { allOf: ["titanium"] },
  petg: { allOf: ["petg"] },
  asa: { allOf: ["asa"] },
  polycarbonate: { allOf: ["polycarbonate"] },
};

/**
 * Pure resolver — kept independent of the catalog module so it's unit
 * testable with synthetic material lists. Returns the matched CraftCloud
 * material id, or null when nothing matches confidently.
 */
export function matchCraftCloudMaterialId(
  recommendedMaterialId: string,
  materials: ReadonlyArray<{ id: string; name: string }>
): string | null {
  const spec = MATCH_SPECS[recommendedMaterialId];
  if (!spec) return null;

  const candidates = materials.filter((m) => {
    const name = m.name.toLowerCase();
    return spec.allOf.every((token) => name.includes(token));
  });
  if (candidates.length === 0) return null;

  if (spec.prefer) {
    const preferred = candidates.find((m) =>
      m.name.toLowerCase().includes(spec.prefer!)
    );
    if (preferred) return preferred.id;
  }
  return candidates[0].id;
}

/**
 * Resolve a file's editorial `recommendedMaterialId` to a CraftCloud
 * material id by matching against the live catalog. Returns null (no
 * preselect) on no match or any catalog failure — never throws.
 */
export async function resolveRecommendedCraftCloudMaterialId(
  recommendedMaterialId: string | null | undefined
): Promise<string | null> {
  if (!recommendedMaterialId) return null;
  if (!MATCH_SPECS[recommendedMaterialId]) return null;
  try {
    const catalog = await getCraftCloudCatalog();
    const materials = Array.from(catalog.materialById.values()).map((m) => ({
      id: m.id,
      name: m.name,
    }));
    return matchCraftCloudMaterialId(recommendedMaterialId, materials);
  } catch (error) {
    logError("resolveRecommendedCraftCloudMaterialId", error);
    return null;
  }
}
