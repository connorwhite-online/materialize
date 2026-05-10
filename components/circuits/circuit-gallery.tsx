"use client";

import { useState } from "react";
import { CircuitUploader } from "./circuit-uploader";
import { DeleteCircuitButton } from "./delete-circuit-button";
import { PhotoLightbox } from "@/components/photos/photo-lightbox";

export type CircuitTile = {
  id: string;
  previewUrl: string;
  caption: string | null;
  /**
   * Future-proofing — phase 2/3 will start emitting non-image kinds
   * (fritzing source, kicad files, wokwi URLs) and the tile needs to
   * know whether to render an interactive viewer vs a plain image.
   * Today every tile is treated as an image.
   */
  kind:
    | "image"
    | "fritzing"
    | "kicad_sch"
    | "kicad_pcb"
    | "gerber"
    | "wokwi_url";
};

interface Props {
  projectId: string;
  circuits: CircuitTile[];
  /** Owner of the project — only the owner sees the add tile + Xs. */
  canManage: boolean;
}

/**
 * Horizontal carousel of circuit / wiring diagram tiles for a
 * project. Matches the chrome of the file-page PhotosFeed — same
 * snap-scrolling tiles, same lightbox on click, same scrollbar
 * suppression, same add-tile-first ordering for owners. Empty + owner
 * collapses to a compact uploader; empty + non-owner renders nothing
 * (the parent decides whether to show the section header at all).
 */
export function CircuitGallery({ projectId, circuits, canManage }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (circuits.length === 0 && !canManage) return null;

  if (circuits.length === 0 && canManage) {
    return (
      <div className="flex items-center gap-3">
        <CircuitUploader projectId={projectId} size="sm" multiple />
        <p className="text-xs text-muted-foreground">
          Add a wiring diagram so builders can wire up the electronics.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {canManage && (
          <div className="shrink-0 aspect-square w-32 sm:w-40 snap-start">
            <CircuitUploader projectId={projectId} size="lg" multiple />
          </div>
        )}
        {circuits.map((c, i) => (
          <div
            key={c.id}
            className="group relative shrink-0 aspect-square w-32 sm:w-40 snap-start overflow-hidden rounded-xl border border-border bg-muted/30"
          >
            <button
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="absolute inset-0 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={c.caption || `Diagram ${i + 1}`}
            >
              {/* object-contain so a wide schematic doesn't get
                  awkwardly cropped to a square — letterbox is the
                  right call for technical drawings, unlike photos. */}
              <img
                src={c.previewUrl}
                alt={c.caption || ""}
                className="absolute inset-0 h-full w-full object-contain bg-white dark:bg-zinc-900"
              />
            </button>
            {canManage && <DeleteCircuitButton circuitId={c.id} />}
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={circuits.map((c) => ({
            id: c.id,
            downloadUrl: c.previewUrl,
            caption: c.caption,
          }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </>
  );
}
