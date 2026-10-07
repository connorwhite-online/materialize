"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Factory } from "@/components/icons/factory";
import { CheckIcon, InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FinishSelect } from "./finish-select";
import {
  aggregateFinishCards,
  cheapestShippingByVendor as shippingMap,
  pickDefaultFinishGroupId,
  type ShippingLite,
} from "./finish-cards";
import { vendorQuoteBadges } from "./vendor-badges";
import {
  effectiveUnitPrice,
  minimumFee,
  probesForQuotes,
  quoteTotal,
  type MinimumProbe,
  type VendorMinimums,
} from "./vendor-minimums";
import type { EnrichedQuote } from "./types";

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
  countryCode: string | null | undefined,
): string | null {
  if (!stateCode) return null;
  if (!countryCode) return stateCode;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const resolved = dn.of(
      `${countryCode.toUpperCase()}-${stateCode.toUpperCase()}`,
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
  stateCode: string | null | undefined,
): string | null {
  const country = countryNameFromCode(countryCode);
  const state = stateNameFromCode(stateCode, countryCode);
  if (state && country) return `${state}, ${country}`;
  return state || country;
}

interface VendorStepProps {
  quotes: EnrichedQuote[];
  shipping: ShippingLite[];
  /** Vendor minimum order values probed so far (see vendor-minimums.ts). */
  vendorMinimums?: VendorMinimums;
  /** Asks the parent to probe the minimums of the vendors on screen. */
  onRequestMinimums?: (probes: MinimumProbe[]) => void;
  /**
   * Quantity used to weight production cost in the sort score —
   * `price * sortQuantity + minimumFee + cheapestShipping`. Held by the parent
   * as a stable anchor that doesn't track every keystroke of the
   * qty input.
   */
  sortQuantity: number;
  /**
   * Live quantity for the prices shown on each row. Ranking keeps
   * using the stable `sortQuantity` anchor so rows don't reshuffle
   * under the cursor; the numbers themselves should be current.
   * Falls back to `sortQuantity`.
   */
  quantity?: number;
  materialId: string;
  /**
   * Preferred finish when the user arrived via Print-with-X. Ignored
   * when it isn't in this material's quote set — we fall through to
   * the cheapest finish.
   */
  initialFinishGroupId?: string;
  selectedQuote: EnrichedQuote | null;
  onPick: (quote: EnrichedQuote) => void;
  onBack: () => void;
}

/**
 * Vendor quotes for the chosen material. Finish is preselected
 * (cheapest-by-total, or `initialFinishGroupId`) and sits above
 * color — changing either refilters this list. Back always returns
 * to the material grid; finish is no longer its own step.
 */
export function VendorStep({
  quotes,
  shipping,
  vendorMinimums,
  onRequestMinimums,
  sortQuantity,
  quantity,
  materialId,
  initialFinishGroupId,
  selectedQuote,
  onPick,
  onBack,
}: VendorStepProps) {
  const displayQuantity = quantity ?? sortQuantity;
  const cheapestShippingByVendor = useMemo(
    () => shippingMap(shipping),
    [shipping],
  );

  const finishes = useMemo(
    () =>
      aggregateFinishCards(
        quotes,
        shipping,
        sortQuantity,
        materialId,
        vendorMinimums,
      ),
    [quotes, shipping, sortQuantity, materialId, vendorMinimums],
  );

  const [finishGroupId, setFinishGroupId] = useState<string | null>(() =>
    pickDefaultFinishGroupId(
      finishes,
      initialFinishGroupId ?? selectedQuote?.finishGroupId,
    ),
  );

  // Quotes grow as polling snapshots land. Keep the user's finish
  // when it's still offered; otherwise re-pick the default so we
  // don't sit on an empty list.
  useEffect(() => {
    setFinishGroupId((current) => {
      if (current && finishes.some((f) => f.finishGroupId === current)) {
        return current;
      }
      return pickDefaultFinishGroupId(
        finishes,
        initialFinishGroupId ?? selectedQuote?.finishGroupId,
      );
    });
  }, [finishes, initialFinishGroupId, selectedQuote?.finishGroupId]);

  const { materialName, colors, cheapestPerColor } = useMemo(() => {
    const filtered = quotes.filter(
      (q) => q.materialId === materialId && q.finishGroupId === finishGroupId,
    );
    const materialName = filtered[0]?.materialName ?? "Material";

    // Total cost the buyer actually pays drives the rank. A US
    // vendor's quote with high production but low domestic shipping
    // can outrank an EU quote that's cheaper to make but expensive
    // to ship into the US — sorting by `q.price` alone hid those
    // wins. Shipping defaults to 0 for vendors whose shipping option
    // hasn't landed yet in this poll snapshot; the next snapshot
    // will reorder them once their shipping arrives. A vendor's
    // minimum order fee counts too — a $7 part at a $33-minimum
    // vendor costs $33, whatever the quote says.
    const totalCost = (q: EnrichedQuote) =>
      quoteTotal(q, sortQuantity, cheapestShippingByVendor, vendorMinimums);
    const unitPrice = (q: EnrichedQuote) =>
      effectiveUnitPrice(q, sortQuantity, vendorMinimums);

    const byColor = new Map<string, EnrichedQuote[]>();
    for (const q of filtered) {
      const list = byColor.get(q.color) ?? [];
      list.push(q);
      byColor.set(q.color, list);
    }

    // Swatch label still shows the cheapest per-unit production
    // price ("$X per part starting at"), minimum included. Sorting uses total — so
    // the cheapest-by-total color leads the rail even if a different
    // color has lower production but worse shipping.
    const cheapestPerColor = new Map<string, number>();
    const cheapestTotalPerColor = new Map<string, number>();
    const colors = Array.from(byColor.entries())
      .map(([name, qs]) => {
        qs.sort((a, b) => totalCost(a) - totalCost(b));
        cheapestPerColor.set(
          name,
          qs.reduce((min, q) => Math.min(min, unitPrice(q)), unitPrice(qs[0])),
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
          cheapestTotalPerColor.get(b.name)!,
      );

    return { materialName, colors, cheapestPerColor };
  }, [
    quotes,
    materialId,
    finishGroupId,
    sortQuantity,
    cheapestShippingByVendor,
    vendorMinimums,
  ]);

  const [activeColor, setActiveColor] = useState<string>(
    selectedQuote?.color ?? colors[0]?.name ?? "",
  );

  // Focus the heading on mount so step transitions land AT users here (CON-157).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // If the user (or a finish change) left us on a color this finish
  // doesn't offer, fall through to the cheapest color of the new set.
  const activeColorGroup =
    colors.find((c) => c.name === activeColor) ?? colors[0];
  const vendorQuotes = activeColorGroup?.quotes ?? [];

  // Cheapest / Fastest among the *visible* list only — finish and
  // color filters change the winners. Pure helper so the scoring
  // is unit-testable without mounting the step.
  const badgesByQuoteId = useMemo(
    () =>
      vendorQuoteBadges(vendorQuotes, shipping, sortQuantity, vendorMinimums),
    [vendorQuotes, shipping, sortQuantity, vendorMinimums],
  );

  // Probe every vendor on screen for its minimum order value. The
  // parent dedupes vendors it has already asked about.
  useEffect(() => {
    if (!onRequestMinimums || vendorQuotes.length === 0) return;
    onRequestMinimums(probesForQuotes(vendorQuotes, shipping));
  }, [onRequestMinimums, vendorQuotes, shipping]);

  const handleFinishChange = (id: string) => {
    setFinishGroupId(id);
    setActiveColor("");
  };

  const fromPrice = vendorQuotes.reduce<number | null>((min, q) => {
    const unit = effectiveUnitPrice(q, sortQuantity, vendorMinimums);
    return min === null || unit < min ? unit : min;
  }, null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRight size={14} className="rotate-180" />
          All materials
        </button>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-base leading-6 font-semibold outline-none"
        >
          {materialName}
        </h2>
        <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
          {vendorQuotes.length > 0
            ? `${vendorQuotes.length} ${vendorQuotes.length === 1 ? "manufacturer" : "manufacturers"}${fromPrice !== null ? ` · from $${fromPrice.toFixed(2)}` : ""}`
            : "Pick a manufacturer"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FinishSelect
          finishes={finishes}
          value={finishGroupId}
          onChange={handleFinishChange}
        />

        {colors.length > 1 && (
          <div className="flex flex-col">
            <Label htmlFor="color-select">Color</Label>
            <Select
              value={activeColor || (colors[0]?.name ?? null)}
              onValueChange={(v) => v && setActiveColor(v)}
            >
              <SelectTrigger
                id="color-select"
                className="h-14 w-full rounded-xl"
              >
                <SelectValue>
                  {(value) => {
                    const c = colors.find((c) => c.name === value);
                    if (!c) return "Select a color";
                    // From-price lives on the dropdown options only —
                    // same rule as the finish trigger.
                    return (
                      <>
                        <span
                          className="size-5 shrink-0 rounded-full ring-1 ring-border ring-inset"
                          style={{ backgroundColor: c.colorCode }}
                        />
                        <span className="truncate">{c.name}</span>
                      </>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {colors.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    <span
                      className="size-3.5 shrink-0 rounded-full ring-1 ring-border ring-inset"
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
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">Manufacturer</h3>
          <p className="text-xs text-subtle-foreground">
            Total with cheapest shipping
          </p>
        </div>
        <ul className="-mx-3 flex flex-col">
          {vendorQuotes.map((quote) => {
            const isSelected = selectedQuote?.quoteId === quote.quoteId;
            const cheapestShipping = cheapestShippingByVendor.get(
              quote.vendorId,
            );
            const fee = minimumFee(quote, displayQuantity, vendorMinimums);
            const badges = badgesByQuoteId.get(quote.quoteId);
            const location = vendorLocationLabel(
              quote.vendorCountryCode,
              quote.vendorStateCode,
            );
            const meta = [
              `${quote.productionTimeFast === quote.productionTimeSlow ? quote.productionTimeFast : `${quote.productionTimeFast}–${quote.productionTimeSlow}`} days`,
              location,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={quote.quoteId}>
                <button
                  type="button"
                  data-slot="vendor-option"
                  onClick={() => onPick(quote)}
                  aria-pressed={isSelected}
                  aria-label={[
                    quote.vendorName,
                    badges?.cheapest ? "Cheapest" : null,
                    badges?.fastest ? "Fastest" : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  className={cn(
                    "group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    isSelected ? "bg-muted" : "hover:bg-muted/70",
                  )}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground group-hover:bg-background group-aria-pressed:bg-background">
                    <Factory className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium">
                        {quote.vendorName}
                      </p>
                      {badges?.cheapest && (
                        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-success/10 px-1.5 text-[11px] font-medium text-success">
                          Cheapest
                        </span>
                      )}
                      {badges?.fastest && (
                        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-info/10 px-1.5 text-[11px] font-medium text-info">
                          Fastest
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
                      {meta}
                      {typeof quote.scale === "number" && quote.scale !== 1 && (
                        <span className="text-warning">
                          {" "}
                          · scaled ×{quote.scale.toFixed(2)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {/* Lead with what the buyer pays — the same total
                        the list is ranked by — so the order reads as
                        sorted. The parts of it sit underneath. */}
                    <p className="text-sm font-medium tabular-nums">
                      $
                      {quoteTotal(
                        quote,
                        displayQuantity,
                        cheapestShippingByVendor,
                        vendorMinimums,
                      ).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {(() => {
                        const each =
                          displayQuantity > 1
                            ? `$${quote.price.toFixed(2)} × ${displayQuantity}`
                            : null;
                        if (typeof cheapestShipping !== "number") return each;
                        if (cheapestShipping === 0) {
                          return each ? `${each} · free ship` : "Free shipping";
                        }
                        return `${each ?? `$${quote.price.toFixed(2)}`} + $${cheapestShipping.toFixed(2)} ship`;
                      })()}
                    </p>
                    {fee > 0 && (
                      <p className="text-xs text-warning tabular-nums">
                        incl. ${fee.toFixed(2)} vendor minimum
                      </p>
                    )}
                  </div>
                  {isSelected ? (
                    <CheckIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-foreground"
                    />
                  ) : (
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-subtle-foreground group-hover:text-foreground"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tariff note — why US-bound shipping is pricier than people
          expect. A footnote to the list, not a banner over it. */}
      <p className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
        <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        Shipping from most manufacturers costs more than usual because of new US
        import tariffs. Every quote is shown as it arrives so you can still pick
        the best one.
      </p>
    </div>
  );
}
