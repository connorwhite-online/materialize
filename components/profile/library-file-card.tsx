"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PrivateCardMark } from "@/components/ui/visibility-mark";
import {
  FileCard,
  fileCardOwnedSubtitle,
  fileCardPhotoUrls,
  fileCardPurchasedSubtitle,
} from "@/components/files/file-card";

// ThumbnailCapture pulls in the full three.js + R3F stack. It only
// renders when an owner's file has no thumbnail yet, but the static
// import would ship three.js in the profile/library route chunk for
// every visitor. React.lazy defers the chunk until the component
// actually mounts. (CON-139)
const ThumbnailCapture = lazy(() =>
  import("@/components/viewer/thumbnail-capture").then((m) => ({
    default: m.ThumbnailCapture,
  }))
);

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
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  // Set when the deferred fingerprint pass auto-archived this listing
  // on a cross-user geometry collision; surfaces a "Flagged" badge so
  // the owner notices something they wouldn't otherwise see (the
  // listing is still in their library but hidden from buyers).
  flaggedReason?: string | null;
  recommendedMaterialId?: string | null;
}

interface LibraryFileCardProps {
  item: LibraryFileCardItem;
  isOwner: boolean;
  /** Narrow carousel tiles (authed home). */
  compact?: boolean;
}

const PREVIEWABLE_FORMATS = new Set(["stl", "obj", "3mf"]);

/**
 * Library card. Shows the cached thumbnail image if one exists. For the
 * owner of a file with no thumbnail yet, a button mounts a single hidden
 * R3F canvas (`ThumbnailCapture`) to render once, upload, and then swap
 * to the static image. Non-owners just see a placeholder until the owner
 * has generated one.
 */
export function LibraryFileCard({
  item,
  isOwner,
  compact = false,
}: LibraryFileCardProps) {
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

  const isPrivate =
    item.source === "owned" && isOwner && item.visibility === "private";
  const isPurchased = item.source === "purchased";
  const hasPrice = item.source === "owned" && item.price > 0;
  const isFlagged =
    item.source === "owned" && isOwner && !!item.flaggedReason;

  // Own files: .stl (matches /print WhatNextPane). Purchased: by creator.
  // Bounding box stays off the card — it truncates on compact tiles and
  // belongs in the quote flow (CON-19).
  const subtitle = isPurchased
    ? fileCardPurchasedSubtitle(item.creatorDisplayName, item.creatorUsername)
    : fileCardOwnedSubtitle(item.primaryFormat);

  return (
    <>
      <FileCard
        href={`/files/${item.slug}`}
        title={item.name}
        compact={compact}
        images={fileCardPhotoUrls(item.id, thumbnailUrl, item.additionalPhotoIds)}
        wellRef={containerRef}
        well={
          thumbnailUrl ? undefined : capturing ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
            </div>
          ) : null
        }
        overlay={
          (isPrivate || isFlagged) && (
            <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex flex-wrap items-center gap-1">
              {isPrivate && <PrivateCardMark />}
              {isFlagged && (
                <span className="inline-flex items-center rounded-md bg-destructive/85 px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground backdrop-blur-md ring-1 ring-destructive/30">
                  Flagged
                </span>
              )}
            </div>
          )
        }
        subtitle={subtitle}
        meta={
          (hasPrice || isPurchased) && (
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
          )
        }
      />
      {captureModelUrl && item.primaryFormat && (
        <Suspense fallback={null}>
          <ThumbnailCapture
            modelUrl={captureModelUrl}
            format={
              item.primaryFormat as "stl" | "obj" | "3mf" | "step" | "amf"
            }
            fileId={item.id}
            onCapture={onCaptured}
            recommendedMaterialId={item.recommendedMaterialId}
          />
        </Suspense>
      )}
    </>
  );
}
