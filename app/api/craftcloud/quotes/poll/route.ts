import { CraftCloudApiError, getPrice } from "@/lib/craftcloud/client";
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
// CraftCloud price ids are opaque tokens (UUIDs live, `mock-price-…`
// in mock mode). Anything else is not ours to forward upstream.
const PRICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(request: Request) {
  try {
    const priceId = new URL(request.url).searchParams.get("priceId");
    if (!priceId) {
      return Response.json(
        { error: "Missing priceId" },
        { status: 400 }
      );
    }
    if (!PRICE_ID_PATTERN.test(priceId)) {
      return Response.json({ error: "Invalid priceId" }, { status: 400 });
    }

    // Enrich every quote with catalog metadata — material, finish
    // group, color, provider name, etc. Quotes whose materialConfigId
    // is not in our cached catalog are dropped (should be very rare
    // and usually indicates the catalog is stale relative to new
    // vendor configs). The catalog + provider index are memoized per
    // server instance (see catalog.ts), and fetched alongside the
    // snapshot so a cold instance doesn't pay for them in series.
    //
    // request.signal is forwarded so a poll the client abandoned
    // (region/quantity change, navigation) stops waiting on upstream.
    const [priceResponse, catalog, providers] = await Promise.all([
      getPrice(priceId, { signal: request.signal }),
      getCraftCloudCatalog(),
      getProviderIndex(),
    ]);

    let droppedNoConfig = 0;
    const enrichedQuotes = (priceResponse.quotes ?? [])
      .map((q) => {
        const entry = catalog.configById.get(q.materialConfigId);
        if (!entry) {
          // CNC quotes are excluded by design (see PRINTABLE_TECHNOLOGIES);
          // only count configs the catalog has never seen.
          if (!catalog.excludedConfigIds?.has(q.materialConfigId)) droppedNoConfig++;
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
    // The client went away mid-poll; nobody reads this response and
    // it isn't an upstream failure worth logging.
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    // Upstream status classes must survive the hop: the client's
    // poll loop (components/print/poll-quotes.ts) bails after three
    // consecutive 4xx — the "stale priceId" exit for a tab that was
    // backgrounded past CraftCloud's TTL. Flattening every failure to
    // 500 meant that exit could never fire and the user watched a
    // loader for the full 90s ceiling.
    if (error instanceof CraftCloudApiError) {
      const upstream = error.status;
      const isClientError =
        upstream >= 400 &&
        upstream < 500 &&
        upstream !== 408 &&
        upstream !== 429;
      if (isClientError) {
        // Expected whenever a priceId ages out — not Sentry-worthy.
        console.warn("[quotes] poll: priceId rejected upstream", {
          upstream,
        });
        return Response.json(
          { error: "This quote request has expired. Please refresh quotes." },
          { status: 410 }
        );
      }
      logError("api/craftcloud/quotes/poll", error);
      return Response.json(
        { error: "Failed to fetch quote snapshot." },
        { status: upstream === 504 ? 504 : 502 }
      );
    }
    logError("api/craftcloud/quotes/poll", error);
    return Response.json(
      { error: "Failed to fetch quote snapshot." },
      { status: 500 }
    );
  }
}
