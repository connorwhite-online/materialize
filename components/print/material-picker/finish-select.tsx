"use client";

import { useState } from "react";
import Image from "next/image";
import { CheckIcon } from "lucide-react";
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
    <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
      {image && (
        <Image
          src={resolveCatalogImage(image)}
          alt=""
          fill
          sizes="40px"
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
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{card.finishGroupName}</p>
        <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
          {card.colorCount} {card.colorCount === 1 ? "color" : "colors"} ·{" "}
          {card.configCount} {card.configCount === 1 ? "option" : "options"}
        </p>
      </div>
      {showPrice && (
        <p className="shrink-0 text-sm tabular-nums">
          <span className="text-[13px] text-muted-foreground">from </span>
          <span className="font-medium">${card.cheapest.toFixed(2)}</span>
        </p>
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
    <div className="flex min-w-0 flex-col">
      <Label htmlFor="finish-select">Finish</Label>
      {canChange ? (
        <button
          type="button"
          id="finish-select"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Finish, ${selected.finishGroupName}`}
          onClick={() => setOpen(true)}
          className="flex h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-input bg-background px-2 text-left transition-[border-color,box-shadow] duration-150 hover:border-foreground/25 focus-visible:border-ring focus-visible:shadow-input-focus focus-visible:outline-none"
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
          className="flex h-14 w-full items-center gap-3 rounded-xl border border-input bg-background px-2"
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
            <h2 className="text-base leading-6 font-semibold">Finish</h2>
            <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
              How the part is processed after printing
            </p>
            <div className="-mx-3 mt-3 flex flex-col">
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
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 ${
                      isSelected ? "bg-muted" : "hover:bg-muted/70"
                    }`}
                  >
                    <FinishThumb image={card.finishGroupImage} />
                    <FinishMeta card={card} showPrice />
                    <CheckIcon
                      aria-hidden="true"
                      className={`size-4 shrink-0 ${isSelected ? "" : "invisible"}`}
                    />
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
