import { NextResponse } from "next/server";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

/**
 * Slim view of the CraftCloud material catalog used to render
 * optimistic skeleton cards on the quote screen before any real
 * quotes have arrived. The client filters this list by the model's
 * bounding box (rotation-aware, see lib/craftcloud/fits-volume.ts)
 * and renders one card per material with skeleton price + leadtime
 * until the corresponding quote lands.
 *
 * The full catalog hit is already cached server-side with a 24h TTL
 * via getCraftCloudCatalog(); this endpoint just projects the bits
 * the picker needs.
 */
export interface ManifestMaterial {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  image: string | null;
  /** CraftCloud's curated popularity rank (lower = more popular). */
  sortIndex: number;
  /** [x, y, z] in mm. Null when CraftCloud doesn't publish one. */
  maxDimensions: [number, number, number] | null;
}

export interface MaterialsManifestResponse {
  materials: ManifestMaterial[];
}

export async function GET() {
  try {
    const catalog = await getCraftCloudCatalog();
    const materials: ManifestMaterial[] = [];
    for (const group of catalog.groups) {
      for (const material of group.materials) {
        materials.push({
          id: material.id,
          name: material.name,
          groupId: material.materialGroupId,
          groupName: group.name,
          image: material.featuredImage ?? null,
          sortIndex: material.sortIndex ?? 9999,
          maxDimensions: material.maximumPrintingDimensions ?? null,
        });
      }
    }
    return NextResponse.json<MaterialsManifestResponse>({ materials });
  } catch (error) {
    logError("api/craftcloud/materials-manifest", error);
    return NextResponse.json(
      { error: "Failed to load materials manifest" },
      { status: 500 }
    );
  }
}
