"use client";

import { useMemo, useState } from "react";
import { Factory } from "lucide-react";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { EnrichedQuote } from "./types";

interface ShippingLite {
  vendorId: string;
  price: number;
}

interface VendorStepProps {
  quotes: EnrichedQuote[];
  shipping: ShippingLite[];
  materialId: string;
  finishGroupId: string;
  selectedQuote: EnrichedQuote | null;
  onPick: (quote: EnrichedQuote) => void;
  onBack: () => void;
}

/**
 * Step 3 — the actual bookable quotes. Groups the quotes for the
 * chosen (material × finish) by color and shows each vendor offering
 * that color. The cheapest quote is selected by default. Users can
 * switch color via the swatch rail at the top.
 */
export function VendorStep({
  quotes,
  shipping,
  materialId,
  finishGroupId,
  selectedQuote,
  onPick,
  onBack,
}: VendorStepProps) {
  // Cheapest shipping price per vendor — used to surface the "+ $X
  // Shipping" line on each vendor card.
  const cheapestShippingByVendor = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shipping) {
      const current = map.get(s.vendorId);
      if (current === undefined || s.price < current) {
        map.set(s.vendorId, s.price);
      }
    }
    return map;
  }, [shipping]);

  const { materialName, finishGroupName, colors, cheapestPerColor } =
    useMemo(() => {
      const filtered = quotes.filter(
        (q) => q.materialId === materialId && q.finishGroupId === finishGroupId
      );
      const materialName = filtered[0]?.materialName ?? "Material";
      const finishGroupName = filtered[0]?.finishGroupName ?? "Finish";

      const byColor = new Map<string, EnrichedQuote[]>();
      for (const q of filtered) {
        const list = byColor.get(q.color) ?? [];
        list.push(q);
        byColor.set(q.color, list);
      }

      const cheapestPerColor = new Map<string, number>();
      const colors = Array.from(byColor.entries())
        .map(([name, qs]) => {
          qs.sort((a, b) => a.price - b.price);
          cheapestPerColor.set(name, qs[0].price);
          return {
            name,
            colorCode: qs[0].colorCode,
            quotes: qs,
          };
        })
        .sort((a, b) => cheapestPerColor.get(a.name)! - cheapestPerColor.get(b.name)!);

      return { materialName, finishGroupName, colors, cheapestPerColor };
    }, [quotes, materialId, finishGroupId]);

  const [activeColor, setActiveColor] = useState<string>(
    selectedQuote?.color ?? colors[0]?.name ?? ""
  );

  const activeColorGroup = colors.find((c) => c.name === activeColor) ?? colors[0];
  const vendorQuotes = activeColorGroup?.quotes ?? [];

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronRight size={14} className="rotate-180" />
          Finishes
        </button>
        <h2 className="mt-2 text-lg font-semibold">
          {materialName}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {finishGroupName}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">Pick a color + vendor</p>
      </div>

      {/* Color swatch rail */}
      {colors.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => {
            const isActive = c.name === activeColor;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => setActiveColor(c.name)}
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  isActive
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/30"
                }`}
              >
                <span
                  className="h-4 w-4 rounded-full border border-border/60"
                  style={{ backgroundColor: c.colorCode }}
                />
                <span>{c.name}</span>
                <span className="text-muted-foreground/70 tabular-nums">
                  ${cheapestPerColor.get(c.name)!.toFixed(2)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Vendor quotes for the selected color */}
      <div className="space-y-2">
        {vendorQuotes.map((quote) => {
          const isSelected = selectedQuote?.quoteId === quote.quoteId;
          const cheapestShipping = cheapestShippingByVendor.get(quote.vendorId);
          return (
            <button
              key={quote.quoteId}
              type="button"
              onClick={() => onPick(quote)}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/60 text-muted-foreground">
                <Factory className="size-5" />
              </div>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {quote.vendorName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {quote.productionTimeFast}-{quote.productionTimeSlow} day
                    production
                    {typeof quote.scale === "number" && quote.scale !== 1 && (
                      <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                        · ×{quote.scale.toFixed(2)} scaled
                      </span>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium tabular-nums">
                    ${quote.price.toFixed(2)}
                  </p>
                  {typeof cheapestShipping === "number" && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      + ${cheapestShipping.toFixed(2)} shipping
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
