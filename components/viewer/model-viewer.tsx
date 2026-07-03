"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Stage, Center, Grid, Line } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  STUDIO_CAMERA,
  frameTransformFor,
  frameTransformForAll,
} from "@/components/cad/studio-frame";
import { PointCloudScene } from "@/components/cad/materializing-blob";
import {
  AlwaysStencilFunc,
  BackSide,
  Box3,
  BufferGeometry,
  DecrementWrapStencilOp,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FrontSide,
  IncrementWrapStencilOp,
  Line3,
  NotEqualStencilFunc,
  Plane,
  ReplaceStencilOp,
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
import {
  buildFaceAdjacency,
  selectSmoothRegion,
  type FaceAdjacency,
} from "./mesh-selection";

type Vec3 = [number, number, number];

/** A selected face or edge, in the model's own (mm) coordinate frame. */
export type PickResult =
  | {
      kind: "face";
      /** Face centroid (mm). */
      point: Vec3;
      normal: Vec3;
      /** Bounding-box size of the face (mm). */
      extent: Vec3;
      /** Flat triangle coords (mm) for the highlight overlay. */
      positions: number[];
    }
  | {
      kind: "edge";
      /** Edge midpoint (mm). */
      point: Vec3;
      /** Edge endpoints (mm) + length. */
      edge: { a: Vec3; b: Vec3; length: number };
    };

export type ViewerAnnotation = { id: string } & PickResult;

interface FaceData {
  point: Vec3;
  normal: Vec3;
  extent: Vec3;
  positions: number[];
}

/**
 * Adjacency for `geom`, cached on the geometry (built once per model, reused
 * across picks). The build itself is pure — see mesh-selection.ts.
 */
function getFaceAdjacency(geom: BufferGeometry): FaceAdjacency {
  const cached = geom.userData.__faceAdj as FaceAdjacency | undefined;
  if (cached) return cached;
  const result = buildFaceAdjacency(
    geom.attributes.position.array as ArrayLike<number>,
    geom.index ? (geom.index.array as ArrayLike<number>) : null
  );
  geom.userData.__faceAdj = result;
  return result;
}

/**
 * Select the CONNECTED optical face containing the clicked triangle —
 * flood-fill through edge-adjacent neighbors bounded by feature edges and
 * neighbor-to-neighbor smoothness (mesh-selection.ts). Curved surfaces are
 * walked in full (a cylinder barrel is one face); flat faces still stop at
 * chamfers/corners. Coordinates are model-local (mm). Exact face identity
 * still needs STEP BRep topology (Phase 2, CON-182 v2). The reported normal
 * is the clicked (seed) triangle's — a region-wide normal is meaningless on
 * a curved face.
 */
function selectConnectedFace(geom: BufferGeometry, faceIndex: number): FaceData {
  const adjacency = getFaceAdjacency(geom);
  const pos = geom.attributes.position;
  const index = geom.index;
  const vi = (i: number) => (index ? index.getX(i) : i);

  const sn = new Vector3(
    adjacency.normals[faceIndex * 3],
    adjacency.normals[faceIndex * 3 + 1],
    adjacency.normals[faceIndex * 3 + 2]
  );
  const { triangles: tris } = selectSmoothRegion(adjacency, faceIndex);

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

/** Feature edges (sharp dihedral angles) of the model, cached on the geometry. */
function getFeatureEdges(geom: BufferGeometry): EdgesGeometry {
  let eg = geom.userData.__edgesGeom as EdgesGeometry | undefined;
  if (!eg) {
    // 25° threshold → real CAD edges, not tessellation seams on curved faces.
    eg = new EdgesGeometry(geom, 25);
    geom.userData.__edgesGeom = eg;
  }
  return eg;
}

/** Nearest feature edge segment to a model-space point (null if none close). */
function selectNearestEdge(
  geom: BufferGeometry,
  point: Vector3
): Extract<PickResult, { kind: "edge" }> | null {
  const eg = getFeatureEdges(geom);
  const pos = eg.attributes.position;
  const segCount = pos.count / 2;
  if (segCount === 0) return null;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const size = new Vector3();
  geom.boundingBox!.getSize(size);
  const thr = (Math.max(size.x, size.y, size.z) || 1) * 0.06;

  const A = new Vector3();
  const B = new Vector3();
  const line = new Line3();
  const closest = new Vector3();
  let best = Infinity;
  let bi = -1;
  for (let s = 0; s < segCount; s++) {
    A.fromBufferAttribute(pos, s * 2);
    B.fromBufferAttribute(pos, s * 2 + 1);
    line.set(A, B);
    line.closestPointToPoint(point, true, closest);
    const d = closest.distanceTo(point);
    if (d < best) {
      best = d;
      bi = s;
    }
  }
  if (bi < 0 || best > thr) return null;
  A.fromBufferAttribute(pos, bi * 2);
  B.fromBufferAttribute(pos, bi * 2 + 1);
  return {
    kind: "edge",
    point: [(A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2],
    edge: {
      a: [A.x, A.y, A.z],
      b: [B.x, B.y, B.z],
      length: A.distanceTo(B),
    },
  };
}

/** Bright overlay of a selected edge (fat line, on top). */
function EdgeHighlight({
  a,
  b,
  color = "#2563eb",
}: {
  a: Vec3;
  b: Vec3;
  color?: string;
}) {
  return (
    <Line points={[a, b]} color={color} lineWidth={4} depthTest={false} />
  );
}

/** Faint guide showing all selectable feature edges (edge mode only). */
function FeatureEdges({ geom }: { geom: BufferGeometry }) {
  const eg = useMemo(() => getFeatureEdges(geom), [geom]);
  return (
    <lineSegments geometry={eg}>
      <lineBasicMaterial color="#64748b" transparent opacity={0.55} />
    </lineSegments>
  );
}

/**
 * Writes the model's cross-section footprint into the stencil buffer (back
 * faces increment, front faces decrement → non-zero exactly where the cut
 * passes through solid material). Renders no color/depth; a cap quad drawn
 * afterward (where stencil != 0) fills the section so a solid reads as solid
 * and a shell reads as its wall band. Lives in the model's transformed group
 * so it lines up with the clipped mesh. (three.js webgl_clipping_stencil.)
 */
function SectionStencil({
  geom,
  planes,
}: {
  geom: BufferGeometry;
  planes: Plane[];
}) {
  return (
    <group>
      <mesh geometry={geom} renderOrder={1}>
        <meshBasicMaterial
          depthWrite={false}
          depthTest={false}
          colorWrite={false}
          side={BackSide}
          clippingPlanes={planes}
          stencilWrite
          stencilFunc={AlwaysStencilFunc}
          stencilFail={IncrementWrapStencilOp}
          stencilZFail={IncrementWrapStencilOp}
          stencilZPass={IncrementWrapStencilOp}
        />
      </mesh>
      <mesh geometry={geom} renderOrder={1}>
        <meshBasicMaterial
          depthWrite={false}
          depthTest={false}
          colorWrite={false}
          side={FrontSide}
          clippingPlanes={planes}
          stencilWrite
          stencilFunc={AlwaysStencilFunc}
          stencilFail={DecrementWrapStencilOp}
          stencilZFail={DecrementWrapStencilOp}
          stencilZPass={DecrementWrapStencilOp}
        />
      </mesh>
    </group>
  );
}

/**
 * The filled cross-section cap — a quad at the cut plane (world space), drawn
 * only where SectionStencil marked solid, then resetting the stencil. Unlit
 * basic material (the scene has no real lights for a lit one).
 */
function SectionCap({
  center,
  cutY,
  size,
}: {
  center: [number, number, number];
  cutY: number;
  size: number;
}) {
  return (
    <mesh
      position={[center[0], cutY, center[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        color="#9ca3af"
        side={DoubleSide}
        toneMapped={false}
        stencilWrite
        stencilRef={0}
        stencilFunc={NotEqualStencilFunc}
        stencilFail={ReplaceStencilOp}
        stencilZFail={ReplaceStencilOp}
        stencilZPass={ReplaceStencilOp}
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
  /** Committed annotations to render as highlights (model-space mm). */
  annotations?: ViewerAnnotation[];
  /** Fired when the user commits a note on a selected face/edge. */
  onAnnotate?: (a: PickResult & { note: string }) => void;
  /**
   * Studio-only fixed framing: replace `<Stage adjustCamera>` (which fits each
   * model differently and animates the camera on mount) with a fixed camera +
   * deterministic normalization, so this viewer lines up pixel-for-pixel with
   * the studio's deforming-loader canvas and the morph hand-off has no
   * reload/zoom pop. Inspect-only; default off (every other call site unchanged).
   */
  fixedFrame?: boolean;
  /**
   * Studio compare overlay: a second STL rendered translucent (~35%) in the
   * same fixed frame as the primary model, so two versions of a design can
   * be eyeballed in one view. Only honored with `fixedFrame` (the shared
   * deterministic framing is what makes the overlay line up).
   */
  ghostUrl?: string;
  /**
   * Multi-part assembly (MTR-174): render every part in its native assembly
   * coordinates inside ONE shared frame (union bounding box). Isolation is
   * pure visibility — hiding parts never recenters the rest. Honored only
   * with `fixedFrame` + `inspect`; takes precedence over `modelUrl`.
   */
  assemblyParts?: { url: string; name: string; visible: boolean }[];
}

/**
 * Wrap the model in a group scaled+centered so its longest axis fits the shared
 * studio target size. Computed synchronously from the (loader-cached) geometry
 * so the very first rendered frame is already correctly framed — no unscaled
 * flash. The geometry keeps its real mm coords (dimensions readout depends on
 * that); only the wrapping group is transformed.
 */
function FixedFrameModel({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const geometry = useLoader(STLLoader, url);
  const frame = useMemo(() => frameTransformFor(geometry), [geometry]);
  return (
    <group scale={frame.scale} position={frame.position}>
      {children}
    </group>
  );
}

/**
 * Translucent overlay of a second model (the studio's compare toggle),
 * normalized through the same fixed frame as the primary model so both land
 * in an identical camera/scale. Non-interactive: no raycast hits, no depth
 * writes, so it never intercepts annotate clicks or occludes the solid model.
 */
function GhostModel({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  const frame = useMemo(() => frameTransformFor(geometry), [geometry]);
  return (
    <group scale={frame.scale} position={frame.position}>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          color="#9ca3af"
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
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
  // Universal "3D is loading" placeholder: a softly deforming point cloud.
  return <PointCloudScene active />;
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
  target,
  annotations,
  pending,
  onPick,
}: {
  modelUrl: string;
  color?: string;
  planes: Plane[] | undefined;
  onBounds: (b: InspectBounds) => void;
  annotateMode?: boolean;
  target: "face" | "edge";
  annotations?: ViewerAnnotation[];
  pending?: PickResult | null;
  onPick?: (pick: {
    result: PickResult;
    clientX: number;
    clientY: number;
  }) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const [geom, setGeom] = useState<BufferGeometry | null>(null);
  const done = useRef(false);

  // Click = select; drag = rotate. r3f fires onClick even after a drag, so gate
  // on pointer travel (e.delta) to keep orbit-rotate usable in annotate mode.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!annotateMode || !onPick || e.delta > 4) return;
    e.stopPropagation();
    const mesh = e.object as THREE.Mesh;
    const g = mesh.geometry as BufferGeometry;
    const local = mesh.worldToLocal(e.point.clone());
    let result: PickResult | null = null;
    if (target === "edge") {
      result = selectNearestEdge(g, local);
    } else if (e.faceIndex != null) {
      result = { kind: "face", ...selectConnectedFace(g, e.faceIndex) };
    }
    if (!result) return;
    onPick({
      result,
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

    const g = geomRef.current;
    if (!g.boundingBox) g.computeBoundingBox();
    const gb = g.boundingBox!;
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
          setGeom(g);
        }}
      />
      {/* Stencil-fill the cross-section so solid reads as solid (the cap quad
          is drawn at the Canvas level). */}
      {planes && planes.length > 0 && geom && (
        <SectionStencil geom={geom} planes={planes} />
      )}
      {/* Faint guide of all selectable edges while in edge mode. */}
      {annotateMode && target === "edge" && geom && <FeatureEdges geom={geom} />}

      {/* Committed annotation highlights (face overlay or edge line). */}
      {(annotations ?? []).map((a) =>
        a.kind === "edge" ? (
          <EdgeHighlight key={a.id} a={a.edge.a} b={a.edge.b} />
        ) : (
          <FaceHighlight key={a.id} positions={a.positions} />
        )
      )}

      {/* Brighter preview of the face/edge being annotated right now. */}
      {pending?.kind === "face" && pending.positions.length > 0 && (
        <FaceHighlight positions={pending.positions} color="#f59e0b" />
      )}
      {pending?.kind === "edge" && (
        <EdgeHighlight a={pending.edge.a} b={pending.edge.b} color="#f59e0b" />
      )}
    </group>
  );
}

/** Subtle per-part shades so assembly parts read as distinct pieces. */
const ASSEMBLY_SHADES = ["#a0a0a0", "#8f979f", "#b3afa7", "#9aa6ab"];

/**
 * Multi-part assembly in ONE shared frame (MTR-174): every part keeps its
 * native assembly-position coordinates; the frame fits the UNION bounding box
 * of all parts (visible or not), so isolating a part just hides the others —
 * no recenter, no reframe. Cross-section clipping and face annotation work on
 * every visible part; the stencil cap + edge guides are single-mesh tools and
 * stay off here.
 */
function InspectAssembly({
  parts,
  planes,
  onBounds,
  annotateMode,
  target,
  annotations,
  pending,
  onPick,
}: {
  parts: { url: string; name: string; visible: boolean }[];
  planes: Plane[] | undefined;
  onBounds: (b: InspectBounds) => void;
  annotateMode?: boolean;
  target: "face" | "edge";
  annotations?: ViewerAnnotation[];
  pending?: PickResult | null;
  onPick?: (pick: {
    result: PickResult;
    clientX: number;
    clientY: number;
  }) => void;
}) {
  const urls = parts.map((p) => p.url);
  const geometries = useLoader(STLLoader, urls);
  const frame = useMemo(() => frameTransformForAll(geometries), [geometries]);
  const groupRef = useRef<THREE.Group>(null);
  const done = useRef(false);

  // Same click = select / drag = rotate gate as InspectModel; the picked
  // mesh's own geometry is used, so selection works on any visible part.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!annotateMode || !onPick || e.delta > 4) return;
    e.stopPropagation();
    const mesh = e.object as THREE.Mesh;
    const g = mesh.geometry as BufferGeometry;
    const local = mesh.worldToLocal(e.point.clone());
    let result: PickResult | null = null;
    if (target === "edge") {
      result = selectNearestEdge(g, local);
    } else if (e.faceIndex != null) {
      result = { kind: "face", ...selectConnectedFace(g, e.faceIndex) };
    }
    if (!result) return;
    onPick({
      result,
      clientX: e.nativeEvent.clientX,
      clientY: e.nativeEvent.clientY,
    });
  };

  // Measure once from ALL parts (independent of visibility) so the section
  // plane range, grid, and dimensions readout describe the whole assembly
  // and stay put when parts are hidden.
  useFrame(() => {
    if (done.current || !groupRef.current) return;
    const group = groupRef.current;
    group.updateWorldMatrix(true, true);
    const world = new Box3().setFromObject(group);
    if (!isFinite(world.min.y) || world.isEmpty()) return;

    const mmBox = new Box3();
    for (const g of geometries) {
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) mmBox.union(g.boundingBox);
    }
    const mm = new Vector3();
    mmBox.getSize(mm);
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
    <group scale={frame.scale} position={frame.position}>
      <group ref={groupRef} onClick={annotateMode ? handleClick : undefined}>
        {parts.map((p, i) => (
          <group key={p.url} visible={p.visible}>
            <StlModel
              url={p.url}
              color={ASSEMBLY_SHADES[i % ASSEMBLY_SHADES.length]}
              clippingPlanes={planes}
            />
          </group>
        ))}

        {/* Committed annotation highlights (model-space mm = part space). */}
        {(annotations ?? []).map((a) =>
          a.kind === "edge" ? (
            <EdgeHighlight key={a.id} a={a.edge.a} b={a.edge.b} />
          ) : (
            <FaceHighlight key={a.id} positions={a.positions} />
          )
        )}
        {pending?.kind === "face" && pending.positions.length > 0 && (
          <FaceHighlight positions={pending.positions} color="#f59e0b" />
        )}
        {pending?.kind === "edge" && (
          <EdgeHighlight a={pending.edge.a} b={pending.edge.b} color="#f59e0b" />
        )}
      </group>
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
  fixedFrame = false,
  ghostUrl,
  assemblyParts,
}: ModelViewerProps) {
  const isPreview = mode === "preview";
  // Wheel zoom defaults to true unless explicitly disabled. The
  // preview mode (auto-rotating thumbnail) has always disabled it.
  const wheelZoom =
    enableWheelZoom === undefined ? !isPreview : enableWheelZoom;
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // What kind of geometry the annotate tool selects.
  const [target, setTarget] = useState<"face" | "edge">("face");

  // The face/edge just clicked, awaiting a note. `x`/`y` are screen coords
  // relative to the viewer wrapper, so the note input opens at the click.
  const [pending, setPending] = useState<{
    result: PickResult;
    x: number;
    y: number;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const openPending = (pick: {
    result: PickResult;
    clientX: number;
    clientY: number;
  }) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setNoteDraft("");
    setPending({
      result: pick.result,
      x: pick.clientX - (rect?.left ?? 0),
      y: pick.clientY - (rect?.top ?? 0),
    });
  };

  const commitPending = () => {
    if (pending) {
      onAnnotate?.({ ...pending.result, note: noteDraft.trim() });
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
          camera={
            fixedFrame
              ? { position: STUDIO_CAMERA.position, fov: STUDIO_CAMERA.fov }
              : { position: [0, 0, 5], fov: 45 }
          }
          dpr={isPreview ? 1 : [1, 2]}
          // Local clipping is needed for the cross-section tool; harmless
          // (no-op) everywhere else since no material sets clippingPlanes.
          gl={{ localClippingEnabled: true, stencil: true }}
        >
          <Suspense fallback={<LoadingFallback />}>
            {fixedFrame && inspectable ? (
              // Studio: fixed camera + deterministic fit (no Stage), so this
              // viewer registers with the deforming-loader canvas. MaterializeMaterial
              // is self-lit, so a touch of ambient is all the rig needs.
              <>
                <ambientLight intensity={0.7} />
                {assemblyParts && assemblyParts.length > 1 ? (
                  <InspectAssembly
                    parts={assemblyParts}
                    planes={planes}
                    onBounds={setBounds}
                    annotateMode={annotateMode}
                    target={target}
                    annotations={annotations}
                    pending={pending?.result ?? null}
                    onPick={openPending}
                  />
                ) : (
                  <FixedFrameModel url={modelUrl}>
                    <InspectModel
                      modelUrl={modelUrl}
                      color={materialColor}
                      planes={planes}
                      onBounds={setBounds}
                      annotateMode={annotateMode}
                      target={target}
                      annotations={annotations}
                      pending={pending?.result ?? null}
                      onPick={openPending}
                    />
                  </FixedFrameModel>
                )}
                {/* Compare overlay — an older version ghosted in the same
                    frame (GhostModel normalizes itself; see above). */}
                {ghostUrl && <GhostModel url={ghostUrl} />}
              </>
            ) : (
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
                      target={target}
                      annotations={annotations}
                      pending={pending?.result ?? null}
                      onPick={openPending}
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
            )}
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
            {/* Filled cross-section cap at the cut plane (world space). */}
            {inspectable && sectionOn && bounds && (
              <SectionCap
                center={bounds.center}
                cutY={
                  bounds.worldMaxY -
                  sectionT * (bounds.worldMaxY - bounds.worldMinY)
                }
                size={Math.max(bounds.footprint.x, bounds.footprint.z) * 1.5}
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
                  title="Annotate — click a face or edge to add a note"
                  className={`flex h-8 w-8 items-center justify-center transition-colors hover:bg-foreground/5 ${
                    annotateMode ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <MousePointer2Icon className="size-4" />
                </button>
              </>
            )}
          </div>

          {/* Face / Edge target toggle — only while annotating. */}
          {onToggleAnnotate && annotateMode && (
            <div className="absolute right-3 top-12 flex items-center gap-0 overflow-hidden rounded-full border border-border/60 bg-background/40 text-xs backdrop-blur-md">
              {(["face", "edge"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  aria-pressed={target === t}
                  className={`px-3 py-1 capitalize transition-colors hover:bg-foreground/5 ${
                    target === t ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

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
