"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

interface FaceData {
  point: [number, number, number];
  normal: [number, number, number];
  extent: [number, number, number];
  positions: number[];
}

interface FaceAdjacency {
  normals: Float32Array; // per-triangle unit normal
  adj: number[][]; // per-triangle edge-adjacent triangle indices
}

/**
 * Build (and cache on the geometry) per-triangle normals + edge adjacency.
 * STL is non-indexed with float-noisy duplicate verts, so we weld by a
 * quantized position key before deriving shared-edge neighbors.
 */
function buildFaceAdjacency(geom: BufferGeometry): FaceAdjacency {
  const cached = geom.userData.__faceAdj as FaceAdjacency | undefined;
  if (cached) return cached;

  const pos = geom.attributes.position;
  const index = geom.index;
  const triCount = (index ? index.count : pos.count) / 3;
  const vi = (i: number) => (index ? index.getX(i) : i);

  if (!geom.boundingBox) geom.computeBoundingBox();
  const size = new Vector3();
  geom.boundingBox!.getSize(size);
  const q = (Math.max(size.x, size.y, size.z) || 1) * 1e-5;

  const v = new Vector3();
  const vid = new Map<string, number>();
  const canon = new Int32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, vi(t * 3 + k));
      const key = `${Math.round(v.x / q)},${Math.round(v.y / q)},${Math.round(
        v.z / q
      )}`;
      let id = vid.get(key);
      if (id === undefined) {
        id = vid.size;
        vid.set(key, id);
      }
      canon[t * 3 + k] = id;
    }
  }

  const edgeMap = new Map<string, number[]>();
  const eKey = (x: number, y: number) => (x < y ? `${x}_${y}` : `${y}_${x}`);
  for (let t = 0; t < triCount; t++) {
    const c0 = canon[t * 3];
    const c1 = canon[t * 3 + 1];
    const c2 = canon[t * 3 + 2];
    for (const [x, y] of [
      [c0, c1],
      [c1, c2],
      [c2, c0],
    ]) {
      const k = eKey(x, y);
      const arr = edgeMap.get(k);
      if (arr) arr.push(t);
      else edgeMap.set(k, [t]);
    }
  }

  const adj: number[][] = Array.from({ length: triCount }, () => []);
  for (const arr of edgeMap.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        adj[arr[i]].push(arr[j]);
        adj[arr[j]].push(arr[i]);
      }
    }
  }

  const normals = new Float32Array(triCount * 3);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const tn = new Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, vi(t * 3));
    b.fromBufferAttribute(pos, vi(t * 3 + 1));
    c.fromBufferAttribute(pos, vi(t * 3 + 2));
    tn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
    normals[t * 3] = tn.x;
    normals[t * 3 + 1] = tn.y;
    normals[t * 3 + 2] = tn.z;
  }

  const result: FaceAdjacency = { normals, adj };
  geom.userData.__faceAdj = result;
  return result;
}

/**
 * Select the single CONNECTED flat face containing the clicked triangle —
 * flood-fill through edge-adjacent neighbors whose normal stays within ~5° of
 * the seed. Unlike a global coplanar filter, this grabs only the face you
 * clicked (not other faces that happen to share its plane). Coordinates are
 * model-local (mm). Curved faces stop at their curvature; true face identity
 * needs STEP BRep topology (CON-182 v2).
 */
function selectConnectedFace(geom: BufferGeometry, faceIndex: number): FaceData {
  const { normals, adj } = buildFaceAdjacency(geom);
  const pos = geom.attributes.position;
  const index = geom.index;
  const vi = (i: number) => (index ? index.getX(i) : i);

  const sn = new Vector3(
    normals[faceIndex * 3],
    normals[faceIndex * 3 + 1],
    normals[faceIndex * 3 + 2]
  );
  const COS = Math.cos((5 * Math.PI) / 180);
  const seen = new Set<number>([faceIndex]);
  const stack = [faceIndex];
  const tris: number[] = [];
  const tn = new Vector3();
  while (stack.length) {
    const t = stack.pop()!;
    tris.push(t);
    for (const nb of adj[t]) {
      if (seen.has(nb)) continue;
      tn.set(normals[nb * 3], normals[nb * 3 + 1], normals[nb * 3 + 2]);
      if (tn.dot(sn) >= COS) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }

  const out: number[] = [];
  const v = new Vector3();
  const box = new Box3();
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, vi(t * 3 + k));
      out.push(v.x, v.y, v.z);
      box.expandByPoint(v);
      cx += v.x;
      cy += v.y;
      cz += v.z;
    }
  }
  const n = out.length / 3;
  const ext = new Vector3();
  box.getSize(ext);
  return {
    point: [cx / n, cy / n, cz / n],
    normal: [sn.x, sn.y, sn.z],
    extent: [ext.x, ext.y, ext.z],
    positions: out,
  };
}

