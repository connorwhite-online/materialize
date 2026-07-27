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
          // 9999 sentinel pushes unranked materials to the bottom of
          // the Popular sort instead of tying with rank-0.
          materialSortIndex: entry.material.sortIndex ?? 9999,
          finishGroupId: entry.finishGroup.id,
          finishGroupName: entry.finishGroup.name,
          finishGroupImage: entry.finishGroup.featuredImage ?? null,
          color: entry.config.color,
          colorCode: entry.config.colorCode,
          configName: entry.config.name,
          vendorName: provider?.name ?? q.vendorId,
          vendorCountryCode: provider?.production?.default?.code ?? null,
          vendorStateCode: provider?.stateCode ?? null,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    const rawCount = priceResponse.quotes?.length ?? 0;

    // A handful of dropped quotes per poll is normal (a config that's
    // brand-new on CraftCloud's side and hasn't hit our 24h-cached
    // catalog yet). A large fraction of a poll's quotes disappearing
    // is a different signal — the cached catalog is meaningfully
    // stale and users are silently seeing fewer materials/vendors
    // than CraftCloud actually quoted. console telemetry below still
    // captures every poll; this only escalates the degraded case to
    // Sentry so it doesn't take a support ticket to notice.
    const DROPPED_CONFIG_RATIO_THRESHOLD = 0.25;
    if (
      rawCount > 0 &&
      droppedNoConfig / rawCount > DROPPED_CONFIG_RATIO_THRESHOLD
    ) {
      logError(
        "quotes.poll.droppedConfigs",
        new Error(
          `Dropped ${droppedNoConfig}/${rawCount} quotes (catalog missing materialConfigId) for priceId ${priceId}`,
          { cause: { priceId, droppedNoConfig, rawCount } }
        )
      );
    }

    // Lightweight telemetry. We log each snapshot so the server
    // log tells a story of how the quote set grows over time and
    // so "why is titanium so expensive?" is answerable from the
    // server log alone.
    const prices = enrichedQuotes.map((q) => q.price).sort((a, b) => a - b);
    console.log("[quotes] poll", {
      priceId,
      rawCount,
      enrichedCount: enrichedQuotes.length,
      droppedNoConfig,
      allComplete: priceResponse.allComplete,
      priceRange: prices.length
        ? {
            min: prices[0],
            median: prices[Math.floor(prices.length / 2)],
            max: prices[prices.length - 1],
          }
        : null,
      distinctMaterials: new Set(enrichedQuotes.map((q) => q.materialId)).size,
      distinctVendors: new Set(enrichedQuotes.map((q) => q.vendorId)).size,
      // Cheapest five quotes with full detail so we can eyeball
      // pricing 1:1 against CraftCloud.com for the same file.
      cheapestFive: enrichedQuotes
        .slice()
        .sort((a, b) => a.price - b.price)
        .slice(0, 5)
        .map((q) => ({
          material: q.materialName,
          finish: q.finishGroupName,
          color: q.color,
          vendor: q.vendorName,
          price: q.price,
          priceInclVat: q.priceInclVat,
          scale: q.scale,
          fast: q.productionTimeFast,
          slow: q.productionTimeSlow,
        })),
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
