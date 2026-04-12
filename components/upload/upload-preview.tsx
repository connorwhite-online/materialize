"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import { StlModel } from "@/components/viewer/loaders/stl-model";
import { ObjModel } from "@/components/viewer/loaders/obj-model";
import { ThreeMfModel } from "@/components/viewer/loaders/threemf-model";
import { LoadingPreview } from "@/components/viewer/loading-preview";

interface UploadPreviewProps {
  storageKey: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  onDimensionsComputed?: (dims: [number, number, number]) => void;
}

/**
 * Measures the union bounding box of all loaded mesh geometries and
 * applies a center offset + uniform scale so every model fills roughly
 * the same volume in world space, regardless of the file's native units
 * (mm, inches, arbitrary). Also reports raw dimensions upward.
 *
 * TARGET_WORLD_SIZE is the world-space length that the model's largest
 * dimension maps to. Paired with the camera (Z=4.5, fov=40) it puts the
 * model at a comfortable framing with a little breathing room.
 */
const TARGET_WORLD_SIZE = 2.4;

function NormalizedModel({
  onDimensions,
  children,
}: {
  onDimensions?: (dims: [number, number, number]) => void;
  children: React.ReactNode;
}) {
  const innerRef = useRef<THREE.Group>(null);
  const [transform, setTransform] = useState<{
    scale: number;
    offset: [number, number, number];
    ready: boolean;
  }>({ scale: 1, offset: [0, 0, 0], ready: false });

  useEffect(() => {
    if (!innerRef.current) return;

    let rafId = 0;
    let attempts = 0;

    // Retry across a few frames in case the loader's geometries haven't
    // been fully attached to the three.js tree yet when the effect fires.
    const measure = () => {
      const group = innerRef.current;
      if (!group) return;

      const box = new THREE.Box3();
      let hasGeom = false;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          if (bb && bb.isEmpty() === false) {
            box.union(bb);
            hasGeom = true;
          }
        }
      });

      if (!hasGeom || box.isEmpty()) {
        if (attempts++ < 10) {
          rafId = requestAnimationFrame(measure);
        }
        return;
      }

      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? TARGET_WORLD_SIZE / maxDim : 1;

      setTransform({
        scale,
        offset: [-center.x, -center.y, -center.z],
        ready: true,
      });

      if (onDimensions) {
        onDimensions([size.x, size.y, size.z]);
      }
    };

    measure();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
    // Runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group scale={transform.scale} visible={transform.ready}>
      <group position={transform.offset} ref={innerRef}>
        {children}
      </group>
    </group>
  );
}

export function UploadPreview({
  storageKey,
  format,
  onDimensionsComputed,
}: UploadPreviewProps) {
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

  // Neutral gray — let the warm lighting carry the temperature
  // instead of tinting the albedo.
  const modelColor = "#888888";

  return (
    <Canvas
      camera={{ position: [0, 0, 4.5], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      {/* Three-point lighting, all subtly warm — ~3800K, just a hint
          of warmth rather than a full tungsten cast. */}
      <ambientLight intensity={0.16} color="#fff3e3" />
      <directionalLight position={[5, 6, 5]} intensity={1.4} color="#ffeed6" />
      <directionalLight position={[-6, -1, -3]} intensity={0.35} color="#fff2e0" />
      <directionalLight position={[0, 2, -6]} intensity={0.75} color="#ffefd8" />

      {/* Studio IBL — neutral softbox, isolated in its own Suspense so
          it doesn't block the mesh. */}
      <Suspense fallback={null}>
        <Environment preset="studio" />
      </Suspense>

      <Suspense fallback={null}>
        <NormalizedModel onDimensions={onDimensionsComputed}>
          {format === "stl" && (
            <StlModel
              url={downloadUrl}
              color={modelColor}
              useCustomShader={false}
            />
          )}
          {format === "obj" && (
            <ObjModel
              url={downloadUrl}
              color={modelColor}
              useCustomShader={false}
            />
          )}
          {format === "3mf" && (
            <ThreeMfModel
              url={downloadUrl}
              color={modelColor}
              useCustomShader={false}
            />
          )}
        </NormalizedModel>
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
