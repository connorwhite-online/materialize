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
  // CraftCloud sends this as a positional [x, y, z] tuple in mm.
  // Some materials omit it entirely (e.g. material types where build
  // size is vendor-dependent rather than process-bounded).
  maximumPrintingDimensions?: [number, number, number];
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
   * Manufacturing location, keyed by purpose. `default` is the
   * canonical production address; `origin` (rarely populated) maps
   * alternate origins by routing code. We only read `default` —
   * `name` is the rendered country name and `code` is the
   * ISO-3166-1 alpha-2.
   */
  production?: {
    default?: {
      name: string;
      code: string;
      originalName?: string;
    };
    origin?: Record<
      string,
      { name: string; code: string; originalName?: string }
    >;
  };
  /**
   * Subnational code (ISO 3166-2 style without the country prefix).
   * Examples observed in the wild: `TX`, `CA`, `BC`, `ON`, `JAL`.
   * Present on every provider record but often null. We pair it
   * with `production.default.code` to render "Texas, United States"
   * and equivalents below the vendor name on the quote card.
   */
  stateCode?: string | null;
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

// CraftCloud's edge intermittently serves a 403/429 challenge to
// datacenter IPs — most visibly during `next build`, where a single
// cold prerender fetch from a Vercel build IP can be challenged and
// 403 even though the endpoint needs no auth. A couple of quick
// retries clear the transient challenge; a persistent failure still
// throws so callers (and the strict quote path) see the real outage.
const FETCH_RETRY_STATUSES = new Set([403, 429, 500, 502, 503, 504]);
const FETCH_MAX_ATTEMPTS = 3;

async function fetchCatalogResource(
  path: string,
  label: string
): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${CUSTOMER_API_BASE}${path}`, {
      // Next.js data cache — shared across requests, revalidates daily.
      next: { revalidate: CATALOG_TTL_SECONDS },
      headers: {
        // Without a reasonable UA the edge sometimes serves a challenge.
        "User-Agent":
          "Mozilla/5.0 (compatible; MaterializeServer/1.0; +https://materialize.cc)",
        Accept: "application/json",
      },
    });
    if (res.ok) return res;
    lastStatus = res.status;
    if (!FETCH_RETRY_STATUSES.has(res.status)) break;
    if (attempt < FETCH_MAX_ATTEMPTS) {
      // Short linear backoff (150ms, 300ms). The challenge clears
      // almost immediately, so we don't need long waits.
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  throw new Error(`${label} fetch failed: ${lastStatus}`);
}

async function fetchCatalogJson(): Promise<CatalogResponse> {
  const res = await fetchCatalogResource("/material-catalog", "material-catalog");
  return (await res.json()) as CatalogResponse;
}

async function fetchProvidersJson(): Promise<Provider[]> {
  const res = await fetchCatalogResource("/provider", "provider");
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
