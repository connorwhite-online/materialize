"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stage, Center, Grid } from "@react-three/drei";
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Plane,
  Vector3,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type * as THREE from "three";
import { type ThreeEvent } from "@react-three/fiber";
import {
  Grid3x3Icon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  RulerIcon,
  ScissorsIcon,
} from "lucide-react";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** A selected flat face, in the model's own (mm) coordinate frame. */
export interface ViewerAnnotation {
  id: string;
  /** Face centroid (mm). */
  point: [number, number, number];
  normal: [number, number, number];
  /** Bounding-box size of the selected face (mm). */
  extent?: [number, number, number];
  /** Flat triangle coords (mm) of the selected face, for the highlight overlay. */
  positions?: number[];
}

/**
 * Grow a flat face from a picked triangle: every triangle that faces the same
 * way (within ~10°) and lies on the same plane. Crude vs true BRep topology,
 * but it gives a Fusion-style "select this flat face" on a raw STL with no
 * backend. Curved faces select only their near-coplanar band — a known limit
 * until STEP face IDs (CON-182 v2). Coordinates are model-local (mm).
 */
function selectFlatFace(
  geom: BufferGeometry,
  pickedNormal: Vector3,
  pickedPoint: Vector3
): {
  point: [number, number, number];
  normal: [number, number, number];
  extent: [number, number, number];
  positions: number[];
} {
  const pos = geom.attributes.position;
  const index = geom.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vertAt = (i: number, out: Vector3) =>
    out.fromBufferAttribute(pos, index ? index.getX(i) : i);

  const N = pickedNormal.clone().normalize();
  const planeD = N.dot(pickedPoint);
  if (!geom.boundingBox) geom.computeBoundingBox();
  const size = new Vector3();
  geom.boundingBox!.getSize(size);
  const planeTol = (Math.max(size.x, size.y, size.z) || 1) * 0.01;

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const tn = new Vector3();
  const out: number[] = [];

  for (let t = 0; t < triCount; t++) {
    vertAt(t * 3, a);
    vertAt(t * 3 + 1, b);
    vertAt(t * 3 + 2, c);
    tn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
    if (tn.dot(N) < 0.985) continue; // not co-facing (~10°)
    if (Math.abs(N.dot(a) - planeD) > planeTol) continue; // not coplanar
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  if (out.length === 0) {
    return {
      point: [pickedPoint.x, pickedPoint.y, pickedPoint.z],
      normal: [N.x, N.y, N.z],
      extent: [0, 0, 0],
      positions: [],
    };
  }

  const box = new Box3();
  const v = new Vector3();
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < out.length; i += 3) {
    box.expandByPoint(v.set(out[i], out[i + 1], out[i + 2]));
    cx += out[i];
    cy += out[i + 1];
    cz += out[i + 2];
  }
  const n = out.length / 3;
  const ext = new Vector3();
  box.getSize(ext);
  return {
    point: [cx / n, cy / n, cz / n],
    normal: [N.x, N.y, N.z],
    extent: [ext.x, ext.y, ext.z],
    positions: out,
  };
}

