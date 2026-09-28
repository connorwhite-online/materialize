import "server-only";
import { getMaterialById } from "@/lib/materials";
import { findMaterialConfig } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

export interface OrderMaterialDisplay {
  name: string;
  method: string | null;
  color: string | null;
}

/**
 * Display info for `printOrders.material` / `printOrderItems.materialConfigId`,
 * which hold a CraftCloud config UUID — not a lib/materials id, so
 * `getMaterialById` alone missed every real order and the row fell back
 * to the word "Material". Legacy rows that stored a local id still
 * resolve through it first.
 */
export async function resolveOrderMaterials(
  ids: Array<string | null | undefined>,
): Promise<Map<string, OrderMaterialDisplay>> {
  const out = new Map<string, OrderMaterialDisplay>();
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  await Promise.all(
    unique.map(async (id) => {
      const local = getMaterialById(id);
      if (local) {
        out.set(id, {
          name: local.name,
          method: local.method ?? null,
          color: local.color ?? null,
        });
        return;
      }
      try {
        const hit = await findMaterialConfig(id);
        if (!hit) return;
        out.set(id, {
          name: hit.material.name,
          method: hit.config.color || null,
          color: hit.config.colorCode || null,
        });
      } catch (error) {
        // Catalog outage: the row just shows without a material name.
        logError("resolveOrderMaterials", error);
      }
    }),
  );
  return out;
}
