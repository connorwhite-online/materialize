"use client";

import { ModelViewer } from "./model-viewer";
import type { PreviewView } from "./preview-camera";

interface MaterialPreviewProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  materialColor: string;
  className?: string;
  enableWheelZoom?: boolean;
  showZoomControls?: boolean;
  /** Opt in to the in-frame "Update preview" control. See ModelViewer. */
  onCapturePreview?: (view: PreviewView) => void;
  capturePreviewStatus?: "idle" | "capturing" | "saved" | "error";
}

export function MaterialPreview({
  modelUrl,
  format,
  materialColor,
  className,
  enableWheelZoom,
  showZoomControls,
  onCapturePreview,
  capturePreviewStatus,
}: MaterialPreviewProps) {
  return (
    <ModelViewer
      modelUrl={modelUrl}
      format={format}
      mode="material"
      materialColor={materialColor}
      className={className}
      enableWheelZoom={enableWheelZoom}
      showZoomControls={showZoomControls}
      onCapturePreview={onCapturePreview}
      capturePreviewStatus={capturePreviewStatus}
    />
  );
}
