"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CompareOption {
  id: string;
  label: string;
  detail?: string;
  /** base64 PNG */
  thumbnail?: string;
}

/**
 * Large preview for image options in a question card (concept directions).
 *
 * The cards alone show a 48px thumbnail, and each direction's description
 * only appeared in a hover tooltip (invisible on touch), so options could
 * not really be compared, and blockout concepts differ in SHAPE, which a
 * thumbnail hides. This shows the armed option large; tapping through the
 * cards swaps it. Tapping the preview opens a fullscreen view with prev/next
 * (and arrow keys) to flip between options at full size, and a button to
 * choose the one on screen.
 */
export function ConceptPreview({
  options,
  armedId,
  onArm,
  disabled,
}: {
  options: CompareOption[];
  armedId: string | null;
  onArm: (id: string) => void;
  disabled?: boolean;
}) {
  const withImages = options.filter((o) => o.thumbnail);
  const armedIndex = Math.max(
    0,
    withImages.findIndex((o) => o.id === armedId)
  );
  const [open, setOpen] = useState(false);
  const [viewIndex, setViewIndex] = useState(armedIndex);
  if (withImages.length === 0) return null;

  const shown = withImages[armedIndex];
  const viewing = withImages[Math.min(viewIndex, withImages.length - 1)];
  const step = (delta: number) =>
    setViewIndex((i) => (i + delta + withImages.length) % withImages.length);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setViewIndex(armedIndex);
          setOpen(true);
        }}
        className="group relative mt-3 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-foreground/10 bg-background/40"
        aria-label={`Enlarge ${shown.label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${shown.thumbnail}`}
          alt={shown.label}
          className="mx-auto max-h-64 w-full object-contain"
        />
        <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-80 transition-opacity group-hover:opacity-100">
          <Maximize2Icon className="size-3.5" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-3xl"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1);
            if (e.key === "ArrowLeft") step(-1);
          }}
        >
          <DialogTitle>{viewing.label}</DialogTitle>
          {viewing.detail ? (
            <DialogDescription>{viewing.detail}</DialogDescription>
          ) : null}
          <div className="relative overflow-hidden rounded-xl bg-background/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${viewing.thumbnail}`}
              alt={viewing.label}
              className="mx-auto max-h-[65dvh] w-full object-contain"
            />
            {withImages.length > 1 && (
              <>
                {/* Centered by a WRAPPER, not the button: Button translates
                    itself while pressed (active:translate-y-px), which
                    replaces a -translate-y-1/2 on the same element, so the
                    button jumped down on press and the release missed it. */}
                <span className="absolute top-1/2 left-2 -translate-y-1/2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => step(-1)}
                    aria-label="Previous option"
                  >
                    <ChevronLeftIcon />
                  </Button>
                </span>
                <span className="absolute top-1/2 right-2 -translate-y-1/2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => step(1)}
                    aria-label="Next option"
                  >
                    <ChevronRightIcon />
                  </Button>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1.5" aria-hidden>
              {withImages.map((o, i) => (
                <span
                  key={o.id}
                  className={cn(
                    "size-1.5 rounded-full",
                    i === viewIndex ? "bg-foreground" : "bg-foreground/20"
                  )}
                />
              ))}
            </div>
            <Button
              disabled={disabled}
              onClick={() => {
                onArm(viewing.id);
                setOpen(false);
              }}
            >
              {viewing.id === armedId ? "Selected" : "Choose this one"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
