"use client";

import { useEffect, useState } from "react";
import { MaterialStep } from "./material-step";
import { FinishStep } from "./finish-step";
import { VendorStep } from "./vendor-step";
import type { EnrichedQuote, PickerStep } from "./types";

interface MaterialPickerProps {
  quotes: EnrichedQuote[];
  /** True while the /v5/price request is still in flight. */
  quotesLoading: boolean;
  selectedQuote: EnrichedQuote | null;
  onSelectQuote: (quote: EnrichedQuote) => void;
  /**
   * When the configurator receives a `preselectMaterialId` from the
   * "Print with X" flow we jump straight to the finish step for that
   * material (if it exists in the returned quote set).
   */
  preselectMaterialId?: string;
}

export function MaterialPicker({
  quotes,
  quotesLoading,
  selectedQuote,
  onSelectQuote,
  preselectMaterialId,
}: MaterialPickerProps) {
  const [step, setStep] = useState<PickerStep>("material");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [finishGroupId, setFinishGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!preselectMaterialId) return;
    const hit = quotes.find((q) => q.materialId === preselectMaterialId);
    if (hit) {
      setMaterialId(preselectMaterialId);
      setStep("finish");
    }
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
