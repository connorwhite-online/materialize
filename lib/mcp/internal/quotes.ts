import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import {
  createPriceRequest,
  getPrice,
  CraftCloudApiError,
} from "@/lib/craftcloud/client";
import {
  getCraftCloudCatalog,
  getProviderIndex,
} from "@/lib/craftcloud/catalog";
import { getVendorMinimums } from "@/lib/craftcloud/vendor-minimums";
import { pickMinimumProbes } from "@/components/print/material-picker/vendor-minimums";
import { logError } from "@/lib/logger";
import { ensureGeometry } from "./geometry";
import { isPublicListing } from "@/lib/files/public-listing";
import {
  arrivalWindow,
  byBuyerTotal,
  chooseLead,
  parseDays,
  processOf,
  trimQuotes,
  type Lead,
  quoteTotals,
  vendorsToProbe,
  type QuoteTotals,
} from "./quote-totals";

/** Follow-up probe rounds after the picker's first batch, and their size. */
const MINIMUM_PROBE_ROUNDS = 4;
const PROBES_PER_ROUND = 10;

export interface AgentQuote extends QuoteTotals {
  priceId: string;
  quoteId: string;
  vendorId: string;
  vendorName: string;
  materialId: string;
  materialName: string;
  finishGroupId: string;
  finishGroupName: string;
  materialConfigId: string;
  color: string;
  /** Printing process, e.g. "FDM", "SLS", "MJF" (null when unknown). */
  process: string | null;
  priceCents: number;
  currency: string;
  shippingId: string | null;
  shippingPriceCents: number | null;
  productionTimeFastDays: number | null;
  productionTimeSlowDays: number | null;
  /** Business days in transit for shippingId, as a range. */
  shippingDaysMin: number | null;
  shippingDaysMax: number | null;
  /** Estimated delivery window if ordered now (YYYY-MM-DD, UTC). */
  arrivesEarliest: string | null;
  arrivesLatest: string | null;
}

export interface GetQuoteInput {
  userId: string;
  fileAssetId: string;
  materialId?: string;
  /** Several materials in one request, e.g. a family across processes. */
  materialIds?: string[];
  /** Cap on returned options (default MAX_QUOTE_OPTIONS). */
  maxOptions?: number;
  currency?: "USD" | "EUR" | "GBP";
  countryCode?: string;
  quantity?: number;
}

export interface GetQuoteResult {
  quotes: AgentQuote[];
  /** Which option to lead with, and the one to offer beside it. */
  lead: Lead | null;
  warnings: string[];
  quantity: number;
  countryCode: string;
  /** The model being quoted, for the quote widget's header and 3D view. */
  part: QuotedPart;
}

export interface QuotedPart {
  fileAssetId: string;
  name: string;
  filename: string;
  format: string;
  dimensionsMm: { x: number; y: number; z: number } | null;
  volumeCm3: number | null;
}

/**
 * CraftCloud reports volume in mm³; a part's volume can't exceed its
 * bounding box, which tells the two units apart for older rows.
 */
export function toCm3(
  volume: number | undefined,
  dims: { x: number; y: number; z: number } | undefined
): number | null {
  if (volume == null || !(volume > 0)) return null;
  if (dims && volume <= (dims.x * dims.y * dims.z) / 1000 + 1e-9) return volume;
  return volume / 1000;
}

const POLL_INTERVAL_MS = 1500;
const STABLE_POLLS_REQUIRED = 4;
const POLL_DEADLINE_MS = 30_000;

