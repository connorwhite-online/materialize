"use client";

import { useEffect, useState } from "react";
import { MaterialPreview } from "@/components/viewer/material-preview";

interface OrderModelPreviewProps {
  fileAssetId: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  materialColor: string;
}

const PREVIEWABLE = new Set(["stl", "obj", "3mf"]);

/**
 * Resolves a signed download URL for the order's file asset and renders
 * it with the Materialize shader tinted to the ordered material's color.
 * Server-side rendering can't issue the signed URL request, hence the
 * client component layer in front of MaterialPreview.
 */
export function OrderModelPreview({
  fileAssetId,
  format,
  materialColor,
}: OrderModelPreviewProps) {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!PREVIEWABLE.has(format)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/craftcloud/download-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileAssetId }),
        });
        if (!res.ok) throw new Error("download url failed");
        const data = await res.json();
        if (!cancelled) setModelUrl(data.downloadUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileAssetId, format]);

  if (!PREVIEWABLE.has(format)) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        Preview not supported for .{format}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        Preview unavailable
      </div>
    );
  }

  if (!modelUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return (
    <MaterialPreview
      modelUrl={modelUrl}
      format={format}
      materialColor={materialColor}
      className="h-full w-full"
    />
  );
}
