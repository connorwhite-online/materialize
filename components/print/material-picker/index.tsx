"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialStep } from "./material-step";
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
   * "cheapest shipping" badge under each price; both steps
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
   * the vendor step. /materials/[slug] passes the real CraftCloud
   * id here, so an exact match is reliable.
   */
  preselectMaterialId?: string;
  /**
   * CraftCloud finish group id. When provided alongside
   * preselectMaterialId and a matching quote arrives, the vendor
   * step opens on that finish instead of the cheapest. The user
   * can still change finish from there, or press Back to the
   * material grid.
   */
  preselectFinishGroupId?: string;
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
  preselectFinishGroupId,
  onClearPreselectScope,
}: MaterialPickerProps) {
  const [step, setStep] = useState<PickerStep>("material");
  const [materialId, setMaterialId] = useState<string | null>(null);
  // Tracks whether the preselect has already fired. Without this,
  // a later user "Back" out of the vendor step would get rubber-
  // banded right back in by the effect re-running.
  const preselectFiredRef = useRef(false);

  useEffect(() => {
    if (!preselectMaterialId) return;
    if (preselectFiredRef.current) return;
    // Prefer a (material, finish) hit when both are specified so
    // the vendor step can open on that finish. Fall through to
    // material-only if the pair hasn't landed in this snapshot.
    if (preselectFinishGroupId) {
      const pair = quotes.find(
        (q) =>
          q.materialId === preselectMaterialId &&
          q.finishGroupId === preselectFinishGroupId
      );
      if (pair) {
        preselectFiredRef.current = true;
        setMaterialId(preselectMaterialId);
        setStep("vendor");
        return;
      }
    }
    const hit = quotes.find((q) => q.materialId === preselectMaterialId);
    if (!hit) return;
    preselectFiredRef.current = true;
    setMaterialId(preselectMaterialId);
    setStep("vendor");
  }, [preselectMaterialId, preselectFinishGroupId, quotes]);

  const goToMaterials = () => {
    setStep("material");
    setMaterialId(null);
    // Drop the parent's preselect scope so the refetched
    // quote set includes every material, not just the one
    // the user came in with.
    onClearPreselectScope?.();
  };

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
          setStep("vendor");
        }}
      />
    );
  }

  if (step === "vendor" && materialId) {
    return (
      <VendorStep
        key={materialId}
        quotes={quotes}
        shipping={shipping}
        sortQuantity={sortQuantity}
        materialId={materialId}
        initialFinishGroupId={
          materialId === preselectMaterialId
            ? preselectFinishGroupId
            : undefined
        }
        selectedQuote={selectedQuote}
        onPick={onSelectQuote}
        onBack={goToMaterials}
      />
    );
  }

  return null;
}