function isAbortLike(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

export async function getQuoteForUser(
  input: GetQuoteInput
): Promise<GetQuoteResult | { error: string }> {
  const [assetRow] = await db
    .select({
      asset: fileAssets,
      ownerId: files.userId,
      fileStatus: files.status,
      fileVisibility: files.visibility,
      fileName: files.name,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, input.fileAssetId))
    .limit(1);

  if (!assetRow) return { error: "File not found" };
  // Same "owner or public listing" gate as the web quote route and
  // materialize_create_order (userCanPrintAsset): published alone also
  // matched a listing its owner had set private.
  if (assetRow.ownerId !== input.userId && !isPublicListing(assetRow)) {
    return { error: "Forbidden" };
  }
  if (!assetRow.asset.craftCloudModelId) {
    return {
      error:
        "File is still being prepared for printing. Try again in a few seconds.",
    };
  }

  // Orders are always charged in USD (materialize_create_order and the
  // web checkout both bill Stripe in USD), so quotes are too: a EUR or
  // GBP quote couldn't be ordered. `input.currency` stays in the schema
  // for compatibility; the quote's own `currency` field says USD.
  const currency = "USD" as const;
  const countryCode = input.countryCode ?? "US";
  const quantity = input.quantity ?? 1;

  let materialConfigIds: string[] | undefined;
  const wanted = [
    ...new Set([
      ...(input.materialId ? [input.materialId] : []),
      ...(input.materialIds ?? []),
    ]),
  ];
  if (wanted.length) {
    const catalog = await getCraftCloudCatalog();
    materialConfigIds = [];
    for (const id of wanted) {
      const material = catalog.materialById.get(id);
      if (!material) return { error: `Unknown materialId: ${id}` };
      materialConfigIds.push(
        ...(material.finishGroups ?? []).flatMap((fg) =>
          fg.materialConfigs.map((c) => c.id)
        )
      );
    }
  }

  // Geometry is only needed for the response, and on a fresh import it
  // can cost a CraftCloud round trip; start it now so it overlaps the
  // quote polling instead of trailing it. The no-op catch keeps an early
  // failure from surfacing as unhandled; it is rethrown where awaited.
  const geometryPromise = ensureGeometry(assetRow.asset);
  geometryPromise.catch(() => {});

  let priceId: string;
  try {
    const res = await createPriceRequest({
      currency,
      countryCode,
      models: [{ modelId: assetRow.asset.craftCloudModelId, quantity }],
      materialConfigIds,
    });
    priceId = res.priceId;
  } catch (error) {
    if (error instanceof CraftCloudApiError && error.isQuoteExpired()) {
      return { error: "Quote request rejected by CraftCloud (stale model). Re-upload and retry." };
    }
    throw error;
  }

  const startedAt = Date.now();
  let lastCount = -1;
  let stableStreak = 0;
  let lastSnapshot: Awaited<ReturnType<typeof getPrice>> | null = null;

  while (Date.now() - startedAt < POLL_DEADLINE_MS) {
    // Bound each read by what's left of the deadline: one slow getPrice
    // (10s timeout, retried) could otherwise run the tool call well past
    // it while the agent waits.
    const remainingMs = POLL_DEADLINE_MS - (Date.now() - startedAt);
    let snapshot: Awaited<ReturnType<typeof getPrice>>;
    try {
      snapshot = await getPrice(priceId, {
        signal: AbortSignal.timeout(Math.max(1, remainingMs)),
      });
    } catch (error) {
      // Out of time with something in hand: return what we have, and
      // the deadline warning below says it may be partial.
      if (lastSnapshot && isAbortLike(error)) break;
      throw error;
    }
    lastSnapshot = snapshot;
    const count = snapshot.quotes?.length ?? 0;

    if (snapshot.allComplete && count === lastCount) {
      stableStreak += 1;
      if (stableStreak >= STABLE_POLLS_REQUIRED) break;
    } else {
      stableStreak = snapshot.allComplete && count === lastCount ? stableStreak : 0;
    }
    lastCount = count;

    await new Promise((r) =>
      setTimeout(
        r,
        Math.min(
          POLL_INTERVAL_MS,
          Math.max(0, POLL_DEADLINE_MS - (Date.now() - startedAt))
        )
      )
    );
  }

  if (!lastSnapshot) return { error: "No quotes returned" };

  const [catalog, providers] = await Promise.all([
    getCraftCloudCatalog(),
    getProviderIndex(),
  ]);

  const shippings = lastSnapshot.shippings ?? lastSnapshot.shipping ?? [];
  const shippingByVendor = new Map<string, (typeof shippings)[number]>();
  for (const s of shippings) {
    if (!shippingByVendor.has(s.vendorId)) shippingByVendor.set(s.vendorId, s);
  }

  const quotes: Omit<AgentQuote, keyof QuoteTotals>[] = [];
  let dropped = 0;
  for (const q of lastSnapshot.quotes ?? []) {
    const entry = catalog.configById.get(q.materialConfigId);
    if (!entry) {
      // CNC and other non-printing configs are left out on purpose; only
      // a config we've never heard of means the catalog is behind.
      if (!catalog.excludedConfigIds?.has(q.materialConfigId)) dropped += 1;
      continue;
    }
    const provider = providers.get(q.vendorId);
    const shipping = shippingByVendor.get(q.vendorId);
    quotes.push({
      priceId,
      quoteId: q.quoteId,
      vendorId: q.vendorId,
      vendorName: provider?.name ?? q.vendorId,
      materialId: entry.material.id,
      materialName: entry.material.name,
      finishGroupId: entry.finishGroup.id,
      finishGroupName: entry.finishGroup.name,
      materialConfigId: entry.config.id,
      color: entry.config.color,
      process: processOf(entry.material),
      priceCents: Math.round(q.price * 100),
      currency: q.currency ?? currency,
      shippingId: shipping?.shippingId ?? null,
      shippingPriceCents:
        shipping?.price != null ? Math.round(shipping.price * 100) : null,
      productionTimeFastDays: parseDays(q.productionTimeFast)?.[0] ?? null,
      productionTimeSlowDays: parseDays(q.productionTimeSlow)?.[1] ?? null,
      shippingDaysMin: parseDays(shipping?.deliveryTime)?.[0] ?? null,
      shippingDaysMax: parseDays(shipping?.deliveryTime)?.[1] ?? null,
      arrivesEarliest: null,
      arrivesLatest: null,
    });
  }

  const warnings: string[] = [];
  if (dropped > 0) {
    warnings.push(
      `${dropped} quote(s) were for materials CraftCloud added since Materialize's catalog last refreshed (it refreshes daily), so they're not shown`
    );
  }
  if (Date.now() - startedAt >= POLL_DEADLINE_MS) {
    warnings.push("Quote polling hit the 30s deadline; results may be incomplete");
  }

  // Learn vendor minimums until the cheapest quote per material is
  // certain (see vendorsToProbe): start with the picker's probes, then
  // keep probing any vendor that could still undercut the best known
  // total. Best-effort: a vendor whose probe fails is priced without a
  // minimum and flagged minimumKnown: false.
  const minimums = new Map<string, number>();
  const attempted = new Set<string>();
  const cheapestShipping = new Map<string, { price: number; shippingId: string }>();
  for (const s of shippings) {
    if (!s.shippingId) continue;
    const cur = cheapestShipping.get(s.vendorId);
    if (!cur || s.price < cur.price) {
      cheapestShipping.set(s.vendorId, { price: s.price, shippingId: s.shippingId });
    }
  }
  const cheapestQuoteId = new Map<string, { price: number; quoteId: string }>();
  for (const q of quotes) {
    const cur = cheapestQuoteId.get(q.vendorId);
    if (!cur || q.priceCents < cur.price) {
      cheapestQuoteId.set(q.vendorId, { price: q.priceCents, quoteId: q.quoteId });
    }
  }
  const probeFor = (vendorId: string) => {
    const ship = cheapestShipping.get(vendorId);
    const quote = cheapestQuoteId.get(vendorId);
    return ship && quote
      ? { vendorId, quoteId: quote.quoteId, shippingId: ship.shippingId }
      : null;
  };

  try {
    let probes = pickMinimumProbes(
      quotes.map((q) => ({
        quoteId: q.quoteId,
        vendorId: q.vendorId,
        materialId: q.materialId,
        price: q.priceCents / 100,
      })),
      shippings.map((s) => ({
        vendorId: s.vendorId,
        price: s.price,
        shippingId: s.shippingId,
      })),
      quantity
    );
    for (let round = 0; round < MINIMUM_PROBE_ROUNDS && probes.length > 0; round++) {
      for (const p of probes) attempted.add(p.vendorId);
      const learned = await getVendorMinimums(probes, currency);
      for (const [vendorId, minimum] of Object.entries(learned)) {
        minimums.set(vendorId, minimum);
      }
      probes = vendorsToProbe(quotes, quantity, minimums, attempted)
        .slice(0, PROBES_PER_ROUND)
        .map(probeFor)
        .filter((p): p is NonNullable<typeof p> => p != null);
    }
  } catch (err) {
    logError("getQuoteForUser.vendorMinimums", err);
  }
  if (quotes.some((q) => !minimums.has(q.vendorId))) {
    warnings.push(
      "Some vendors' minimum order values weren't checked, so their totalCents may be low (minimumKnown: false). The order confirmation shows the final price."
    );
  }

  const now = new Date();
  const priced: AgentQuote[] = quotes.map((q) => ({
    ...q,
    ...quoteTotals(q, quantity, minimums),
    ...(arrivalWindow(q, now) ?? {}),
  }));
  priced.sort(byBuyerTotal);
  const lead = chooseLead(priced);
  const options = trimQuotes(
    priced,
    lead ? [lead.quoteId, ...(lead.alternative ? [lead.alternative.quoteId] : [])] : [],
    input.maxOptions
  );
  const geometry = (await geometryPromise) ?? undefined;
  return {
    quotes: options,
    lead,
    warnings,
    quantity,
    countryCode,
    part: {
      fileAssetId: assetRow.asset.id,
      name:
        assetRow.fileName ??
        assetRow.asset.originalFilename.replace(/\.[^.]+$/, ""),
      filename: assetRow.asset.originalFilename,
      format: assetRow.asset.format,
      // A fresh import has no CraftCloud geometry yet (or zeros); show none
      // rather than "0 × 0 × 0 mm".
      dimensionsMm:
        geometry?.dimensions &&
        geometry.dimensions.x > 0 && geometry.dimensions.y > 0 && geometry.dimensions.z > 0
          ? geometry.dimensions
          : null,
      volumeCm3: toCm3(geometry?.volume, geometry?.dimensions),
    },
  };
}

/**
 * The cheapest all-in option per material, for showing prices while the
 * user is still choosing a material (the material card). `quotes` must be
 * sorted by buyer total.
 */
export function cheapestByMaterial(quotes: AgentQuote[]): Map<string, AgentQuote> {
  const out = new Map<string, AgentQuote>();
  for (const q of quotes) {
    if (q.totalCents == null) continue;
    if (!out.has(q.materialId)) out.set(q.materialId, q);
  }
  return out;
}
