"use client";

import { MaterialPreview } from "@/components/viewer/material-preview";
import type { PreviewView } from "@/components/viewer/preview-camera";

interface OrderModelPreviewProps {
  fileAssetId: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  materialColor: string;
  /**
   * Opt in to the in-frame "Update preview" control. Passed only by the
   * file-detail page, and only for the file's owner — see
   * `components/files/file-preview.tsx`.
   */
  onCapturePreview?: (view: PreviewView) => void;
  capturePreviewStatus?: "idle" | "capturing" | "saved" | "error";
}

const PREVIEWABLE = new Set(["stl", "obj", "3mf"]);

/**
 * Renders the file-detail / order 3D preview by pointing the loader
 * at our same-origin proxy route, which streams the model bytes from
 * R2 server-side.
 *
 * We used to round-trip through `/api/craftcloud/download-url` to get
 * a signed R2 URL and hand that to the loader directly — but that
 * makes the client do a cross-origin fetch to R2 and falls over the
 * moment the bucket's CORS rules don't include the current origin
 * (which is every preview deploy and the production domain after a
 * domain change). The proxy moves the R2 read server-side, where
 * CORS doesn't apply.
 */
export function OrderModelPreview({
  fileAssetId,
  format,
  materialColor,
  onCapturePreview,
  capturePreviewStatus,
}: OrderModelPreviewProps) {
  if (!PREVIEWABLE.has(format)) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        Preview not supported for .{format}
      </div>
    );
  }

  const modelUrl = `/api/files/preview/${fileAssetId}`;

  return (
    <MaterialPreview
      modelUrl={modelUrl}
      format={format}
      materialColor={materialColor}
      className="h-full w-full"
      enableWheelZoom={false}
      showZoomControls
      onCapturePreview={onCapturePreview}
      capturePreviewStatus={capturePreviewStatus}
    />
  );
}
