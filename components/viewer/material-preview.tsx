"use client";

import { ModelViewer } from "./model-viewer";

interface MaterialPreviewProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  materialColor: string;
  className?: string;
}

export function MaterialPreview({
  modelUrl,
  format,
  materialColor,
  className,
}: MaterialPreviewProps) {
  return (
    <ModelViewer
      modelUrl={modelUrl}
      format={format}
      mode="material"
      materialColor={materialColor}
      className={className}
    />
  );
}
