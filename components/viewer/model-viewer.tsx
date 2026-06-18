"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stage, Center, Grid } from "@react-three/drei";
import { Box3, Plane, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type * as THREE from "three";
import {
  Grid3x3Icon,
  MinusIcon,
  PlusIcon,
  RulerIcon,
  ScissorsIcon,
} from "lucide-react";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";
import { ErrorBoundary } from "@/components/ui/error-boundary";

function PreviewUnavailable() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/20">
      <p className="text-xs text-muted-foreground">Preview unavailable</p>
    </div>
  );
}

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
  /**
   * Enable the inspection toolbar (grid, cross-section slider, dimensions
   * readout). Opt-in — only the text-to-CAD studio turns this on, so every
   * other call site is unchanged. STL only.
   */
  inspect?: boolean;
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

/** Bounds measured from the loaded+placed model, in world units + true mm. */
interface InspectBounds {
  /** True model size in millimeters (from geometry, transform-independent). */
  mm: { x: number; y: number; z: number };
  /** World-space vertical extent (for the cross-section plane). */
  worldMinY: number;
  worldMaxY: number;
  /** World-space footprint center + size (for placing the grid). */
  center: [number, number, number];
  footprint: { x: number; z: number };
  /** world units per mm (so the grid can use true mm spacing). */
  scale: number;
}

/**
 * Renders the STL and measures its world + mm bounds once loaded. The world
 * box is read after transforms (Center/Stage) are applied, so the cross-section
 * plane and grid land correctly regardless of how the model was placed/scaled.
 */
