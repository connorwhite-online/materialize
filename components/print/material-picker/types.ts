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
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  color: string;
  colorCode: string;
  configName: string;
}

export type PickerStep = "material" | "finish" | "vendor";
