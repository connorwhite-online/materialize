"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThumbnailCapture } from "@/components/viewer/thumbnail-capture";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";

export interface LibraryFileCardItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  visibility: string;
  source: "owned" | "purchased";
  thumbnailUrl: string | null;
  /**
   * Curator photo ids beyond the cover. The card carousel renders
   * the cover (via thumbnailUrl) first, then resolves these via
   * /api/thumbnails/{fileId}?photoId={id}. Empty when the file has
   * no curator photos other than the cover (or none at all).
   */
  additionalPhotoIds: string[];
  primaryAssetId: string | null;
  primaryFormat: string | null;
  dimensions: [number, number, number] | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  // Set when the deferred fingerprint pass auto-archived this listing
  // on a cross-user geometry collision; surfaces a "Flagged" badge so
  // the owner notices something they wouldn't otherwise see (the
  // listing is still in their library but hidden from buyers).
  flaggedReason?: string | null;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const autoCaptureStarted = useRef(false);

  const previewable =
    isOwner &&
    item.source === "owned" &&
    !!item.primaryAssetId &&
    !!item.primaryFormat &&
    PREVIEWABLE_FORMATS.has(item.primaryFormat);

  const kickOffCapture = useCallback(() => {
    if (capturing || !item.primaryAssetId) return;
    setCapturing(true);
    // Same-origin proxy URL — no JSON pre-fetch, the proxy enforces
    // access on each request and there's no signed URL to expire.
    setCaptureModelUrl(`/api/files/preview/${item.primaryAssetId}`);
  }, [capturing, item.primaryAssetId]);

  // Safety net — if the offscreen capture hasn't produced a thumbnail
  // after 20s (loader error, CORS block, infinite suspense, etc.), let
  // go of the captureModelUrl so at least the spinner goes away.
  useEffect(() => {
    if (!captureModelUrl) return;
    const id = setTimeout(() => {
      console.warn(
        `[thumbnail] capture timed out for "${item.name}" — giving up`
      );
      setCaptureModelUrl(null);
      setCapturing(false);
    }, 20000);
    return () => clearTimeout(id);
  }, [captureModelUrl, item.name]);

  // Auto-generate the thumbnail when the card first scrolls into view
  // for the owner. The capture runs offscreen and swaps to an <img>
  // automatically when done — no click needed.
  useEffect(() => {
    if (!previewable || thumbnailUrl || autoCaptureStarted.current) return;
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            autoCaptureStarted.current = true;
            io.disconnect();
            kickOffCapture();
            return;
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [previewable, thumbnailUrl, kickOffCapture]);

  const onCaptured = useCallback(
    async (fileId: string, dataUrl: string) => {
      try {
        console.log(
          `[thumbnail] posting to /api/thumbnails for ${fileId}, body=${dataUrl.length} chars`
        );
        const res = await fetch("/api/thumbnails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId, dataUrl }),
        });
        if (!res.ok) {
          const body = await res.text();
          console.warn(`[thumbnail] POST failed ${res.status}: ${body}`);
          return;
        }
        const { thumbnailUrl: newUrl } = await res.json();
        console.log(`[thumbnail] stored thumbnail at ${newUrl}`);
        setThumbnailUrl(newUrl);
      } catch (err) {
        console.error(`[thumbnail] onCaptured failed`, err);
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
  const isFlagged =
    item.source === "owned" && isOwner && !!item.flaggedReason;

  return (
    <Link href={`/files/${item.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div
          ref={containerRef}
          className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30"
        >
          {thumbnailUrl ? (
            <CardImageCarousel
              images={[
                thumbnailUrl,
                ...item.additionalPhotoIds.map(
                  (id) => `/api/thumbnails/${item.id}?photoId=${id}`
                ),
              ]}
              alt=""
              size="sm"
            />
          ) : capturing ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
            </div>
          ) : null}

          {/* Status badges overlay the thumbnail top-left so they
              read at a glance without taking up footer real estate.
              Backdrop-blur keeps them legible over any image. */}
          {(isHidden || isFlagged) && (
            <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-wrap items-center gap-1">
              {isHidden && (
                <span className="inline-flex items-center rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md ring-1 ring-white/10">
                  Hidden
                </span>
              )}
              {isFlagged && (
                <span className="inline-flex items-center rounded-md bg-destructive/85 px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground backdrop-blur-md ring-1 ring-destructive/30">
                  Flagged
                </span>
              )}
            </div>
          )}
        </div>
        <CardContent className="px-2 py-2">
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
          {(hasPrice || isPurchased) && (
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