function InspectModel({
  modelUrl,
  color,
  planes,
  onBounds,
}: {
  modelUrl: string;
  color?: string;
  planes: Plane[] | undefined;
  onBounds: (b: InspectBounds) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const done = useRef(false);

  useFrame(() => {
    if (done.current || !groupRef.current || !geomRef.current) return;
    const group = groupRef.current;
    group.updateWorldMatrix(true, true);
    const world = new Box3().setFromObject(group);
    if (!isFinite(world.min.y) || world.isEmpty()) return;

    const geom = geomRef.current;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const gb = geom.boundingBox!;
    const mm = new Vector3();
    gb.getSize(mm);
    const worldSize = new Vector3();
    world.getSize(worldSize);
    const scale = mm.x > 0 ? worldSize.x / mm.x : 1;

    onBounds({
      mm: { x: mm.x, y: mm.y, z: mm.z },
      worldMinY: world.min.y,
      worldMaxY: world.max.y,
      center: [
        (world.min.x + world.max.x) / 2,
        world.min.y,
        (world.min.z + world.max.z) / 2,
      ],
      footprint: { x: worldSize.x, z: worldSize.z },
      scale,
    });
    done.current = true;
  });

  return (
    <group ref={groupRef}>
      <StlModel
        url={modelUrl}
        color={color}
        clippingPlanes={planes}
        onGeometry={(g) => {
          geomRef.current = g;
        }}
      />
    </group>
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
  inspect = false,
}: ModelViewerProps) {
  const isPreview = mode === "preview";
  // Wheel zoom defaults to true unless explicitly disabled. The
  // preview mode (auto-rotating thumbnail) has always disabled it.
  const wheelZoom =
    enableWheelZoom === undefined ? !isPreview : enableWheelZoom;
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Inspection state (only meaningful when `inspect`). STL only.
  const inspectable = inspect && format === "stl";
  const [showGrid, setShowGrid] = useState(false);
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionT, setSectionT] = useState(0); // 0 = nothing cut, 1 = all cut
  const [bounds, setBounds] = useState<InspectBounds | null>(null);

  // A single horizontal cross-section plane. normal (0,-1,0) keeps geometry
  // below the cut height (constant), so raising `t` lowers the cut and exposes
  // more interior from the top down. Mutated in place; the always-on frameloop
  // picks up the change next frame.
  const plane = useMemo(() => new Plane(new Vector3(0, -1, 0), 0), []);
  if (bounds) {
    plane.constant =
      bounds.worldMaxY - sectionT * (bounds.worldMaxY - bounds.worldMinY);
  }
  const planes = inspectable && sectionOn ? [plane] : undefined;

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
      <ErrorBoundary fallback={<PreviewUnavailable />}>
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          dpr={isPreview ? 1 : [1, 2]}
          // Local clipping is needed for the cross-section tool; harmless
          // (no-op) everywhere else since no material sets clippingPlanes.
          gl={{ localClippingEnabled: true }}
        >
          <Suspense fallback={<LoadingFallback />}>
            <Stage
              adjustCamera={1.2}
              intensity={0.5}
              // No IBL environment: drei's "city" preset fetches an HDR
              // from an external CDN (raw.githack.com) that drops CORS
              // headers, spamming the console and failing intermittently.
              // Stage still provides its three-point light rig (ambient +
              // spot + point), which is plenty for matte print previews.
              environment={null}
            >
              <Center>
                {inspectable ? (
                  <InspectModel
                    modelUrl={modelUrl}
                    color={materialColor}
                    planes={planes}
                    onBounds={setBounds}
                  />
                ) : (
                  <ModelMesh
                    modelUrl={modelUrl}
                    format={format}
                    materialColor={materialColor}
                  />
                )}
              </Center>
            </Stage>
            {inspectable && showGrid && bounds && (
              <Grid
                // Drop the grid a hair below the model base so it doesn't
                // z-fight with a flat bottom face.
                position={[
                  bounds.center[0],
                  bounds.worldMinY - 0.5 * bounds.scale,
                  bounds.center[2],
                ]}
                args={[bounds.footprint.x * 3, bounds.footprint.z * 3]}
                cellSize={10 * bounds.scale}
                sectionSize={50 * bounds.scale}
                cellThickness={0.6}
                sectionThickness={1}
                cellColor="#9aa0a6"
                sectionColor="#6b7280"
                fadeDistance={bounds.footprint.x * 12}
                fadeStrength={1}
                followCamera={false}
                infiniteGrid={false}
              />
            )}
          </Suspense>
          <OrbitControls
            ref={controlsRef}
            enableZoom={wheelZoom}
            enablePan={!isPreview}
            autoRotate={isPreview}
            autoRotateSpeed={2}
          />
        </Canvas>
      </ErrorBoundary>

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

      {inspectable && (
        <>
          {/* Inspection toolbar */}
          <div className="absolute right-3 top-3 flex items-center gap-0 overflow-hidden rounded-full border border-border/60 bg-background/40 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              aria-label="Toggle grid"
              aria-pressed={showGrid}
              title="Grid (10mm)"
              className={`flex h-8 w-8 items-center justify-center transition-colors hover:bg-foreground/5 ${
                showGrid ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <Grid3x3Icon className="size-4" />
            </button>
            <div className="h-4 w-px bg-border/60" />
            <button
              type="button"
              onClick={() => setSectionOn((v) => !v)}
              aria-label="Toggle cross-section"
              aria-pressed={sectionOn}
              title="Cross-section"
              className={`flex h-8 w-8 items-center justify-center transition-colors hover:bg-foreground/5 ${
                sectionOn ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <ScissorsIcon className="size-4" />
            </button>
          </div>

          {/* Cross-section slider — horizontal: left = whole model, right =
              fully cut (sweeps the cut down from the top). */}
          {sectionOn && (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-background/40 px-3 py-1.5 backdrop-blur-md">
              <ScissorsIcon className="size-3.5 text-muted-foreground" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sectionT}
                onChange={(e) => setSectionT(Number(e.target.value))}
                aria-label="Cross-section depth"
                className="h-1.5 w-40 cursor-pointer accent-foreground"
              />
            </div>
          )}

          {/* Grid cell-size legend (per-line numeric ticks are a follow-up). */}
          {showGrid && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[11px] tabular-nums text-muted-foreground backdrop-blur-md">
              grid: 10 mm
            </div>
          )}

          {/* Dimensions readout (true mm) */}
          {bounds && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[11px] tabular-nums text-muted-foreground backdrop-blur-md">
              <RulerIcon className="size-3.5" />
              {bounds.mm.x.toFixed(1)} × {bounds.mm.y.toFixed(1)} ×{" "}
              {bounds.mm.z.toFixed(1)} mm
            </div>
          )}
        </>
      )}
    </div>
  );
}
