/**
 * Shared types for the two-step print material picker
 * (material → vendor, with finish + color as filters on the vendor step).
 *
 * `EnrichedQuote` is the provider-neutral quote shape returned by
 * /api/quotes/poll; it lives in `lib/quotes/types.ts` and is
 * re-exported here so picker code keeps one import site.
 */
export type { EnrichedQuote } from "@/lib/quotes/types";

export type PickerStep = "material" | "vendor";

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
