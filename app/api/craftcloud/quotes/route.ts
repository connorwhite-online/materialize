import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createPriceRequest, getPrice } from "@/lib/craftcloud/client";
import {
  getCraftCloudCatalog,
  getProviderIndex,
} from "@/lib/craftcloud/catalog";
import { quotesRequestSchema } from "@/lib/validations/print";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = await request.json();
    const parsed = quotesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { fileAssetId, currency, countryCode, quantity } = parsed.data;

    // Get the file asset with access check
    const [assetRow] = await db
      .select({
        asset: fileAssets,
        fileUserId: files.userId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

    if (!assetRow) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    const isOwner = userId && assetRow.fileUserId === userId;
    const isPublished = assetRow.fileStatus === "published";
    if (!isOwner && !isPublished) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const modelId = assetRow.asset.craftCloudModelId;
    if (!modelId) {
      return Response.json(
        { error: "File not yet uploaded for printing. Please wait a moment and try again." },
        { status: 409 }
      );
    }

    const { priceId } = await createPriceRequest({
      currency,
      countryCode,
      models: [{ modelId, quantity }],
    });

    // Poll for prices. CraftCloud's /v5/price endpoint is progressive:
    // `allComplete: false` while fetching additional vendor quotes,
    // and the `quotes` array grows over time. We keep polling until
    // we're complete, we've waited ~20s with at least some quotes,
    // or we hit a 2 minute ceiling (real-API quotes for a 2-3MB file
    // can easily take 90s to land a meaningful spread of vendors).
    const POLL_INTERVAL_MS = 1500;
    const HARD_CEILING_MS = 120_000;
    const GOOD_ENOUGH_MS = 20_000;

    let priceResponse = await getPrice(priceId);
    let elapsed = 0;

    while (!priceResponse.allComplete && elapsed < HARD_CEILING_MS) {
      const haveSome = (priceResponse.quotes?.length ?? 0) > 0;
      if (haveSome && elapsed >= GOOD_ENOUGH_MS) break;

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      elapsed += POLL_INTERVAL_MS;
      priceResponse = await getPrice(priceId);

      if (elapsed % 6000 === 0) {
        console.log("[quotes] polling", {
          elapsedMs: elapsed,
          allComplete: priceResponse.allComplete,
          quoteCount: priceResponse.quotes?.length ?? 0,
        });
      }
    }

    if (!priceResponse.quotes?.length) {
      console.warn("[quotes] no quotes after polling", {
        elapsedMs: elapsed,
        allComplete: priceResponse.allComplete,
        priceId,
      });
      return Response.json(
        {
          error: !priceResponse.allComplete
            ? "CraftCloud is still computing quotes for this file. Try again in a moment."
            : "No quotes available for this file. The model may be too large or complex for available materials.",
        },
        { status: 404 }
      );
    }

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
    const enrichedQuotes = priceResponse.quotes
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
          color: entry.config.color,
          colorCode: entry.config.colorCode,
          configName: entry.config.name,
          vendorName: provider?.name ?? q.vendorId,
        };
      })
      .filter(
        (q): q is NonNullable<typeof q> => q !== null
      );

    // Telemetry — keeps us sane while we iterate on pricing. Logs
    // enough per-quote detail that we can eyeball pricing against
    // CraftCloud.com for the same file.
    const prices = enrichedQuotes
      .map((q) => q.price)
      .sort((a, b) => a - b);
    console.log("[quotes] CraftCloud returned (enriched):", {
      rawCount: priceResponse.quotes.length,
      enrichedCount: enrichedQuotes.length,
      droppedNoConfig,
      priceRange: prices.length
        ? {
            min: prices[0],
            median: prices[Math.floor(prices.length / 2)],
            max: prices[prices.length - 1],
          }
        : null,
      distinctMaterials: new Set(enrichedQuotes.map((q) => q.materialId)).size,
      distinctFinishGroups: new Set(
        enrichedQuotes.map((q) => q.finishGroupId)
      ).size,
      distinctVendors: new Set(enrichedQuotes.map((q) => q.vendorId)).size,
      currency,
      countryCode,
      quantity,
      modelId,
      // Log the five cheapest quotes with full detail so we can
      // compare them 1:1 to what CraftCloud.com shows.
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
      priceId,
    });
  } catch (error) {
    logError("api/craftcloud/quotes", error);
    return Response.json(
      { error: "Failed to fetch quotes. Please try again." },
      { status: 500 }
    );
  }
}
