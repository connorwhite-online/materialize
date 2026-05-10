"use client";

import { useState } from "react";
import { CircuitUploader } from "./circuit-uploader";
import { DeleteCircuitButton } from "./delete-circuit-button";
import { AddWokwiDialog } from "./add-wokwi-dialog";
import { CircuitLightbox } from "./circuit-lightbox";

export type CircuitTile = {
  id: string;
  /**
   * The thumbnail image URL — may be empty for kinds whose preview
   * is rendered live (Wokwi sim, KiCanvas-rendered KiCad). The tile
   * falls back to a kind-specific placeholder badge when the
   * previewUrl is empty.
   */
  previewUrl: string;
  caption: string | null;
  /**
   * External URL for `wokwi_url` kind — the public wokwi.com project
   * we iframe in the lightbox. Null for all other kinds today.
   */
  externalUrl: string | null;
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
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <CircuitUploader projectId={projectId} size="sm" multiple />
          <p className="text-xs text-muted-foreground">
            Add a wiring diagram so builders can wire up the electronics.
          </p>
        </div>
        <div>
          <AddWokwiDialog projectId={projectId} />
        </div>
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
          <CircuitThumb
            key={c.id}
            circuit={c}
            index={i}
            onOpen={setLightboxIndex}
            canDelete={canManage}
          />
        ))}
      </div>

      {canManage && (
        <div className="mt-2">
          <AddWokwiDialog projectId={projectId} />
        </div>
      )}

      {lightboxIndex !== null && (
        <CircuitLightbox
          circuits={circuits}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </>
  );
}

interface ThumbProps {
  circuit: CircuitTile;
  index: number;
  onOpen: (i: number) => void;
  canDelete: boolean;
}

/**
 * Individual circuit tile — renders the image preview when one
 * exists, falls back to a kind-specific badge tile when it doesn't.
 * The Wokwi badge intentionally doesn't try to fetch a screenshot
 * (Wokwi exposes neither a public preview API nor predictable share-
 * thumbnail URLs); a labeled tile is honest and cheap.
 */
function CircuitThumb({ circuit, index, onOpen, canDelete }: ThumbProps) {
  return (
    <div className="group relative shrink-0 aspect-square w-32 sm:w-40 snap-start overflow-hidden rounded-xl border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => onOpen(index)}
        className="absolute inset-0 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={circuit.caption || `Diagram ${index + 1}`}
      >
        {circuit.previewUrl ? (
          // object-contain so a wide schematic doesn't get awkwardly
          // cropped to a square — letterbox is the right call for
          // technical drawings, unlike photos.
          <img
            src={circuit.previewUrl}
            alt={circuit.caption || ""}
            className="absolute inset-0 h-full w-full object-contain bg-white dark:bg-zinc-900"
          />
        ) : (
          <KindPlaceholder kind={circuit.kind} />
        )}
      </button>
      {circuit.kind === "wokwi_url" && (
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-md">
          Wokwi
        </span>
      )}
      {canDelete && <DeleteCircuitButton circuitId={circuit.id} />}
    </div>
  );
}

function KindPlaceholder({ kind }: { kind: CircuitTile["kind"] }) {
  const label =
    kind === "wokwi_url"
      ? "Wokwi simulation"
      : kind === "kicad_sch"
        ? "KiCad schematic"
        : kind === "kicad_pcb"
          ? "KiCad PCB"
          : kind === "gerber"
            ? "Gerber"
            : kind === "fritzing"
              ? "Fritzing"
              : "Diagram";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-zinc-100 to-zinc-200 px-3 text-center dark:from-zinc-800 dark:to-zinc-900">
      <div className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground/70">
        {label}
      </div>
      <div className="text-[10px] text-muted-foreground">Tap to view</div>
    </div>
  );
}
