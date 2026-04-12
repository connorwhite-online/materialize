"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, Center } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type * as THREE from "three";
import { MinusIcon, PlusIcon } from "lucide-react";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";

interface ModelViewerProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  mode?: "preview" | "detail" | "material";
  materialColor?: string;
  className?: string;
  /**
   * Toggle scroll-wheel + pinch zoom on the orbit controls. When the
   * model is auto-normalized to a target volume, wheel zoom mostly
   * just makes the camera fight the user. Defaults to enabled for
   * backwards compatibility with existing call sites.
   */
  enableWheelZoom?: boolean;
  /**
   * Render +/- zoom buttons in the bottom-left of the canvas. Useful
   * when wheel zoom is disabled but the user still needs a way to
   * dolly in and out.
   */
  showZoomControls?: boolean;
}

function ModelMesh({
  modelUrl,
  format,
  materialColor,
}: {
  modelUrl: string;
  format: string;
  materialColor?: string;
}) {
  const color = materialColor || "#a0a0a0";

  switch (format) {
    case "stl":
      return <StlModel url={modelUrl} color={color} />;
    case "obj":
      return <ObjModel url={modelUrl} color={color} />;
    case "3mf":
      return <ThreeMfModel url={modelUrl} color={color} />;
    default:
      // STEP and AMF are not natively supported by Three.js loaders
      // Show a placeholder for unsupported formats
      return (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
  }
}

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  );
}

export function ModelViewer({
  modelUrl,
  format,
  mode = "detail",
  materialColor,
  className,
  enableWheelZoom,
  showZoomControls = false,
}: ModelViewerProps) {
  const isPreview = mode === "preview";
  // Wheel zoom defaults to true unless explicitly disabled. The
  // preview mode (auto-rotating thumbnail) has always disabled it.
  const wheelZoom =
    enableWheelZoom === undefined ? !isPreview : enableWheelZoom;
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const zoomBy = (factor: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object as THREE.PerspectiveCamera;
    const target = controls.target;
    const offset = camera.position.clone().sub(target);
    const dist = offset.length();
    if (dist === 0) return;
    const min = controls.minDistance ?? 0.5;
    const max = controls.maxDistance ?? Infinity;
    const newDist = Math.min(Math.max(dist * factor, min), max);
    offset.setLength(newDist);
    camera.position.copy(target).add(offset);
    controls.update();
  };

  return (
    <div className={`relative ${className || "h-full w-full"}`}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        dpr={isPreview ? 1 : [1, 2]}
      >
        <Suspense fallback={<LoadingFallback />}>
          <Stage
            adjustCamera={1.2}
            intensity={0.5}
            environment="city"
          >
            <Center>
              <ModelMesh
                modelUrl={modelUrl}
                format={format}
                materialColor={materialColor}
              />
            </Center>
          </Stage>
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          enableZoom={wheelZoom}
          enablePan={!isPreview}
          autoRotate={isPreview}
          autoRotateSpeed={2}
        />
      </Canvas>
      {showZoomControls && (
        <div className="absolute bottom-3 left-3 flex items-center gap-0 overflow-hidden rounded-full border border-border/60 bg-background/40 backdrop-blur-md">
          <button
            type="button"
            onClick={() => zoomBy(0.85)}
            aria-label="Zoom in"
            className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <PlusIcon className="size-4" />
          </button>
          <div className="h-4 w-px bg-border/60" />
          <button
            type="button"
            onClick={() => zoomBy(1.18)}
            aria-label="Zoom out"
            className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <MinusIcon className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
