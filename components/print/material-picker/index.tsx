"use client";

import { useEffect, useRef, useState } from "react";
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
  selectedQuote: EnrichedQuote | null;
  onSelectQuote: (quote: EnrichedQuote) => void;
  /**
   * CraftCloud material id from the "Print with X" flow. When
   * provided and a matching quote arrives, we jump straight to
   * the finish step. /materials/[slug] passes the real CraftCloud
   * id here, so an exact match is reliable.
   */
  preselectMaterialId?: string;
}

export function MaterialPicker({
  quotes,
  shipping,
  quotesLoading,
  selectedQuote,
  onSelectQuote,
  preselectMaterialId,
}: MaterialPickerProps) {
  const [step, setStep] = useState<PickerStep>("material");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [finishGroupId, setFinishGroupId] = useState<string | null>(null);
  // Tracks whether the preselect has already fired. Without this,
  // a later user "Back" out of the finish step would get rubber-
  // banded right back in by the effect re-running.
  const preselectFiredRef = useRef(false);

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
          setStep("finish");
          setFinishGroupId(null);
        }}
      />
    );
  }

  return null;
}
