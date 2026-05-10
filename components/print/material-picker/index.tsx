"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MaterialStep } from "./material-step";
import { FinishStep } from "./finish-step";
import { VendorStep } from "./vendor-step";
import type {
  EnrichedQuote,
  OptimisticMaterial,
  PickerStep,
} from "./types";

interface ShippingLite {
  vendorId: string;
  price: number;
}

interface MaterialPickerProps {
  quotes: EnrichedQuote[];
  /**
   * Shipping options returned by the same /v5/price call as the
   * quotes. The vendor step uses these to compute a per-vendor
   * "cheapest shipping" badge under each price; all three steps
   * use them to sort by total cost (production + shipping) instead
   * of production alone, which would otherwise bury US vendors
   * (high production, low domestic shipping) below EU vendors
   * (low production, high tariff-inflated shipping).
   */
  shipping: ShippingLite[];
  /**
   * Quantity used to weight production cost in the sort score —
   * `price * sortQuantity + cheapestShipping`. Held by the parent
   * as a stable anchor that only updates when the live quantity
   * has moved by more than the rerank delta, so typing 1 → 4 in the
   * qty input doesn't shuffle every card under the user's cursor.
   */
  sortQuantity: number;
  /** True while the /v5/price request is still in flight. */
  quotesLoading: boolean;
  /**
   * True when polling exited at the hard ceiling without seeing a
   * stable allComplete — the quotes shown are partial. The material
   * step renders a "showing partial results" hint with a Retry CTA.
   */
  quotesPartial?: boolean;
  /** Re-run the quote fetch from scratch. Used by the partial-results retry. */
  onRetryQuotes?: () => void;
  /**
   * Optimistic material list filtered to those whose build volume can
   * fit the model. Drives the skeleton-priced cards on the material
   * step before real quotes arrive. Null when we don't know the
   * dimensions or the request is scoped to a single material.
   */
  viableMaterials?: OptimisticMaterial[] | null;
  selectedQuote: EnrichedQuote | null;
  onSelectQuote: (quote: EnrichedQuote) => void;
  /**
   * CraftCloud material id from the "Print with X" flow. When
   * provided and a matching quote arrives, we jump straight to
   * the finish step. /materials/[slug] passes the real CraftCloud
   * id here, so an exact match is reliable.
   */
  preselectMaterialId?: string;
  /**
   * Fires when the user navigates back to the full material grid
   * after arriving via a preselect. Lets the parent drop its
   * scoped-material filter and refetch the unscoped quote set so
   * the grid populates with every material.
   */
  onClearPreselectScope?: () => void;
}

export function MaterialPicker({
  quotes,
  shipping,
  sortQuantity,
  quotesLoading,
  quotesPartial = false,
  viableMaterials = null,
  onRetryQuotes,
  selectedQuote,
  onSelectQuote,
  preselectMaterialId,
  onClearPreselectScope,
}: MaterialPickerProps) {
  const [step, setStep] = useState<PickerStep>("material");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [finishGroupId, setFinishGroupId] = useState<string | null>(null);
  // Tracks whether the preselect has already fired. Without this,
  // a later user "Back" out of the finish step would get rubber-
  // banded right back in by the effect re-running.
  const preselectFiredRef = useRef(false);

  // How many finish groups does the currently-selected material
  // have quotes for? If it's 1, FinishStep auto-advances straight
  // to vendor — and we need the vendor step's Back button to pop
  // two steps instead of one, otherwise the user lands on finish,
  // gets re-auto-advanced, and rubber-bands right back to vendor.
  const finishGroupCountForMaterial = useMemo(() => {
    if (!materialId) return 0;
    const ids = new Set<string>();
    for (const q of quotes) {
      if (q.materialId === materialId) ids.add(q.finishGroupId);
    }
    return ids.size;
  }, [quotes, materialId]);

  useEffect(() => {
    if (!preselectMaterialId) return;
    if (preselectFiredRef.current) return;
    const hit = quotes.find((q) => q.materialId === preselectMaterialId);
    if (!hit) return;
    preselectFiredRef.current = true;
    setMaterialId(preselectMaterialId);
    setStep("finish");
  }, [preselectMaterialId, quotes]);

  if (step === "material") {
    return (
      <MaterialStep
        quotes={quotes}
        shipping={shipping}
        sortQuantity={sortQuantity}
        quotesLoading={quotesLoading}
        quotesPartial={quotesPartial}
        materialScoped={!!preselectMaterialId}
        viableMaterials={viableMaterials}
        onRetryQuotes={onRetryQuotes}
        onClearScope={onClearPreselectScope}
        onPick={(id) => {
          setMaterialId(id);
          setFinishGroupId(null);
          setStep("finish");
        }}
      />
    );
  }

  if (step === "finish" && materialId) {
    return (
      <FinishStep
        quotes={quotes}
        shipping={shipping}
        sortQuantity={sortQuantity}
        materialId={materialId}
        onPick={(id) => {
          setFinishGroupId(id);
          setStep("vendor");
        }}
        onBack={() => {
          setStep("material");
          setMaterialId(null);
          // Drop the parent's preselect scope so the refetched
          // quote set includes every material, not just the one
          // the user came in with.
          onClearPreselectScope?.();
        }}
      />
    );
  }

  if (step === "vendor" && materialId && finishGroupId) {
    // The label has to match where Back actually goes. Single-finish
    // materials skip the finish step on the way in, so vendor → back
    // pops two steps and lands on the material grid; saying
    // "Finishes" there would lie to the user. Mirror FinishStep's
    // own back-to-materials copy ("All materials") for consistency.
    const isSingleFinish = finishGroupCountForMaterial <= 1;
    return (
      <VendorStep
        quotes={quotes}
        shipping={shipping}
        sortQuantity={sortQuantity}
        materialId={materialId}
        finishGroupId={finishGroupId}
        selectedQuote={selectedQuote}
        onPick={onSelectQuote}
        backLabel={isSingleFinish ? "All materials" : "Finishes"}
        onBack={() => {
          if (isSingleFinish) {
            setStep("material");
            setMaterialId(null);
            setFinishGroupId(null);
            onClearPreselectScope?.();
            return;
          }
          setStep("finish");
          setFinishGroupId(null);
        }}
      />
    );
  }

  return null;
}
