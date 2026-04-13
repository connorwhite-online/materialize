"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const autoCaptureStarted = useRef(false);

  const previewable =
    isOwner &&
    item.source === "owned" &&
    !!item.primaryAssetId &&
    !!item.primaryFormat &&
    PREVIEWABLE_FORMATS.has(item.primaryFormat);

  const kickOffCapture = useCallback(async () => {
    if (capturing || !item.primaryAssetId) return;
    setCapturing(true);
    try {
      const res = await fetch("/api/craftcloud/download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileAssetId: item.primaryAssetId }),
      });
      if (!res.ok) {
        console.warn(
          `[thumbnail] download-url failed for asset ${item.primaryAssetId}`,
          res.status
        );
        throw new Error("download url failed");
      }
      const data = await res.json();
      console.log(
        `[thumbnail] capture starting for "${item.name}"`,
        data.downloadUrl
      );
      setCaptureModelUrl(data.downloadUrl);
    } catch (err) {
      console.error(`[thumbnail] kickOffCapture failed`, err);
      setCapturing(false);
    }
  }, [capturing, item.primaryAssetId, item.name]);

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

  return (
    <Link href={`/files/${item.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div
          ref={containerRef}
          className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30"
        >
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : capturing ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
            </div>
          ) : null}
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
