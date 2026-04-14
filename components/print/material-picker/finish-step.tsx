"use client";

import { useMemo } from "react";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { EnrichedQuote } from "./types";

interface FinishStepProps {
  quotes: EnrichedQuote[];
  materialId: string;
  onPick: (finishGroupId: string) => void;
  onBack: () => void;
}

interface FinishCard {
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  cheapest: number;
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
  materialId,
  onPick,
  onBack,
}: FinishStepProps) {
  const { materialName, cards } = useMemo(() => {
    const materialQuotes = quotes.filter((q) => q.materialId === materialId);
    const materialName = materialQuotes[0]?.materialName ?? "Material";

    const byFinish = new Map<string, FinishCard & { colors: Set<string> }>();
    for (const q of materialQuotes) {
      const existing = byFinish.get(q.finishGroupId);
      if (!existing) {
        byFinish.set(q.finishGroupId, {
          finishGroupId: q.finishGroupId,
          finishGroupName: q.finishGroupName,
          finishGroupImage: q.finishGroupImage,
          cheapest: q.price,
          configCount: 1,
          colorCount: 0,
          colors: new Set([q.color]),
        });
      } else {
        existing.configCount++;
        existing.colors.add(q.color);
        if (q.price < existing.cheapest) existing.cheapest = q.price;
      }
    }

    const cards: FinishCard[] = Array.from(byFinish.values())
      .map((c) => ({
        finishGroupId: c.finishGroupId,
        finishGroupName: c.finishGroupName,
        finishGroupImage: c.finishGroupImage,
        cheapest: c.cheapest,
        configCount: c.configCount,
        colorCount: c.colors.size,
      }))
      .sort((a, b) => a.cheapest - b.cheapest);

    return { materialName, cards };
  }, [quotes, materialId]);

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
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/60">
              {card.finishGroupImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveCatalogImage(card.finishGroupImage)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
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
