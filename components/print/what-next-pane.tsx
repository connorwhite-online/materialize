"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileUploader } from "@/components/upload/file-uploader";

const FEATHER_PX = 28;

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
        : { atStart, atEnd }
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
    <div className="space-y-5">
      {/* Uploader — same featured Add a File well as authed home */}
      <div className="space-y-3">
        <FileUploader onFileSelected={onFilePicked} />
        {uploadError && (
          <p className="text-xs text-destructive">{uploadError}</p>
        )}
      </div>

      {/* Horizontal tile carousel */}
      {tiles.length > 0 && (
        <div>
          <h2 className="mb-2.5 text-sm font-medium">{tilesLabel}</h2>
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
                className="group flex shrink-0 flex-col gap-1.5"
                style={{ width: "96px" }}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted transition-colors group-hover:border-primary/40">
                  {tile.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground/50">
                      .{tile.format}
                    </div>
                  )}
                  {tile.source === "purchased" && (
                    <span className="absolute left-1 top-1 rounded-sm bg-background/80 px-1 py-0.5 text-[8px] font-medium backdrop-blur-sm">
                      Purchased
                    </span>
                  )}
                </div>
                <p className="truncate text-xs font-medium leading-tight transition-colors group-hover:text-primary">
                  {tile.name}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  .{tile.format}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
