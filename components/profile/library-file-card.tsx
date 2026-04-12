"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThumbnailCapture } from "@/components/viewer/thumbnail-capture";

export interface LibraryFileCardItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  visibility: string;
  source: "owned" | "purchased";
  thumbnailUrl: string | null;
  primaryAssetId: string | null;
  primaryFormat: string | null;
  dimensions: [number, number, number] | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
}

interface LibraryFileCardProps {
  item: LibraryFileCardItem;
  isOwner: boolean;
}

const PREVIEWABLE_FORMATS = new Set(["stl", "obj", "3mf"]);

function formatDim(n: number) {
  return n.toFixed(1);
}

/**
 * Library card. Shows the cached thumbnail image if one exists. For the
 * owner of a file with no thumbnail yet, a button mounts a single hidden
 * R3F canvas (`ThumbnailCapture`) to render once, upload, and then swap
 * to the static image. Non-owners just see a placeholder until the owner
 * has generated one.
 */
export function LibraryFileCard({ item, isOwner }: LibraryFileCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState(item.thumbnailUrl);
  const [captureModelUrl, setCaptureModelUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const previewable =
    isOwner &&
    item.source === "owned" &&
    !!item.primaryAssetId &&
    !!item.primaryFormat &&
    PREVIEWABLE_FORMATS.has(item.primaryFormat);

  const startCapture = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (capturing || !item.primaryAssetId) return;
      setCapturing(true);
      try {
        const res = await fetch("/api/craftcloud/download-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileAssetId: item.primaryAssetId }),
        });
        if (!res.ok) throw new Error("download url failed");
        const data = await res.json();
        setCaptureModelUrl(data.downloadUrl);
      } catch {
        setCapturing(false);
      }
    },
    [capturing, item.primaryAssetId]
  );

  const onCaptured = useCallback(
    async (fileId: string, dataUrl: string) => {
      try {
        const res = await fetch("/api/thumbnails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId, dataUrl }),
        });
        if (res.ok) {
          const { thumbnailUrl: newUrl } = await res.json();
          setThumbnailUrl(newUrl);
        }
      } catch {
        // nice-to-have
      } finally {
        setCaptureModelUrl(null);
        setCapturing(false);
      }
    },
    []
  );

  const isHidden =
    item.source === "owned" && isOwner && item.visibility === "private";
  const isPurchased = item.source === "purchased";
  const hasPrice = item.source === "owned" && item.price > 0;

  return (
    <Link href={`/files/${item.slug}`}>
      <Card className="group overflow-hidden transition-colors hover:border-primary/30">
        <div className="relative aspect-square w-full bg-gradient-to-br from-muted/60 to-muted/30">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : previewable ? (
            <button
              type="button"
              onClick={startCapture}
              disabled={capturing}
              className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              {capturing ? (
                <span className="flex flex-col items-center gap-1">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
                  Generating…
                </span>
              ) : (
                "Generate preview"
              )}
            </button>
          ) : null}
        </div>
        <CardContent className="p-3">
          <h3 className="truncate text-sm font-medium transition-colors group-hover:text-primary">
            {item.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.dimensions
              ? `${formatDim(item.dimensions[0])} × ${formatDim(item.dimensions[1])} × ${formatDim(item.dimensions[2])} mm`
              : isPurchased && item.creatorUsername
                ? `by ${item.creatorDisplayName || item.creatorUsername}`
                : "—"}
          </p>
          {(hasPrice || isPurchased || isHidden) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {hasPrice && (
                <Badge variant="secondary" className="text-[10px]">
                  ${(item.price / 100).toFixed(2)}
                </Badge>
              )}
              {isPurchased && (
                <Badge variant="secondary" className="text-[10px]">
                  Purchased
                </Badge>
              )}
              {isHidden && (
                <Badge variant="outline" className="text-[10px]">
                  Hidden
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {captureModelUrl && item.primaryFormat && (
        <ThumbnailCapture
          modelUrl={captureModelUrl}
          format={
            item.primaryFormat as "stl" | "obj" | "3mf" | "step" | "amf"
          }
          fileId={item.id}
          onCapture={onCaptured}
        />
      )}
    </Link>
  );
}
