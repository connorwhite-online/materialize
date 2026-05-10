"use client";

import { useEffect, useCallback, useState } from "react";
import { X } from "@/components/icons/x";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { CircuitTile } from "./circuit-gallery";

// KiCanvas web component — loaded the first time a KiCad tile is
// opened. Idempotent so flipping through tiles doesn't append the
// script repeatedly. Hoisted module-level so it survives unmounts.
let kicanvasLoaded = false;
function loadKiCanvasOnce() {
  if (typeof document === "undefined") return;
  if (kicanvasLoaded) return;
  kicanvasLoaded = true;
  const script = document.createElement("script");
  script.type = "module";
  script.src = "https://kicanvas.org/kicanvas/kicanvas.js";
  script.async = true;
  document.head.appendChild(script);
}

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

  // Kick off the KiCanvas script load eagerly the first time a KiCad
  // tile is the current one. The web component renders nothing until
  // the script has registered the custom element; the lazy load keeps
  // image-only galleries from paying the cost.
  useEffect(() => {
    if (
      circuit &&
      (circuit.kind === "kicad_sch" || circuit.kind === "kicad_pcb")
    ) {
      loadKiCanvasOnce();
    }
  }, [circuit]);

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
        ) : (circuit.kind === "kicad_sch" || circuit.kind === "kicad_pcb") &&
          circuit.sourceUrl ? (
          <KiCanvasViewer
            src={circuit.sourceUrl}
            title={
              circuit.caption ||
              (circuit.kind === "kicad_sch"
                ? "KiCad schematic"
                : "KiCad PCB")
            }
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

        {(circuit.kind === "kicad_sch" || circuit.kind === "kicad_pcb") &&
          circuit.sourceUrl && (
            <a
              href={circuit.sourceUrl}
              download
              className="mt-2 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
            >
              Download source →
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

/**
 * KiCanvas web-component wrapper. The `<kicanvas-embed>` custom
 * element is defined by kicanvas.js (loaded lazily by
 * loadKiCanvasOnce). Until the script registers the element, the
 * browser renders an inert `<kicanvas-embed>` tag — a "Loading…"
 * fallback layered behind it covers that gap.
 *
 * `controls="basic"` enables the layer picker / zoom controls. The
 * theme is left at KiCanvas's default which renders well on the
 * lightbox's dark backdrop.
 */
function KiCanvasViewer({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.customElements?.get("kicanvas-embed")) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (window.customElements?.get("kicanvas-embed")) {
        setLoaded(true);
      } else {
        setTimeout(tick, 100);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="relative h-[70vh] w-[min(90vw,1100px)] overflow-hidden rounded-lg border border-white/10 bg-white">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          Loading KiCanvas…
        </div>
      )}
      {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
      {/* @ts-expect-error kicanvas-embed is a custom element not in JSX types */}
      <kicanvas-embed
        src={src}
        controls="basic"
        title={title}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
