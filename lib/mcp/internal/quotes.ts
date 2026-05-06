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

export interface AgentQuote {
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
  priceCents: number;
  currency: string;
  shippingId: string | null;
  shippingPriceCents: number | null;
  productionTimeFastDays: number | null;
  productionTimeSlowDays: number | null;
}

export interface GetQuoteInput {
  userId: string;
  fileAssetId: string;
  materialId?: string;
  currency?: "USD" | "EUR" | "GBP";
  countryCode?: string;
  quantity?: number;
}

export interface GetQuoteResult {
  quotes: AgentQuote[];
  warnings: string[];
}

const POLL_INTERVAL_MS = 1500;
const STABLE_POLLS_REQUIRED = 4;
const POLL_DEADLINE_MS = 30_000;

export async function getQuoteForUser(
  input: GetQuoteInput
): Promise<GetQuoteResult | { error: string }> {
  const [assetRow] = await db
    .select({
      asset: fileAssets,
      ownerId: files.userId,
      fileStatus: files.status,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, input.fileAssetId))
    .limit(1);

  if (!assetRow) return { error: "File not found" };
  if (assetRow.ownerId !== input.userId && assetRow.fileStatus !== "published") {
    return { error: "Forbidden" };
  }
  if (!assetRow.asset.craftCloudModelId) {
    return {
      error:
        "File is still being prepared for printing. Try again in a few seconds.",
    };
  }

  const currency = input.currency ?? "USD";
  const countryCode = input.countryCode ?? "US";
  const quantity = input.quantity ?? 1;

  let materialConfigIds: string[] | undefined;
  if (input.materialId) {
    const catalog = await getCraftCloudCatalog();
    const material = catalog.materialById.get(input.materialId);
    if (!material) return { error: "Unknown materialId" };
    materialConfigIds = (material.finishGroups ?? []).flatMap((fg) =>
      fg.materialConfigs.map((c) => c.id)
    );
  }

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
    const snapshot = await getPrice(priceId);
    lastSnapshot = snapshot;
    const count = snapshot.quotes?.length ?? 0;

    if (snapshot.allComplete && count === lastCount) {
      stableStreak += 1;
      if (stableStreak >= STABLE_POLLS_REQUIRED) break;
    } else {
      stableStreak = snapshot.allComplete && count === lastCount ? stableStreak : 0;
    }
    lastCount = count;

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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

  const quotes: AgentQuote[] = [];
  let dropped = 0;
  for (const q of lastSnapshot.quotes ?? []) {
    const entry = catalog.configById.get(q.materialConfigId);
    if (!entry) {
      dropped += 1;
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
      priceCents: Math.round(q.price * 100),
      currency: q.currency ?? currency,
      shippingId: shipping?.shippingId ?? null,
      shippingPriceCents:
        shipping?.price != null ? Math.round(shipping.price * 100) : null,
      productionTimeFastDays: q.productionTimeFast ?? null,
      productionTimeSlowDays: q.productionTimeSlow ?? null,
    });
  }

  const warnings: string[] = [];
  if (dropped > 0) {
    warnings.push(
      `${dropped} quote(s) referenced material configs not in our catalog and were dropped`
    );
  }
  if (Date.now() - startedAt >= POLL_DEADLINE_MS) {
    warnings.push("Quote polling hit the 30s deadline; results may be incomplete");
  }

  quotes.sort((a, b) => a.priceCents - b.priceCents);
  return { quotes, warnings };
}
