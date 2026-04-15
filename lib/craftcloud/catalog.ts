import "server-only";

/**
 * CraftCloud material catalog + provider directory.
 *
 * CraftCloud's public v5 price API returns opaque materialConfigId
 * and vendorId strings. Their customer-api exposes:
 *   - /material-catalog  → full material + finish + color structure
 *   - /provider          → vendor slugs mapped to display names
 *
 * Neither requires auth. Both are large but stable; we fetch through
 * Next.js's data cache with a 24h revalidation so the hit only lands
 * once a day across all requests.
 */

const CUSTOMER_API_BASE = "https://customer-api.craftcloud3d.com";
const CATALOG_TTL_SECONDS = 24 * 60 * 60;

// Top-level response shape. We type only the fields we use — the
// upstream JSON has dozens more per material (physical properties,
// provider coverage, apps, tags, etc.) we can layer in later.

export interface MaterialConfig {
  id: string;
  name: string;
  materialId: string;
  materialGroupId: string;
  finishGroupId: string;
  color: string;
  colorCode: string;
  colorImage?: string;
  colorId?: string;
  originalColorName?: string;
}

export interface FinishGroup {
  id: string;
  name: string;
  featuredImage?: string;
  description?: string;
  descriptionShort?: string;
  materialConfigs: MaterialConfig[];
}

export interface CatalogMaterial {
  id: string;
  name: string;
  slug: string;
  featuredImage?: string;
  descriptionShort?: string;
  description?: string;
  materialGroupId: string;
  materialGroupName?: string;
  technology?: string;
  sortIndex?: number;
  maximumPrintingDimensions?: { x: number; y: number; z: number };
  tags?: Array<{ id: string; name: string; originalName?: string }>;
  finishGroups: FinishGroup[];
  // Mechanical / thermal / print properties — ranges where CraftCloud
  // provides both min and max.
  density?: number | null;
  tensileStrengthMin?: number | null;
  tensileStrengthMax?: number | null;
  tensileModulusMin?: number | null;
  tensileModulusMax?: number | null;
  tensileElongationMin?: number | null;
  tensileElongationMax?: number | null;
  flexuralStrengthMin?: number | null;
  flexuralStrengthMax?: number | null;
  flexuralModulusMin?: number | null;
  flexuralModulusMax?: number | null;
  heatDeflectionTemp66PSIMin?: number | null;
  heatDeflectionTemp66PSIMax?: number | null;
  heatDeflectionTemp264PSIMin?: number | null;
  heatDeflectionTemp264PSIMax?: number | null;
  defaultLayerHeight?: number | null;
  defaultInfill?: number | null;
  warpingRisk?: string | null;
  interlockingParts?: boolean | null;
  embossingMin?: number | null;
  engravingMin?: number | null;
  accuracy?: number | null;
  accuracyLowerLimit?: number | null;
}

export interface MaterialGroup {
  id: string;
  name: string;
  materials: CatalogMaterial[];
}

interface CatalogResponse {
  materialStructure: MaterialGroup[];
}

export interface Provider {
  vendorId: string;
  name: string;
  description?: string;
  /**
   * ISO-3166-1 alpha-2 country code of the vendor's headquarters /
   * primary manufacturing location. Optional because CraftCloud
   * doesn't publish it for every provider; when present we render
   * it below the vendor name on the quote card so users can see
   * where the part is shipping from.
   */
  countryCode?: string;
}

/** Thin lookup indexes built once per catalog fetch. */
export interface CraftCloudCatalog {
  groups: MaterialGroup[];
  /** material-id → material */
  materialById: Map<string, CatalogMaterial>;
  /** material-config-id → config (with its parent material + finish group embedded) */
  configById: Map<
    string,
    {
      config: MaterialConfig;
      material: CatalogMaterial;
      finishGroup: FinishGroup;
      group: MaterialGroup;
    }
  >;
  /** Count of configs in the catalog — useful for telemetry */
  configCount: number;
}

