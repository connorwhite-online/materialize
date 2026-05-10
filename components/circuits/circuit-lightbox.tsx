"use client";

import { useEffect, useCallback } from "react";
import { X } from "@/components/icons/x";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { CircuitTile } from "./circuit-gallery";

interface Props {
  circuits: CircuitTile[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

/**
 * Kind-aware fullscreen viewer for circuit tiles. Images render at
 * native aspect ratio (same chrome as PhotoLightbox); Wokwi entries
 * iframe the public project URL so the simulator runs in-place. KiCad
 * and Gerber kinds slot in here in subsequent phases.
 */
export function CircuitLightbox({
  circuits,
  index,
  onClose,
  onIndexChange,
}: Props) {
  const circuit = circuits[index];

  const goPrev = useCallback(() => {
    onIndexChange(index === 0 ? circuits.length - 1 : index - 1);
  }, [index, circuits.length, onIndexChange]);

  const goNext = useCallback(() => {
    onIndexChange(index === circuits.length - 1 ? 0 : index + 1);
  }, [index, circuits.length, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!circuit) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Circuit viewer"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={18} />
      </button>

      {circuits.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="Previous diagram"
            className="absolute left-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label="Next diagram"
            className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-8rem)] max-w-full flex-col items-center"
      >
        {circuit.kind === "wokwi_url" && circuit.externalUrl ? (
          <iframe
            src={circuit.externalUrl}
            title={circuit.caption || "Wokwi simulation"}
            // Wokwi's embed iframe wants width to behave; lock to a
            // wide 16:10 viewport that fits most desktops without
            // pushing the caption offscreen.
            className="h-[70vh] w-[min(90vw,1100px)] rounded-lg border border-white/10 bg-white"
            allow="autoplay; clipboard-read; clipboard-write; serial; usb"
            // serial / usb let the user flash a Wokwi sim to real
            // hardware via Web Serial — meaningful for kit projects.
          />
        ) : (
          <img
            src={circuit.previewUrl}
            alt={circuit.caption || ""}
            className="max-h-[70vh] max-w-full object-contain"
          />
        )}

        {circuit.caption && (
          <p className="mt-4 max-w-prose text-center text-sm text-white/90">
            {circuit.caption}
          </p>
        )}

        {circuit.kind === "wokwi_url" && circuit.externalUrl && (
          <a
            href={circuit.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
          >
            Open on wokwi.com →
          </a>
        )}
      </div>

      {circuits.length > 1 && (
        <p className="mt-3 text-xs text-white/60 tabular-nums">
          {index + 1} / {circuits.length}
        </p>
      )}
    </div>
  );
}
