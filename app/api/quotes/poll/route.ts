import { getQuoteProvider } from "@/lib/quotes";
import { logError } from "@/lib/logger";

/**
 * Snapshot the current state of a quote request. The client polls
 * this every ~1.5s until `allComplete: true` or a hard ceiling
 * elapses on its side. Each response is the complete enriched quote
 * set *so far* — the client can safely replace its state with
 * whatever we return (no merging needed, the provider tracks the
 * growing list itself).
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

    const { snapshot, stats } = await getQuoteProvider().getSnapshot(priceId);
    const { quotes } = snapshot;
    const { rawCount, droppedCount } = stats;

    // A handful of dropped quotes per poll is normal (a config that's
    // brand-new on the provider's side and hasn't hit our cached
    // catalog yet). A large fraction of a poll's quotes disappearing
    // is a different signal — the cached catalog is meaningfully
    // stale and users are silently seeing fewer materials/vendors
    // than the provider actually quoted. console telemetry below still
    // captures every poll; this only escalates the degraded case to
    // Sentry so it doesn't take a support ticket to notice.
    const DROPPED_CONFIG_RATIO_THRESHOLD = 0.25;
    if (rawCount > 0 && droppedCount / rawCount > DROPPED_CONFIG_RATIO_THRESHOLD) {
      logError(
        "quotes.poll.droppedConfigs",
        new Error(
          `Dropped ${droppedCount}/${rawCount} quotes (catalog missing materialConfigId) for priceId ${priceId}`,
          { cause: { priceId, droppedNoConfig: droppedCount, rawCount } }
        )
      );
    }

    // Lightweight telemetry. We log each snapshot so the server
    // log tells a story of how the quote set grows over time and
    // so "why is titanium so expensive?" is answerable from the
    // server log alone.
    const prices = quotes.map((q) => q.price).sort((a, b) => a - b);
    console.log("[quotes] poll", {
      priceId,
      rawCount,
      enrichedCount: quotes.length,
      droppedNoConfig: droppedCount,
      allComplete: snapshot.allComplete,
      priceRange: prices.length
        ? {
            min: prices[0],
            median: prices[Math.floor(prices.length / 2)],
            max: prices[prices.length - 1],
          }
        : null,
      distinctMaterials: new Set(quotes.map((q) => q.materialId)).size,
      distinctVendors: new Set(quotes.map((q) => q.vendorId)).size,
      // Cheapest five quotes with full detail so we can eyeball
      // pricing 1:1 against the provider's own site for the same file.
      cheapestFive: quotes
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

    return Response.json(snapshot);
  } catch (error) {
    logError("api/quotes/poll", error);
    return Response.json(
      { error: "Failed to fetch quote snapshot." },
      { status: 500 }
    );
  }
}
