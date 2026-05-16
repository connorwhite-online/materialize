"use client";

import { useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { EnrichedQuote } from "./types";

interface ShippingLite {
  vendorId: string;
  price: number;
}

interface FinishStepProps {
  quotes: EnrichedQuote[];
  /**
   * Shipping options from the same /v5/price snapshot. Used to sort
   * finish cards by total cost (production*qty + cheapest shipping)
   * instead of production alone — see vendor-step for the same
   * rationale. The "from $X" displayed on each card is still
   * single-unit production cost.
   */
  shipping: ShippingLite[];
  /** Stable quantity anchor for the total-cost sort. */
  sortQuantity: number;
  materialId: string;
  onPick: (finishGroupId: string) => void;
  onBack: () => void;
}

interface FinishCard {
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  cheapest: number;
  /** Min total (production*qty + shipping) across this finish — sort key. */
  cheapestTotal: number;
  configCount: number;
  colorCount: number;
}

/**
 * Step 2 — after a material is chosen, surface the finish groups
 * available for it (Standard, Polished, Dyed, etc.). Each card
 * summarizes how many configs exist in that finish, how many unique
 * colors, and the cheapest quote across them.
 */
export function FinishStep({
  quotes,
  shipping,
  sortQuantity,
  materialId,
  onPick,
  onBack,
}: FinishStepProps) {
  const { materialName, cards } = useMemo(() => {
    const cheapestShippingByVendor = new Map<string, number>();
    for (const s of shipping) {
      const current = cheapestShippingByVendor.get(s.vendorId);
      if (current === undefined || s.price < current) {
        cheapestShippingByVendor.set(s.vendorId, s.price);
      }
    }
    const totalCost = (q: { price: number; vendorId: string }) =>
      q.price * sortQuantity + (cheapestShippingByVendor.get(q.vendorId) ?? 0);

    const materialQuotes = quotes.filter((q) => q.materialId === materialId);
    const materialName = materialQuotes[0]?.materialName ?? "Material";

    const byFinish = new Map<string, FinishCard & { colors: Set<string> }>();
    for (const q of materialQuotes) {
      const total = totalCost(q);
      const existing = byFinish.get(q.finishGroupId);
      if (!existing) {
        byFinish.set(q.finishGroupId, {
          finishGroupId: q.finishGroupId,
          finishGroupName: q.finishGroupName,
          finishGroupImage: q.finishGroupImage,
          cheapest: q.price,
          cheapestTotal: total,
          configCount: 1,
          colorCount: 0,
          colors: new Set([q.color]),
        });
      } else {
        existing.configCount++;
        existing.colors.add(q.color);
        if (q.price < existing.cheapest) existing.cheapest = q.price;
        if (total < existing.cheapestTotal) existing.cheapestTotal = total;
      }
    }

    const cards: FinishCard[] = Array.from(byFinish.values())
      .map((c) => ({
        finishGroupId: c.finishGroupId,
        finishGroupName: c.finishGroupName,
        finishGroupImage: c.finishGroupImage,
        cheapest: c.cheapest,
        cheapestTotal: c.cheapestTotal,
        configCount: c.configCount,
        colorCount: c.colors.size,
      }))
      .sort((a, b) => a.cheapestTotal - b.cheapestTotal);

    return { materialName, cards };
  }, [quotes, shipping, sortQuantity, materialId]);

  // If the selected material only has one finish group, skip this
  // step entirely — there's no decision for the user to make. We
  // only fire once per mount/material change so the user can still
  // "Back" out to the material step without rubber-banding right
  // back into the vendor step.
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    autoAdvancedRef.current = false;
  }, [materialId]);
  useEffect(() => {
    if (autoAdvancedRef.current) return;
    if (cards.length !== 1) return;
    autoAdvancedRef.current = true;
    onPick(cards[0].finishGroupId);
  }, [cards, onPick]);

  // During the single-finish auto-advance the picker is about to
  // transition to the vendor step — render nothing in the flicker
  // window rather than flashing a one-card list.
  if (cards.length === 1) return null;

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronRight size={14} className="rotate-180" />
          All materials
        </button>
        <h2 className="mt-2 text-lg font-semibold">{materialName}</h2>
        <p className="text-xs text-muted-foreground">Pick a finish</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.finishGroupId}
            type="button"
            onClick={() => onPick(card.finishGroupId)}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
          >
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/60">
              {card.finishGroupImage && (
                <Image
                  src={resolveCatalogImage(card.finishGroupImage)}
                  alt=""
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {card.finishGroupName}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {card.colorCount}{" "}
                  {card.colorCount === 1 ? "color" : "colors"} ·{" "}
                  {card.configCount}{" "}
                  {card.configCount === 1 ? "option" : "options"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] text-muted-foreground">from</p>
                <p className="text-sm font-medium tabular-nums">
                  ${card.cheapest.toFixed(2)}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_200,q_auto,f_auto/${path}`;
}
