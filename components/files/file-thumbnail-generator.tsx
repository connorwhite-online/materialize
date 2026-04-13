"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ThumbnailCapture } from "@/components/viewer/thumbnail-capture";

interface FileThumbnailGeneratorProps {
  fileId: string;
  fileAssetId: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
}

const PREVIEWABLE = new Set(["stl", "obj", "3mf"]);

/**
 * Mounts on the file detail page for the owner when the file has no
 * cached thumbnail yet. Fetches a signed download URL, renders the
 * model in a hidden `ThumbnailCapture` canvas, posts the captured
 * image to `/api/thumbnails`, and refreshes the route so the img tag
 * picks up the new `/api/thumbnails/{fileId}` redirect URL.
 *
 * This is the path that runs after a freshly uploaded file — the
 * user lands on /files/[slug] → this component quietly captures a
 * thumbnail in the background → the next render has one.
 */
export function FileThumbnailGenerator({
  fileId,
  fileAssetId,
  format,
}: FileThumbnailGeneratorProps) {
  const router = useRouter();
  const [captureModelUrl, setCaptureModelUrl] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!PREVIEWABLE.has(format)) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/craftcloud/download-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileAssetId }),
        });
        if (!res.ok) throw new Error(`download url failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setCaptureModelUrl(data.downloadUrl);
      } catch (err) {
        console.warn("[file-thumbnail] download url fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileAssetId, format]);

  const onCaptured = useCallback(
    async (id: string, dataUrl: string) => {
      try {
        const res = await fetch("/api/thumbnails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: id, dataUrl }),
        });
        if (!res.ok) {
          console.warn("[file-thumbnail] POST failed", await res.text());
          return;
        }
        router.refresh();
      } catch (err) {
        console.warn("[file-thumbnail] POST error", err);
      } finally {
        setCaptureModelUrl(null);
      }
    },
    [router]
  );

  if (!captureModelUrl) return null;

  return (
    <ThumbnailCapture
      modelUrl={captureModelUrl}
      format={format}
      fileId={fileId}
      onCapture={onCaptured}
    />
  );
}
