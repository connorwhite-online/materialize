import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import {
  getQuoteProvider,
  QuoteModelNotReadyError,
  QuoteModelRejectedError,
  type QuoteSnapshot,
  type QuoteSnapshotStats,
} from "@/lib/quotes";

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

  const currency = input.currency ?? "USD";
  const countryCode = input.countryCode ?? "US";
  const quantity = input.quantity ?? 1;
  const provider = getQuoteProvider();

  if (input.materialId && !(await provider.hasMaterial(input.materialId))) {
    return { error: "Unknown materialId" };
  }

  let priceId: string;
  try {
    const res = await provider.startQuote({
      model: { kind: "asset", asset: assetRow.asset },
      currency,
      countryCode,
      quantity,
      materialId: input.materialId,
    });
    priceId = res.priceId;
  } catch (error) {
    if (error instanceof QuoteModelNotReadyError) {
      return {
        error:
          "File is still being prepared for printing. Try again in a few seconds.",
      };
    }
    if (error instanceof QuoteModelRejectedError) {
      return { error: "Quote request rejected (stale model). Re-upload and retry." };
    }
    throw error;
  }

  const startedAt = Date.now();
  let lastCount = -1;
  let stableStreak = 0;
  let last: { snapshot: QuoteSnapshot; stats: QuoteSnapshotStats } | null =
    null;

  while (Date.now() - startedAt < POLL_DEADLINE_MS) {
    last = await provider.getSnapshot(priceId);
    const count = last.snapshot.quotes.length;

    if (last.snapshot.allComplete && count === lastCount) {
      stableStreak += 1;
      if (stableStreak >= STABLE_POLLS_REQUIRED) break;
    } else {
      stableStreak = 0;
    }
    lastCount = count;

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!last) return { error: "No quotes returned" };

  const shippingByVendor = new Map<
    string,
    QuoteSnapshot["shipping"][number]
  >();
  for (const s of last.snapshot.shipping) {
    if (!shippingByVendor.has(s.vendorId)) shippingByVendor.set(s.vendorId, s);
  }

  const quotes: AgentQuote[] = last.snapshot.quotes.map((q) => {
    const shipping = shippingByVendor.get(q.vendorId);
    return {
      priceId,
      quoteId: q.quoteId,
      vendorId: q.vendorId,
      vendorName: q.vendorName,
      materialId: q.materialId,
      materialName: q.materialName,
      finishGroupId: q.finishGroupId,
      finishGroupName: q.finishGroupName,
      materialConfigId: q.materialConfigId,
      color: q.color,
      priceCents: Math.round(q.price * 100),
      currency: q.currency ?? currency,
      shippingId: shipping?.shippingId ?? null,
      shippingPriceCents:
        shipping?.price != null ? Math.round(shipping.price * 100) : null,
      productionTimeFastDays: q.productionTimeFast ?? null,
      productionTimeSlowDays: q.productionTimeSlow ?? null,
    };
  });

  const warnings: string[] = [];
  const dropped = last.stats.droppedCount;
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
