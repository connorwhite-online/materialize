"use client";

interface Quote {
  quoteId: string;
  vendorId: string;
  materialConfigId: string;
  printingMethodId: string;
  quantity: number;
  price: number;
  currency: string;
  productionTimeFast: number;
  productionTimeSlow: number;
}

// Material color mapping for 3D preview
const MATERIAL_COLORS: Record<string, string> = {
  "pla-white": "#f0f0f0",
  "pla-black": "#1a1a1a",
  "abs-white": "#e8e8e8",
  "nylon-pa12": "#d4d4d4",
  "nylon-pa12-black": "#2a2a2a",
  "resin-standard": "#f5f0e0",
  "resin-tough": "#c0c0c0",
  "steel-316l": "#8a8a8a",
  aluminum: "#b0b8c0",
  titanium: "#7a7a80",
};

const MATERIAL_LABELS: Record<string, { name: string; method: string }> = {
  "pla-white": { name: "PLA White", method: "FDM" },
  "pla-black": { name: "PLA Black", method: "FDM" },
  "abs-white": { name: "ABS White", method: "FDM" },
  "nylon-pa12": { name: "Nylon PA12", method: "SLS" },
  "nylon-pa12-black": { name: "Nylon PA12 Black", method: "SLS" },
  "resin-standard": { name: "Standard Resin", method: "SLA" },
  "resin-tough": { name: "Tough Resin", method: "SLA" },
  "steel-316l": { name: "Stainless Steel 316L", method: "DMLS" },
  aluminum: { name: "Aluminum AlSi10Mg", method: "DMLS" },
  titanium: { name: "Titanium Ti6Al4V", method: "DMLS" },
};

interface MaterialSelectorProps {
  materialGroups: Record<string, Quote[]>;
  selectedQuote: Quote | null;
  onSelectQuote: (quote: Quote) => void;
}

export function MaterialSelector({
  materialGroups,
  selectedQuote,
  onSelectQuote,
}: MaterialSelectorProps) {
  const materials = Object.entries(materialGroups);

  if (materials.length === 0) {
    return (
      <p className="text-foreground/60">No materials available for this file.</p>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Select Material</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {materials.map(([materialId, quotes]) => {
          // Use the cheapest quote for this material
          const cheapest = quotes.reduce((min, q) =>
            q.price < min.price ? q : min
          );
          const label = MATERIAL_LABELS[materialId];
          const color = MATERIAL_COLORS[materialId] || "#a0a0a0";
          const isSelected =
            selectedQuote?.materialConfigId === materialId;

          return (
            <button
              key={materialId}
              onClick={() => onSelectQuote(cheapest)}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                isSelected
                  ? "border-foreground bg-foreground/5"
                  : "border-foreground/10 hover:border-foreground/20"
              }`}
            >
              <div
                className="h-10 w-10 rounded-md border border-foreground/10"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1">
                <p className="font-medium">
                  {label?.name || materialId}
                </p>
                <p className="text-xs text-foreground/50">
                  {label?.method || cheapest.printingMethodId}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  ${cheapest.price.toFixed(2)}
                </p>
                <p className="text-xs text-foreground/50">
                  {cheapest.productionTimeFast}-{cheapest.productionTimeSlow}{" "}
                  days
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { MATERIAL_COLORS };
