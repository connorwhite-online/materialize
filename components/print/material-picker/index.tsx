"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialStep } from "./material-step";
import { FinishStep } from "./finish-step";
import { VendorStep } from "./vendor-step";
import type { EnrichedQuote, PickerStep } from "./types";

/**
 * Find the best-matching material in a quote set given a loose
 * name hint. Tries progressively shorter word prefixes of the
 * normalized hint until something matches — "PLA White" first
 * looks for a quote starting with "pla white", then "pla". Used
 * by the "Print with X" flow since our local curated material
 * ids don't line up with CraftCloud's internal ids.
 */
function findMaterialByNameHint(
  quotes: EnrichedQuote[],
  hint: string
): EnrichedQuote | null {
  const normalized = hint
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (normalized.length === 0) return null;

  for (let i = normalized.length; i > 0; i--) {
    const prefix = normalized.slice(0, i).join(" ");
    const hit = quotes.find((q) =>
      q.materialName.toLowerCase().startsWith(prefix)
    );
    if (hit) return hit;
  }
  return null;
}

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
   * Material-name hint from the "Print with X" flow. When provided,
   * we try to find the best-matching material in the returned quote
   * set and jump straight to the finish step. The hint is a name,
   * not an id, because our local curated catalog (/materials/*)
   * uses its own ids that don't correspond to CraftCloud's, and
   * fuzzy-matching by name is robust to either side renaming.
   */
  preselectMaterialName?: string;
}

export function MaterialPicker({
  quotes,
  shipping,
  quotesLoading,
  selectedQuote,
  onSelectQuote,
  preselectMaterialName,
}: MaterialPickerProps) {
  const [step, setStep] = useState<PickerStep>("material");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [finishGroupId, setFinishGroupId] = useState<string | null>(null);
  // Tracks whether the preselect has already fired. Without this,
  // a later user "Back" out of the finish step would get rubber-
  // banded right back in by the effect re-running.
  const preselectFiredRef = useRef(false);

  useEffect(() => {
    if (!preselectMaterialName) return;
    if (preselectFiredRef.current) return;
    if (quotes.length === 0) return;
    const hit = findMaterialByNameHint(quotes, preselectMaterialName);
    if (!hit) return;
    preselectFiredRef.current = true;
    setMaterialId(hit.materialId);
    setStep("finish");
  }, [preselectMaterialName, quotes]);

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
