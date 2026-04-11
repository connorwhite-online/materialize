"use client";

import { useState, useCallback } from "react";
import { ThumbnailCapture } from "./thumbnail-capture";

interface FileThumbnailProps {
  fileId: string;
  thumbnailUrl: string | null;
  modelUrl?: string;
  format?: "stl" | "obj" | "3mf" | "step" | "amf";
  isOwner?: boolean;
  className?: string;
}

/**
 * Displays a file thumbnail. If no thumbnail exists and the owner is viewing,
 * renders the model offscreen with our shader, captures it, and uploads it.
 * After capture, shows the image — no more WebGL needed.
 */
export function FileThumbnail({
  fileId,
  thumbnailUrl,
  modelUrl,
  format,
  isOwner = false,
  className = "aspect-square",
}: FileThumbnailProps) {
  const [url, setUrl] = useState(thumbnailUrl);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(
    async (id: string, dataUrl: string) => {
      setCapturing(false);

      // Save to server
      try {
        const res = await fetch("/api/thumbnails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: id, dataUrl }),
        });
        if (res.ok) {
          const { thumbnailUrl: newUrl } = await res.json();
          setUrl(newUrl);
        }
      } catch {
        // Silently fail — thumbnail is nice-to-have
      }
    },
    []
  );

  // Has thumbnail — just show it
  if (url) {
    return (
      <div className={`${className} overflow-hidden rounded-lg bg-muted`}>
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  // No thumbnail, can capture (owner with model data)
  if (isOwner && modelUrl && format && !capturing) {
    return (
      <>
        <button
          onClick={() => setCapturing(true)}
          className={`${className} rounded-lg bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center cursor-pointer hover:from-muted/80 transition-colors`}
        >
          <span className="text-muted-foreground/40 text-xs">
            Click to generate preview
          </span>
        </button>
      </>
    );
  }

  // Capturing in progress
  if (capturing && modelUrl && format) {
    return (
      <>
        <div className={`${className} rounded-lg bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center`}>
          <div className="text-center">
            <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
            <span className="text-muted-foreground/40 text-[10px] mt-1 block">
              Generating...
            </span>
          </div>
        </div>
        <ThumbnailCapture
          modelUrl={modelUrl}
          format={format}
          fileId={fileId}
          onCapture={handleCapture}
        />
      </>
    );
  }

  // Fallback placeholder
  return (
    <div className={`${className} rounded-lg bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center`}>
      <span className="text-muted-foreground/30 text-xs">3D</span>
    </div>
  );
}
