"use client";

import { useMemo, useState } from "react";
import { Factory } from "@/components/icons/factory";
import { Frown } from "@/components/icons/frown";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EnrichedQuote } from "./types";

interface ShippingLite {
  vendorId: string;
  price: number;
}

/**
 * Resolve a country code to a human-readable name via the
 * browser's Intl catalog. Falls back to the raw code if the
 * runtime doesn't support DisplayNames (very old browsers) or
 * the code isn't recognized.
 */
function countryNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * Pair a state code with its country to resolve a region name —
 * Intl.DisplayNames understands ISO 3166-2 subdivisions (e.g.
 * `US-TX` → "Texas", `CA-BC` → "British Columbia"). Falls back to
 * the raw state code if the runtime / locale doesn't have the
 * subdivision in its CLDR dataset.
 */
function stateNameFromCode(
  stateCode: string | null | undefined,
  countryCode: string | null | undefined
): string | null {
  if (!stateCode) return null;
  if (!countryCode) return stateCode;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const resolved = dn.of(
      `${countryCode.toUpperCase()}-${stateCode.toUpperCase()}`
    );
    // DisplayNames returns the input unchanged when it can't
    // resolve — detect and fall back to the bare state code so
    // we don't render "US-TX" as a state label.
    if (!resolved || resolved.includes("-")) return stateCode;
    return resolved;
  } catch {
    return stateCode;
  }
}

/**
 * Compose the location line under the vendor name. Examples:
 *   US + TX  → "Texas, United States"
 *   CA + BC  → "British Columbia, Canada"
 *   AU + —   → "Australia"
 *   —  + —   → null  (line hides)
 */
function vendorLocationLabel(
  countryCode: string | null | undefined,
  stateCode: string | null | undefined
): string | null {
  const country = countryNameFromCode(countryCode);
  const state = stateNameFromCode(stateCode, countryCode);
  if (state && country) return `${state}, ${country}`;
  return state || country;
}

interface VendorStepProps {
  quotes: EnrichedQuote[];
  shipping: ShippingLite[];
  /**
   * Quantity used to weight production cost in the sort score —
   * `price * sortQuantity + cheapestShipping`. Held by the parent
   * as a stable anchor that doesn't track every keystroke of the
   * qty input.
   */
  sortQuantity: number;
  materialId: string;
  finishGroupId: string;
  selectedQuote: EnrichedQuote | null;
  onPick: (quote: EnrichedQuote) => void;
  onBack: () => void;
  /**
   * Label for the back button. Single-finish materials skip the
   * finish step entirely on the way in, so back from vendor goes
   * to the material grid — and the label needs to say so. The
   * parent owns that decision and passes the right copy down.
   */
  backLabel: string;
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
  sortQuantity,
  materialId,
  finishGroupId,
  selectedQuote,
  onPick,
  onBack,
  backLabel,
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

      // Total cost the buyer actually pays drives the rank. A US
      // vendor's quote with high production but low domestic shipping
      // can outrank an EU quote that's cheaper to make but expensive
      // to ship into the US — sorting by `q.price` alone hid those
      // wins. Shipping defaults to 0 for vendors whose shipping option
      // hasn't landed yet in this poll snapshot; the next snapshot
      // will reorder them once their shipping arrives.
      const totalCost = (q: EnrichedQuote) =>
        q.price * sortQuantity + (cheapestShippingByVendor.get(q.vendorId) ?? 0);

      const byColor = new Map<string, EnrichedQuote[]>();
      for (const q of filtered) {
        const list = byColor.get(q.color) ?? [];
        list.push(q);
        byColor.set(q.color, list);
      }

      // Swatch label still shows the cheapest single-unit production
      // price ("$X per part starting at"). Sorting uses total — so
      // the cheapest-by-total color leads the rail even if a different
      // color has lower production but worse shipping.
      const cheapestPerColor = new Map<string, number>();
      const cheapestTotalPerColor = new Map<string, number>();
      const colors = Array.from(byColor.entries())
        .map(([name, qs]) => {
          qs.sort((a, b) => totalCost(a) - totalCost(b));
          cheapestPerColor.set(
            name,
            qs.reduce((min, q) => (q.price < min ? q.price : min), qs[0].price)
          );
          cheapestTotalPerColor.set(name, totalCost(qs[0]));
          return {
            name,
            colorCode: qs[0].colorCode,
            quotes: qs,
          };
        })
        .sort(
          (a, b) =>
            cheapestTotalPerColor.get(a.name)! -
            cheapestTotalPerColor.get(b.name)!
        );

      return { materialName, finishGroupName, colors, cheapestPerColor };
    }, [quotes, materialId, finishGroupId, sortQuantity, cheapestShippingByVendor]);

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
          {backLabel}
        </button>
        <h2 className="mt-2 text-lg font-semibold">
          {materialName}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {finishGroupName}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">Pick a color + vendor</p>
      </div>

      {colors.length > 1 && (
        <div>
          <Label htmlFor="color-select">Color</Label>
          <Select
            value={activeColor}
            onValueChange={(v) => v && setActiveColor(v)}
          >
            <SelectTrigger id="color-select" className="w-full">
              <SelectValue>
                {(value) => {
                  const c = colors.find((c) => c.name === value);
                  if (!c) return "Select a color";
                  return (
                    <>
                      <span
                        className="size-4 shrink-0 rounded-full border border-border/60"
                        style={{ backgroundColor: c.colorCode }}
                      />
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        from ${cheapestPerColor.get(c.name)!.toFixed(2)}
                      </span>
                    </>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {colors.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  <span
                    className="size-3.5 shrink-0 rounded-full border border-border/60"
                    style={{ backgroundColor: c.colorCode }}
                  />
                  <span>{c.name}</span>
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    ${cheapestPerColor.get(c.name)!.toFixed(2)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Tariff notice — covers why shipping has gotten rough on
          US-bound orders from most of CraftCloud's roster. Sits in
          the same column as the vendor cards so the width lines up. */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3 text-muted-foreground">
        <Frown className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-xs leading-snug">
          <span className="font-medium text-primary">
            Heads up — shipping prices from most vendors are higher than usual
          </span>{" "}
          due to new US import tariffs. We&apos;re surfacing every quote as it
          comes in so you can still pick the best one.
        </p>
      </div>

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
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/80 to-muted/30 text-muted-foreground">
                <Factory className="size-7" />
              </div>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {quote.vendorName}
                  </p>
                  {(() => {
                    const location = vendorLocationLabel(
                      quote.vendorCountryCode,
                      quote.vendorStateCode
                    );
                    if (!location) return null;
                    return (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {location}
                      </p>
                    );
                  })()}
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
