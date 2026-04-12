"use client";

import { useState } from "react";
import { getMaterialById, getMaterialsByQuickFilter } from "@/lib/materials";
import { QUICK_FILTER_LABELS, type QuickFilter } from "@/lib/materials/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialCardPreview } from "@/components/materials/material-card-preview";

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

interface MaterialSelectorProps {
  materialGroups: Record<string, Quote[]>;
  selectedQuote: Quote | null;
  onSelectQuote: (quote: Quote) => void;
  modelDimensions?: { x: number; y: number; z: number };
}

export function MaterialSelector({
  materialGroups,
  selectedQuote,
  onSelectQuote,
  modelDimensions,
}: MaterialSelectorProps) {
  const [activeFilter, setActiveFilter] = useState<QuickFilter | null>(null);
  const materials = Object.entries(materialGroups);

  // Get filtered material IDs if quick filter is active
  const filteredIds = activeFilter
    ? new Set(getMaterialsByQuickFilter(activeFilter).map((m) => m.id))
    : null;

  const filteredMaterials = filteredIds
    ? materials.filter(([id]) => filteredIds.has(id))
    : materials;

  if (materials.length === 0) {
    return (
      <p className="text-muted-foreground">
        No materials available for this file.
      </p>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Select Material</h2>

      {/* Quick-start filter buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.entries(QUICK_FILTER_LABELS) as [QuickFilter, string][]).map(
          ([filter, label]) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? "secondary" : "ghost"}
              size="xs"
              onClick={() =>
                setActiveFilter(activeFilter === filter ? null : filter)
              }
            >
              {label}
            </Button>
          )
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {filteredMaterials.map(([materialId, quotes]) => {
          const cheapest = quotes.reduce((min, q) =>
            q.price < min.price ? q : min
          );
          const metadata = getMaterialById(materialId);
          const color = metadata?.color || "#a0a0a0";
          const isSelected =
            selectedQuote?.materialConfigId === materialId;

          const hasDims =
            modelDimensions &&
            typeof modelDimensions.x === "number" &&
            typeof modelDimensions.y === "number" &&
            typeof modelDimensions.z === "number";
          const tooLarge =
            hasDims &&
            metadata &&
            (modelDimensions!.x > metadata.constraints.maxDimensions.x ||
              modelDimensions!.y > metadata.constraints.maxDimensions.y ||
              modelDimensions!.z > metadata.constraints.maxDimensions.z);

          return (
            <button
              key={materialId}
              onClick={() => onSelectQuote(cheapest)}
              disabled={!!tooLarge}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                tooLarge
                  ? "border-border opacity-50 cursor-not-allowed"
                  : isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
              }`}
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border">
                <MaterialCardPreview color={color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">
                  {metadata?.name || materialId}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {metadata?.method || cheapest.printingMethodId}
                  </span>
                  {metadata && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 capitalize"
                    >
                      {metadata.priceRange}
                    </Badge>
                  )}
                </div>
                {tooLarge && (
                  <p className="text-[10px] text-destructive mt-1">
                    Model exceeds build volume
                  </p>
                )}
                {metadata && !tooLarge && (
                  <div className="mt-2 flex flex-col gap-1">
                    {(
                      [
                        ["strength", "Strength"],
                        ["flexibility", "Flexibility"],
                        ["detail", "Detail"],
                      ] as const
                    ).map(([prop, label]) => (
                      <div key={prop} className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {label}
                        </span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div
                              key={i}
                              className={`h-1.5 w-1.5 rounded-full ${
                                i < metadata.properties[prop]
                                  ? "bg-foreground/60"
                                  : "bg-muted"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-medium text-sm">
                  ${cheapest.price.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cheapest.productionTimeFast}-{cheapest.productionTimeSlow}d
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {filteredMaterials.length === 0 && activeFilter && (
        <div className="mt-4 text-center text-sm text-muted-foreground">
          No {QUICK_FILTER_LABELS[activeFilter].toLowerCase()} materials
          available for this model.
        </div>
      )}
    </div>
  );
}