/** Translucent overlay of a selected face's triangles (drawn on top). */
function FaceHighlight({ positions }: { positions: number[] }) {
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  return (
    <mesh geometry={geom} renderOrder={999}>
      <meshBasicMaterial
        color="#2563eb"
        transparent
        opacity={0.4}
        side={DoubleSide}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

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
  /** Annotation pin mode is active — clicks on the model drop a pin. */
  annotateMode?: boolean;
  /** Toggle handler for the annotate tool button. */
  onToggleAnnotate?: () => void;
  /** Existing annotations to render as face highlights (model-space mm). */
  annotations?: ViewerAnnotation[];
  /** Fired when the user selects a face in annotate mode. */
  onPick?: (pick: {
    point: [number, number, number];
    normal: [number, number, number];
    extent: [number, number, number];
    positions: number[];
  }) => void;
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
  annotateMode,
  annotations,
  onPick,
  pinRadius,
}: {
  modelUrl: string;
  color?: string;
  planes: Plane[] | undefined;
  onBounds: (b: InspectBounds) => void;
  annotateMode?: boolean;
  annotations?: ViewerAnnotation[];
  onPick?: (pick: {
    point: [number, number, number];
    normal: [number, number, number];
    extent: [number, number, number];
    positions: number[];
  }) => void;
  pinRadius: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const done = useRef(false);

  // Select the flat face under the cursor, in the model's own (mm) frame —
  // worldToLocal unwinds the Center/Stage transforms so the face matches the
  // build123d source coordinates the agent reasons about.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!annotateMode || !onPick) return;
    e.stopPropagation();
    const mesh = e.object as THREE.Mesh;
    const geom = mesh.geometry as BufferGeometry;
    const local = mesh.worldToLocal(e.point.clone());
    const faceNormal = e.face?.normal?.clone() ?? new Vector3(0, 1, 0);
    onPick(selectFlatFace(geom, faceNormal, local));
  };

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
    <group ref={groupRef} onClick={annotateMode ? handleClick : undefined}>
      <StlModel
        url={modelUrl}
        color={color}
        clippingPlanes={planes}
        onGeometry={(g) => {
          geomRef.current = g;
        }}
      />
      {/* Selected-face highlights — children of the same group so model-space
          (mm) coordinates land on the geometry regardless of Center/Stage. A
          tiny pin marks the centroid; the overlay shows the whole face. */}
      {(annotations ?? []).map((a) =>
        a.positions && a.positions.length > 0 ? (
          <group key={a.id}>
            <FaceHighlight positions={a.positions} />
            <mesh position={a.point}>
              <sphereGeometry args={[pinRadius, 16, 16]} />
              <meshBasicMaterial color="#1e40af" toneMapped={false} />
            </mesh>
          </group>
        ) : (
          <mesh key={a.id} position={a.point}>
            <sphereGeometry args={[pinRadius, 16, 16]} />
            <meshBasicMaterial color="#2563eb" toneMapped={false} />
          </mesh>
        )
      )}
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
  annotateMode = false,
  onToggleAnnotate,
  annotations,
  onPick,
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
  // Stable array identity (only flips when the section toggles) so the
  // material isn't rebuilt every frame as the slider moves.
  const planes = useMemo(
    () => (inspectable && sectionOn ? [plane] : undefined),
    [inspectable, sectionOn, plane]
  );

  // Pin radius scaled to the model so it reads on a 10mm part and a 200mm one.
  // Small — it marks a point, not a blob.
  const pinRadius = bounds
    ? Math.max(bounds.mm.x, bounds.mm.y, bounds.mm.z) / 130
    : 1;

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
    <div
      className={`relative ${className || "h-full w-full"} ${
        inspectable && annotateMode ? "cursor-crosshair" : ""
      }`}
    >
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
                    annotateMode={annotateMode}
                    annotations={annotations}
                    onPick={onPick}
                    pinRadius={pinRadius}
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
            {onToggleAnnotate && (
              <>
                <div className="h-4 w-px bg-border/60" />
                <button
                  type="button"
                  onClick={onToggleAnnotate}
                  aria-label="Annotate"
                  aria-pressed={annotateMode}
                  title="Annotate — click the model to drop a pin"
                  className={`flex h-8 w-8 items-center justify-center transition-colors hover:bg-foreground/5 ${
                    annotateMode ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <MousePointer2Icon className="size-4" />
                </button>
              </>
            )}
          </div>

          {/* Cross-section slider — vertical, like a slicer's height handle:
              handle at the TOP = whole model; drag it DOWN to lower the cut
              and expose the interior from the top. (Horizontal range rotated
              -90°, so its max ends up at the top; value = 1 - cut depth.) */}
          {sectionOn && (
            <div className="absolute right-3 top-1/2 flex h-40 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/40 backdrop-blur-md">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={1 - sectionT}
                onChange={(e) => setSectionT(1 - Number(e.target.value))}
                aria-label="Cross-section height"
                className="w-32 -rotate-90 cursor-pointer accent-foreground"
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