/** Translucent overlay of a selected face's triangles (drawn on top). */
function FaceHighlight({
  positions,
  color = "#2563eb",
}: {
  positions: number[];
  color?: string;
}) {
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  return (
    <mesh geometry={geom} renderOrder={999}>
      <meshBasicMaterial
        color={color}
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
  /** Annotate mode is active — clicks select a face and open a note input. */
  annotateMode?: boolean;
  /** Toggle handler for the annotate tool button. */
  onToggleAnnotate?: () => void;
  /** Committed annotations to render as face highlights (model-space mm). */
  annotations?: ViewerAnnotation[];
  /** Fired when the user commits a note on a selected face (inline input). */
  onAnnotate?: (a: {
    point: [number, number, number];
    normal: [number, number, number];
    extent: [number, number, number];
    positions: number[];
    note: string;
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
  pendingFace,
  onPick,
  pinRadius,
}: {
  modelUrl: string;
  color?: string;
  planes: Plane[] | undefined;
  onBounds: (b: InspectBounds) => void;
  annotateMode?: boolean;
  annotations?: ViewerAnnotation[];
  pendingFace?: FaceData | null;
  onPick?: (pick: {
    face: FaceData;
    clientX: number;
    clientY: number;
  }) => void;
  pinRadius: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const done = useRef(false);

  // Select the single connected flat face under the cursor (model mm frame) and
  // report the click's screen position so the caller can open a note input
  // right where the user clicked.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!annotateMode || !onPick || e.faceIndex == null) return;
    e.stopPropagation();
    const mesh = e.object as THREE.Mesh;
    const geom = mesh.geometry as BufferGeometry;
    onPick({
      face: selectConnectedFace(geom, e.faceIndex),
      clientX: e.nativeEvent.clientX,
      clientY: e.nativeEvent.clientY,
    });
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
          (mm) coordinates land on the geometry regardless of Center/Stage. */}
      {(annotations ?? []).map((a) =>
        a.positions && a.positions.length > 0 ? (
          <FaceHighlight key={a.id} positions={a.positions} />
        ) : (
          <mesh key={a.id} position={a.point}>
            <sphereGeometry args={[pinRadius, 16, 16]} />
            <meshBasicMaterial color="#2563eb" toneMapped={false} />
          </mesh>
        )
      )}
      {/* Brighter preview of the face being annotated right now. */}
      {pendingFace && pendingFace.positions.length > 0 && (
        <FaceHighlight positions={pendingFace.positions} color="#f59e0b" />
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
  onAnnotate,
}: ModelViewerProps) {
  const isPreview = mode === "preview";
  // Wheel zoom defaults to true unless explicitly disabled. The
  // preview mode (auto-rotating thumbnail) has always disabled it.
  const wheelZoom =
    enableWheelZoom === undefined ? !isPreview : enableWheelZoom;
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The face just clicked, awaiting a note. `x`/`y` are screen coords relative
  // to the viewer wrapper, so the note input opens right where the user clicked.
  const [pending, setPending] = useState<{
    face: FaceData;
    x: number;
    y: number;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const openPending = (pick: {
    face: FaceData;
    clientX: number;
    clientY: number;
  }) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setNoteDraft("");
    setPending({
      face: pick.face,
      x: pick.clientX - (rect?.left ?? 0),
      y: pick.clientY - (rect?.top ?? 0),
    });
  };

  const commitPending = () => {
    if (pending) {
      onAnnotate?.({ ...pending.face, note: noteDraft.trim() });
    }
    setPending(null);
    setNoteDraft("");
  };

  // Drop the open input when annotate mode is turned off.
  useEffect(() => {
    if (!annotateMode) setPending(null);
  }, [annotateMode]);

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
      ref={wrapperRef}
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
                    pendingFace={pending?.face ?? null}
                    onPick={openPending}
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

          {/* Inline note input — opens right where the user clicked. */}
          {pending && (
            <div
              className="absolute z-40"
              style={{
                left: pending.x,
                top: pending.y,
                transform: "translate(-50%, 12px)",
              }}
            >
              <input
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitPending();
                  } else if (e.key === "Escape") {
                    setPending(null);
                    setNoteDraft("");
                  }
                }}
                onBlur={() => {
                  if (noteDraft.trim()) commitPending();
                  else {
                    setPending(null);
                    setNoteDraft("");
                  }
                }}
                placeholder="Describe this face…"
                className="w-56 rounded-lg border border-foreground/20 bg-card px-2.5 py-1.5 text-sm shadow-lg outline-none focus:border-foreground/40"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
