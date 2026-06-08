"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ThumbnailCapture } from "@/components/viewer/thumbnail-capture";

interface FileThumbnailGeneratorProps {
  fileId: string;
  fileAssetId: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  recommendedMaterialId?: string | null;
}

const PREVIEWABLE = new Set(["stl", "obj", "3mf"]);

/**
 * Mounts on the file detail page for the owner when the file has no
 * cached thumbnail yet. Renders the model in a hidden `ThumbnailCapture`
 * canvas (loading bytes from our same-origin preview proxy), posts the
 * captured image to `/api/thumbnails`, and refreshes the route so the
 * img tag picks up the new `/api/thumbnails/{fileId}` redirect URL.
 *
 * This is the path that runs after a freshly uploaded file — the
 * user lands on /files/[slug] → this component quietly captures a
 * thumbnail in the background → the next render has one.
 */
export function FileThumbnailGenerator({
  fileId,
  fileAssetId,
  format,
  recommendedMaterialId,
}: FileThumbnailGeneratorProps) {
  const router = useRouter();
  const [done, setDone] = useState(false);

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
        setDone(true);
      }
    },
    [router]
  );

  if (done || !PREVIEWABLE.has(format)) return null;

  return (
    <ThumbnailCapture
      modelUrl={`/api/files/preview/${fileAssetId}`}
      format={format}
      fileId={fileId}
      onCapture={onCaptured}
      recommendedMaterialId={recommendedMaterialId}
    />
  );
}
