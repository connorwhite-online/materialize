"use client";

import { lazy, Suspense, useState, useRef, useEffect } from "react";

const ModelViewer = lazy(() =>
  import("./model-viewer").then((mod) => ({ default: mod.ModelViewer }))
);

interface ModelCardPreviewProps {
  modelUrl?: string;
  format?: "stl" | "obj" | "3mf" | "step" | "amf";
  thumbnailUrl?: string;
}

export function ModelCardPreview({
  modelUrl,
  format,
  thumbnailUrl,
}: ModelCardPreviewProps) {
  const [showViewer, setShowViewer] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Intersection observer to lazy-load
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // If we have a thumbnail, show that by default
  if (thumbnailUrl && !showViewer) {
    return (
      <div
        ref={ref}
        className="aspect-square rounded-md bg-foreground/5 overflow-hidden cursor-pointer"
        onMouseEnter={() => {
          if (isVisible && modelUrl && format) setShowViewer(true);
        }}
      >
        <img
          src={thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  // If we have a model URL and it's visible, show the 3D viewer
  if (modelUrl && format && isVisible) {
    return (
      <div
        ref={ref}
        className="aspect-square rounded-md bg-foreground/5 overflow-hidden"
        onMouseLeave={() => {
          if (thumbnailUrl) setShowViewer(false);
        }}
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
            </div>
          }
        >
          <ModelViewer
            modelUrl={modelUrl}
            format={format}
            mode="preview"
            className="h-full w-full"
          />
        </Suspense>
      </div>
    );
  }

  // Placeholder
  return (
    <div ref={ref} className="aspect-square rounded-md bg-foreground/5" />
  );
}
