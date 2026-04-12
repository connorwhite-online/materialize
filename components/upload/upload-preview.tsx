"use client";

import { Suspense, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Center, OrbitControls } from "@react-three/drei";
import { StlModel } from "@/components/viewer/loaders/stl-model";
import { ObjModel } from "@/components/viewer/loaders/obj-model";
import { ThreeMfModel } from "@/components/viewer/loaders/threemf-model";
import { LoadingPreview } from "@/components/viewer/loading-preview";

interface UploadPreviewProps {
  storageKey: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
}

/**
 * Shows the uploaded model rendered with our Materialize shader.
 * Fetches a presigned download URL on mount, then loads the model.
 * Shows the LoadingPreview while fetching/parsing.
 */
export function UploadPreview({ storageKey, format }: UploadPreviewProps) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/craftcloud/download-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        if (!cancelled) setDownloadUrl(data.downloadUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  if (error) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground">Preview unavailable</p>
      </div>
    );
  }

  if (!downloadUrl) {
    return <LoadingPreview />;
  }

  const supported = format === "stl" || format === "obj" || format === "3mf";

  if (!supported) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground">
          Preview not supported for .{format}
        </p>
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: [0, 0, 4.5], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1.0} />
      <directionalLight position={[-5, -3, -5]} intensity={0.4} />
      <Suspense fallback={null}>
        <Center>
          {format === "stl" && <StlModel url={downloadUrl} />}
          {format === "obj" && <ObjModel url={downloadUrl} />}
          {format === "3mf" && <ThreeMfModel url={downloadUrl} />}
        </Center>
      </Suspense>
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={1.5}
      />
    </Canvas>
  );
}
