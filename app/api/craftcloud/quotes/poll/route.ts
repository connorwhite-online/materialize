import { getPrice } from "@/lib/craftcloud/client";
import {
  getCraftCloudCatalog,
  getProviderIndex,
} from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

/**
 * Snapshot the current state of a CraftCloud price request. The
 * client polls this every ~1.5s until `allComplete: true` or a
 * hard ceiling elapses on its side. Each response is the complete
 * enriched quote set *so far* — the client can safely replace its
 * state with whatever we return (no merging needed, CraftCloud
 * tracks the growing list itself).
 */
export async function GET(request: Request) {
  try {
    const priceId = new URL(request.url).searchParams.get("priceId");
    if (!priceId) {
      return Response.json(
        { error: "Missing priceId" },
        { status: 400 }
      );
    }

    const priceResponse = await getPrice(priceId);

    // Enrich every quote with catalog metadata — material, finish
    // group, color, provider name, etc. Quotes whose materialConfigId
    // is not in our cached catalog are dropped (should be very rare
    // and usually indicates the catalog is stale relative to new
    // vendor configs). The cached catalog is shared across all
    // requests via Next's data cache.
    const [catalog, providers] = await Promise.all([
      getCraftCloudCatalog(),
      getProviderIndex(),
    ]);

    let droppedNoConfig = 0;
    const enrichedQuotes = (priceResponse.quotes ?? [])
      .map((q) => {
        const entry = catalog.configById.get(q.materialConfigId);
        if (!entry) {
          droppedNoConfig++;
          return null;
        }
        const provider = providers.get(q.vendorId);
        return {
          ...q,
          materialId: entry.material.id,
          materialName: entry.material.name,
          materialGroupId: entry.material.materialGroupId,
          materialGroupName: entry.group.name,
          materialImage: entry.material.featuredImage ?? null,
          finishGroupId: entry.finishGroup.id,
          finishGroupName: entry.finishGroup.name,
          finishGroupImage: entry.finishGroup.featuredImage ?? null,
          color: entry.config.color,
          colorCode: entry.config.colorCode,
          configName: entry.config.name,
          vendorName: provider?.name ?? q.vendorId,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    // Lightweight telemetry. We log each snapshot so the server
    // log tells a story of how the quote set grows over time.
    console.log("[quotes] poll", {
      priceId,
      rawCount: priceResponse.quotes?.length ?? 0,
      enrichedCount: enrichedQuotes.length,
      droppedNoConfig,
      allComplete: priceResponse.allComplete,
    });

    return Response.json({
      quotes: enrichedQuotes,
      shipping: priceResponse.shippings || priceResponse.shipping || [],
      allComplete: priceResponse.allComplete,
    });
  } catch (error) {
    logError("api/craftcloud/quotes/poll", error);
    return Response.json(
      { error: "Failed to fetch quote snapshot." },
      { status: 500 }
    );
  }
}
