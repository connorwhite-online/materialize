/**
 * Shared types for the three-step print material picker.
 *
 * `EnrichedQuote` is the shape returned by /api/craftcloud/quotes
 * after the server merges CraftCloud's raw Quote with its
 * material-catalog metadata and provider directory. Every field
 * downstream of the picker reads off this type.
 */
export interface EnrichedQuote {
  quoteId: string;
  vendorId: string;
  vendorName: string;
  /**
   * ISO-3166-1 alpha-2 country code of the vendor. Null when
   * CraftCloud's provider directory doesn't publish one for a
   * given vendor — the vendor card then just hides the country
   * line.
   */
  vendorCountryCode: string | null;
  modelId: string;
  materialConfigId: string;
  printingMethodId?: string | null;
  quantity: number;
  price: number;
  priceInclVat?: number;
  currency: string;
  productionTimeFast: number;
  productionTimeSlow: number;
  scale: number;

  // Catalog-enriched
  materialId: string;
  materialName: string;
  materialGroupId: string;
  materialGroupName: string;
  materialImage: string | null;
  /**
   * CraftCloud's curated popularity ordering — lower = more popular
   * (PLA = 1, SLS Nylon PA12 = 0, 316L Steel = 4). We use it to drive
   * the "Popular materials" section at the top of the picker and to
   * order cards within each group's section. Defaults to a large
   * sentinel when the catalog row is missing it so unknowns sink to
   * the bottom rather than tying with rank-0.
   */
  materialSortIndex: number;
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  color: string;
  colorCode: string;
  configName: string;
}

export type PickerStep = "material" | "finish" | "vendor";

/**
 * Slim material descriptor used to render optimistic cards on the
 * material step before any real quotes have arrived. Filtered by
 * the model's bounding box upstream of the picker, so every entry
 * in this list is "geometrically printable" — but until a quote
 * lands we don't know price, leadtime, or vendor coverage.
 */
export interface OptimisticMaterial {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  image: string | null;
  sortIndex: number;
}