let cachedCatalog: CraftCloudCatalog | null = null;
let cachedProviders: Map<string, Provider> | null = null;

async function fetchCatalogJson(): Promise<CatalogResponse> {
  const res = await fetch(`${CUSTOMER_API_BASE}/material-catalog`, {
    // Next.js data cache — shared across requests, revalidates daily.
    next: { revalidate: CATALOG_TTL_SECONDS },
    headers: {
      // Without a reasonable UA the edge sometimes serves a challenge.
      "User-Agent":
        "Mozilla/5.0 (compatible; MaterializeServer/1.0; +https://materialize.cc)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`material-catalog fetch failed: ${res.status}`);
  }
  return (await res.json()) as CatalogResponse;
}

async function fetchProvidersJson(): Promise<Provider[]> {
  const res = await fetch(`${CUSTOMER_API_BASE}/provider`, {
    next: { revalidate: CATALOG_TTL_SECONDS },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MaterializeServer/1.0; +https://materialize.cc)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`provider fetch failed: ${res.status}`);
  }
  return (await res.json()) as Provider[];
}

/**
 * Technologies we're willing to surface in the print quote flow. STL
 * input is only meaningful for additive manufacturing — CNC, sheet
 * metal, injection molding, and vacuum casting all need CAD or 2D
 * flat input and silently fail or produce garbage for a mesh file.
 * Drop those materials entirely so the user never sees them.
 */
const PRINTABLE_TECHNOLOGIES = new Set(["3d_printing"]);

export async function getCraftCloudCatalog(): Promise<CraftCloudCatalog> {
  if (cachedCatalog) return cachedCatalog;

  const json = await fetchCatalogJson();
  const rawGroups = json.materialStructure ?? [];

  const materialById = new Map<string, CatalogMaterial>();
  const configById = new Map<
    string,
    {
      config: MaterialConfig;
      material: CatalogMaterial;
      finishGroup: FinishGroup;
      group: MaterialGroup;
    }
  >();
  let configCount = 0;

  // Build filtered groups in parallel with the index so consumers
  // iterating `catalog.groups` also see only printable materials.
  const groups: MaterialGroup[] = [];
  for (const group of rawGroups) {
    const filteredMaterials: CatalogMaterial[] = [];
    for (const material of group.materials ?? []) {
      if (!PRINTABLE_TECHNOLOGIES.has(material.technology ?? "")) continue;
      if (!material.materialGroupName) material.materialGroupName = group.name;
      materialById.set(material.id, material);
      filteredMaterials.push(material);
      for (const finishGroup of material.finishGroups ?? []) {
        for (const config of finishGroup.materialConfigs ?? []) {
          configById.set(config.id, {
            config,
            material,
            finishGroup,
            group,
          });
          configCount++;
        }
      }
    }
    if (filteredMaterials.length > 0) {
      groups.push({ ...group, materials: filteredMaterials });
    }
  }

  cachedCatalog = { groups, materialById, configById, configCount };
  return cachedCatalog;
}

export async function getProviderIndex(): Promise<Map<string, Provider>> {
  if (cachedProviders) return cachedProviders;
  const list = await fetchProvidersJson();
  cachedProviders = new Map(list.map((p) => [p.vendorId, p]));
  return cachedProviders;
}

export async function findMaterialConfig(configId: string) {
  const catalog = await getCraftCloudCatalog();
  return catalog.configById.get(configId) ?? null;
}

export async function findProvider(vendorId: string): Promise<Provider | null> {
  const providers = await getProviderIndex();
  return providers.get(vendorId) ?? null;
}

export async function findMaterialBySlug(slug: string) {
  const catalog = await getCraftCloudCatalog();
  for (const group of catalog.groups) {
    for (const material of group.materials) {
      if (material.slug === slug) return { material, group };
    }
  }
  return null;
}
