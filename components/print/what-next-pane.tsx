"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileUploader } from "@/components/upload/file-uploader";
import { Alert } from "@/components/ui/alert";

const FEATHER_PX = 28;

const HOW_IT_WORKS = [
  {
    title: "Upload a model",
    description: "Your file is checked and sized for manufacturing.",
  },
  {
    title: "Compare live quotes",
    description: "Plastics, resins and metals from print shops worldwide.",
  },
  {
    title: "Order and track",
    description: "Pick shipping, check out, and follow it to your door.",
  },
] as const;

type Format = "stl" | "obj" | "3mf" | "step" | "amf";

interface LibraryTile {
  fileAssetId: string;
  name: string;
  thumbnailUrl: string | null;
  format: string;
  source: "owned" | "purchased";
}

interface WhatNextPaneProps {
  tiles: LibraryTile[];
  linkSuffix: string;
  onFilePicked: (file: File, format: Format) => void;
  uploadError?: string | null;
  /** Heading for the tile carousel. Defaults to "Your recent files". */
  tilesLabel?: string;
  /**
   * @deprecated Tiles are now always visible as a horizontal carousel.
   * This prop is ignored and retained only for call-site compatibility.
   */
  tilesDefaultExpanded?: boolean;
}

/**
 * Idle left column for the /print page. Shows an uploader and a
 * horizontal carousel of the user's library so they can immediately
 * pick a file without scrolling through a long list.
 *
 * Tile order is determined server-side (most recently printed first).
 */
export function WhatNextPane({
  tiles,
  linkSuffix,
  onFilePicked,
  uploadError,
  tilesLabel = "Your recent files",
}: WhatNextPaneProps) {
  // Scroll-aware edge feathering: only fade an edge when there's
  // content hidden beyond it. At rest (scrollLeft 0) the left edge
  // stays crisp so the first tile isn't dimmed; the right fades while
  // more tiles remain, and vice-versa once scrolled to the end.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) =>
      prev.atStart === atStart && prev.atEnd === atEnd
        ? prev
        : { atStart, atEnd },
    );
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges, tiles.length]);

  const leftPx = edges.atStart ? 0 : FEATHER_PX;
  const rightPx = edges.atEnd ? 0 : FEATHER_PX;
  const carouselMask = `linear-gradient(to right, transparent 0, #000 ${leftPx}px, #000 calc(100% - ${rightPx}px), transparent 100%)`;

  return (
    <div className="flex flex-col gap-8">
      {/* Uploader — same featured well as authed home */}
      <div className="flex flex-col gap-3">
        <FileUploader onFileSelected={onFilePicked} />
        {uploadError && (
          <Alert variant="destructive">
            <p className="font-medium">That upload didn&apos;t go through</p>
            <p className="text-[13px] leading-[18px] opacity-90">
              {uploadError.replace(/\.$/, "")}. Try the file again, or pick
              another.
            </p>
          </Alert>
        )}
      </div>

      {/* First-timers get the three steps instead of an empty space. */}
      {tiles.length === 0 && (
        <ol className="grid gap-5 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Horizontal tile carousel */}
      {tiles.length > 0 && (
        <div>
          <h2 className="mb-3 text-base leading-6 font-semibold">
            {tilesLabel}
          </h2>
          {/* Feathered edges: a horizontal mask fades tiles as they
              scroll out of view. The fade is applied per-edge only when
              that edge has hidden content (see updateEdges), so the
              first tile stays crisp until the user scrolls. */}
          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              maskImage: carouselMask,
              WebkitMaskImage: carouselMask,
            }}
          >
            {tiles.map((tile) => (
              <Link
                key={tile.fileAssetId}
                href={`/print/${tile.fileAssetId}${linkSuffix}`}
                className="group flex shrink-0 flex-col gap-2"
                style={{ width: "112px" }}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border ring-inset">
                  {tile.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] font-medium text-subtle-foreground uppercase">
                      .{tile.format}
                    </div>
                  )}
                  {tile.source === "purchased" && (
                    <span className="sr-only">Purchased</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] leading-[18px] font-medium group-hover:underline group-hover:underline-offset-2">
                    {tile.name}
                  </p>
                  <p className="text-xs text-subtle-foreground">
                    {tile.source === "purchased" ? "Purchased" : "Yours"} ·{" "}
                    <span className="uppercase">{tile.format}</span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
