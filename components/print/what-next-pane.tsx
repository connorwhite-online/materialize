"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "@/components/icons/chevron-down";
import { ChevronUp } from "@/components/icons/chevron-up";
import { FileUploader } from "@/components/upload/file-uploader";
import { Badge } from "@/components/ui/badge";

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
}

/**
 * Post-add-to-cart left column. Pairs an uploader with a collapsed
 * "your recent files" list so the user can immediately stage another
 * print without pushing past the cart they just built on the right.
 *
 * Tiles are rendered in recency order (sort happens server-side in
 * the /print loader — most-recently-printed first). List is
 * collapsed by default; the uploader is always visible.
 */
export function WhatNextPane({
  tiles,
  linkSuffix,
  onFilePicked,
  uploadError,
}: WhatNextPaneProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">
          Print another file
        </h2>
        <div className="mt-3 space-y-3">
          <FileUploader onFileSelected={onFilePicked} />
          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-medium">
              Your recent files{" "}
              <span className="text-muted-foreground">({tiles.length})</span>
            </span>
            {expanded ? (
              <ChevronUp className="text-muted-foreground" />
            ) : (
              <ChevronDown className="text-muted-foreground" />
            )}
          </button>
          {expanded && (
            <ul className="border-t border-border divide-y divide-border">
              {tiles.map((tile) => (
                <li key={tile.fileAssetId}>
                  <Link
                    href={`/print/${tile.fileAssetId}${linkSuffix}`}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                      {tile.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tile.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground/50">
                          .{tile.format}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {tile.name}
                      </p>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        .{tile.format}
                      </p>
                    </div>
                    {tile.source === "purchased" && (
                      <Badge variant="secondary" className="text-[9px]">
                        Purchased
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
