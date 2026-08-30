"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Label } from "@/components/ui/label";
import { NativeSheet } from "@/components/ui/native-sheet";
import { resolveCatalogImage } from "./catalog-image";
import type { FinishCard } from "./finish-cards";

interface FinishSelectProps {
  finishes: FinishCard[];
  value: string | null;
  onChange: (finishGroupId: string) => void;
}

function FinishThumb({ image }: { image: string | null }) {
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/60">
      {image && (
        <Image
          src={resolveCatalogImage(image)}
          alt=""
          fill
          sizes="48px"
          className="object-cover"
        />
      )}
    </div>
  );
}

function FinishMeta({
  card,
  showPrice = false,
}: {
  card: FinishCard;
  /** From-price belongs on sheet options, not the closed trigger. */
  showPrice?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{card.finishGroupName}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {card.colorCount} {card.colorCount === 1 ? "color" : "colors"} ·{" "}
          {card.configCount} {card.configCount === 1 ? "option" : "options"}
        </p>
      </div>
      {showPrice && (
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-muted-foreground">from</p>
          <p className="text-sm font-medium tabular-nums">
            ${card.cheapest.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Finish control for the vendor step. Always shows the selected
 * finish's catalog image — a text Select would hide the one thing
 * that distinguishes "Standard" from "Polished". Multiple finishes
 * open a NativeSheet of the same cards; a single finish is display
 * only (there's no decision to make).
 */
export function FinishSelect({ finishes, value, onChange }: FinishSelectProps) {
  const [open, setOpen] = useState(false);
  const selected =
    finishes.find((f) => f.finishGroupId === value) ?? finishes[0];
  if (!selected) return null;

  const canChange = finishes.length > 1;

  return (
    <div>
      <Label htmlFor="finish-select">Finish</Label>
      {canChange ? (
        <button
          type="button"
          id="finish-select"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Finish, ${selected.finishGroupName}`}
          onClick={() => setOpen(true)}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card/60 p-2.5 text-left backdrop-blur-sm transition-colors hover:bg-card focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
        >
          <FinishThumb image={selected.finishGroupImage} />
          <FinishMeta card={selected} />
          <ChevronRight
            size={14}
            className="shrink-0 rotate-90 text-muted-foreground"
          />
        </button>
      ) : (
        <div
          id="finish-select"
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-card/60 p-2.5 dark:border-input dark:bg-input/30"
        >
          <FinishThumb image={selected.finishGroupImage} />
          <FinishMeta card={selected} />
        </div>
      )}

      {canChange && (
        <NativeSheet
          open={open}
          onClose={() => setOpen(false)}
          ariaLabel="Choose a finish"
        >
          <div className="px-6 pb-2">
            <h2 className="text-lg font-semibold leading-tight">Finish</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How the part is processed after printing
            </p>
            <div className="mt-4 space-y-2">
              {finishes.map((card) => {
                const isSelected =
                  card.finishGroupId === selected.finishGroupId;
                return (
                  <button
                    key={card.finishGroupId}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={card.finishGroupName}
                    onClick={() => {
                      onChange(card.finishGroupId);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/30"
                    }`}
                  >
                    <FinishThumb image={card.finishGroupImage} />
                    <FinishMeta card={card} showPrice />
                  </button>
                );
              })}
            </div>
          </div>
        </NativeSheet>
      )}
    </div>
  );
}
