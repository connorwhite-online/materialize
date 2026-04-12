"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadPreview } from "@/components/upload/upload-preview";

export interface LibraryFileCardItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  visibility: string;
  source: "owned" | "purchased";
  primaryAssetId: string | null;
  primaryFormat: string | null;
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
 * Library card with a lazy-mounted 3D preview. The preview canvas is
 * only mounted when the card scrolls into view (IntersectionObserver),
 * so a profile with 50 files doesn't try to spin up 50 R3F instances
 * at once. Dimensions reported by the preview show under the name.
 */
export function LibraryFileCard({ item, isOwner }: LibraryFileCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [dimensions, setDimensions] = useState<
    [number, number, number] | null
  >(null);

  const previewable =
    !!item.primaryAssetId &&
    !!item.primaryFormat &&
    PREVIEWABLE_FORMATS.has(item.primaryFormat);

  useEffect(() => {
    if (!previewable || visible) return;
    const el = containerRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [previewable, visible]);

  const isHidden = item.source === "owned" && isOwner && item.visibility === "private";
  const isPurchased = item.source === "purchased";
  const hasPrice = item.source === "owned" && item.price > 0;

  return (
    <Link href={`/files/${item.slug}`}>
      <Card className="group overflow-hidden transition-colors hover:border-primary/30">
        <div
          ref={containerRef}
          className="relative aspect-square w-full bg-gradient-to-br from-muted/60 to-muted/30"
        >
          {previewable && visible && (
            <UploadPreview
              fileAssetId={item.primaryAssetId!}
              format={
                item.primaryFormat as "stl" | "obj" | "3mf" | "step" | "amf"
              }
              onDimensionsComputed={setDimensions}
            />
          )}
        </div>
        <CardContent className="p-3">
          <h3 className="truncate text-sm font-medium transition-colors group-hover:text-primary">
            {item.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {dimensions
              ? `${formatDim(dimensions[0])} × ${formatDim(dimensions[1])} × ${formatDim(dimensions[2])} mm`
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
    </Link>
  );
}
