"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MaterialStep } from "./material-step";
import { FinishStep } from "./finish-step";
import { VendorStep } from "./vendor-step";
import type { EnrichedQuote, PickerStep } from "./types";

interface ShippingLite {
  vendorId: string;
  price: number;
}

interface MaterialPickerProps {
  quotes: EnrichedQuote[];
  /**
   * Shipping options returned by the same /v5/price call as the
   * quotes. The vendor step uses these to compute a per-vendor
   * "cheapest shipping" badge under each price.
   */
  shipping: ShippingLite[];
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
  quotesLoading,
  quotesPartial = false,
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
        quotesLoading={quotesLoading}
        quotesPartial={quotesPartial}
        materialScoped={!!preselectMaterialId}
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
    return (
      <VendorStep
        quotes={quotes}
        shipping={shipping}
        materialId={materialId}
        finishGroupId={finishGroupId}
        selectedQuote={selectedQuote}
        onPick={onSelectQuote}
        onBack={() => {
          // Single-finish materials skipped the finish step on the
          // way in — pop back to material so the user isn't bounced
          // right back here by FinishStep's auto-advance effect.
          if (finishGroupCountForMaterial <= 1) {
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
