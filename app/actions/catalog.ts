"use server";

import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";

export interface MaterialSummary {
  materialId: string;
  materialName: string;
  materialGroupId: string;
  materialGroupName: string;
  materialImage: string | null;
  /** Number of material configs (finish × color combos) in this material. */
  optionCount: number;
  /**
   * Largest printable bounding box across all configs for this material.
   * Used client-side to pre-filter materials that can't fit the user's
   * file before the /v5/price polling lands. CraftCloud reports this at
   * the material level, not per-config.
   */
  maxDimensions: { x: number; y: number; z: number } | null;
}

/**
 * Return a flat list of every printable material in the CraftCloud
 * catalog, slimmed down to the fields the material picker needs.
 * Called from the client on QuoteConfigurator mount so the material
 * grid can render the full option set immediately, with price/eta
 * fields skeleton-pulsing until quotes stream in.
 */
export async function getPrintableMaterialSummaries(): Promise<
  MaterialSummary[]
> {
  const catalog = await getCraftCloudCatalog();
  const summaries: MaterialSummary[] = [];

  for (const group of catalog.groups) {
    for (const material of group.materials) {
      let optionCount = 0;
      for (const finishGroup of material.finishGroups ?? []) {
        optionCount += finishGroup.materialConfigs?.length ?? 0;
      }
      summaries.push({
        materialId: material.id,
        materialName: material.name,
        materialGroupId: material.materialGroupId,
        materialGroupName: material.materialGroupName ?? group.name,
        materialImage: material.featuredImage ?? null,
        optionCount,
        maxDimensions: material.maximumPrintingDimensions ?? null,
      });
    }
  }

  return summaries;
}
