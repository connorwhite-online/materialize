"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { MaterializeMaterial } from "@/components/viewer/materialize-material";

interface MaterialCardPreviewProps {
  color: string;
  className?: string;
}

// Bump when shape, shader, framing, or shader uniforms change so cached
// thumbnails in user browsers regenerate automatically.
// v1: broken shader (uniforms unset → grey).
// v2: fixed shader, but capture inherited the container size, so the
//     small selector swatch wrote a 48px thumbnail that the material
//     detail hero then upscaled into mush.
// v3: capture happens in a fixed 512px offscreen canvas, so display
//     consumers can be any size and share the same crisp asset.
// v4: chamfered pyramid geometry, single-pow fresnel, normalized varyings.
// v5: clean square frustum (the chamfered convex hull was producing
//     degenerate corner triangles → muddy shading); transparent
//     backdrop instead of the radial gradient that was washing out
//     the silhouette.
// v6: actual square pyramid with a pointed apex (v5 was a truncated
//     pyramid / frustum, not what we wanted).
// v7: square pyramid with beveled / chamfered edges. Each ideal face
//     is inset along its plane, then the convex hull of all inset
//     points generates the bevel strips along every edge automatically.
const THUMBNAIL_VERSION = 7;
const STORAGE_PREFIX = "materialTile:v";
const CAPTURE_SIZE = 512;

function cacheKey(color: string) {
  return `${STORAGE_PREFIX}${THUMBNAIL_VERSION}:${color.toLowerCase()}`;
}

function readCached(color: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(cacheKey(color));
  } catch {
    return null;
  }
}

function writeCached(color: string, dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(color), dataUrl);
  } catch {
    // Quota or privacy mode — fine, regenerate next session.
  }
}

function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * A square pyramid with beveled / chamfered edges.
 *
 * Build approach:
 *   1. Define the ideal pyramid as five flat polygonal faces — the
 *      square base and four triangular sides meeting at the apex.
 *   2. For every face, inset each vertex inward (toward the face
 *      centroid, along the face plane) by `bevel`. Each ideal vertex
 *      that was shared between multiple faces now becomes one inset
 *      point per incident face.
 *   3. Take the convex hull of all the inset points. The hull algorithm
 *      produces:
 *        - the inset face polygons (the original faces, slightly smaller)
 *        - a small rectangular strip along every edge (the chamfer)
 *        - a small triangle at every corner (apex + 4 base corners)
 *      automatically, with correct flat-shaded normals.
 *
 * The apex inset gets four points clustered around y = height − bevel
 * which still reads as a sharp top.
 */
function BeveledPyramidMesh({ color }: { color: string }) {
  const geometry = useMemo(() => {
    const baseHalf = 0.95;
    const height = 1.6;
    const bevel = 0.08;

    const baseCorners = [
      new THREE.Vector3(-baseHalf, 0, -baseHalf),
      new THREE.Vector3(baseHalf, 0, -baseHalf),
      new THREE.Vector3(baseHalf, 0, baseHalf),
      new THREE.Vector3(-baseHalf, 0, baseHalf),
    ];
    const apex = new THREE.Vector3(0, height, 0);

    type Face = {
      vertices: THREE.Vector3[];
      centroid: THREE.Vector3;
    };

    const faces: Face[] = [];

    // Square base — winding doesn't matter since the convex hull will
    // assign its own normals. We only need the centroid + the 4
    // vertices to inset.
    faces.push({
      vertices: baseCorners,
      centroid: new THREE.Vector3(0, 0, 0),
    });

    // Four triangular side faces.
    for (let i = 0; i < 4; i++) {
      const a = baseCorners[i];
      const b = baseCorners[(i + 1) % 4];
      const verts = [a, b, apex];
      const centroid = a
        .clone()
        .add(b)
        .add(apex)
        .multiplyScalar(1 / 3);
      faces.push({ vertices: verts, centroid });
    }

    // Inset every face's vertices toward its centroid by `bevel`. The
    // direction is automatically along the face plane because both v
    // and the centroid lie on the face.
    const insetPoints: THREE.Vector3[] = [];
    for (const face of faces) {
      for (const v of face.vertices) {
        const toCenter = face.centroid.clone().sub(v);
        const dist = toCenter.length();
        if (dist === 0) continue;
        // Clamp the inset so we never overshoot the centroid on small
        // faces (the side triangles can be shorter than `bevel` along
        // some directions).
        const amount = Math.min(bevel, dist * 0.45);
        insetPoints.push(
          v.clone().add(toCenter.multiplyScalar(amount / dist))
        );
      }
    }

    const geo = new ConvexGeometry(insetPoints);
    geo.center();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} rotation={[0.28, 0.55, 0]}>
      <MaterializeMaterial
        baseColor={color}
        accentColor={adjustBrightness(color, -38)}
        fresnelColor={adjustBrightness(color, 65)}
      />
    </mesh>
  );
}

function CaptureOnce({ onReady }: { onReady: (dataUrl: string) => void }) {
  const { gl, scene, camera } = useThree();
  const captured = useRef(false);
  const framesSeen = useRef(0);

  useFrame(() => {
    if (captured.current) return;
    // Skip the first couple of frames so geometry buffers are uploaded
    // and the shader uniforms are bound — capturing on frame 0 sometimes
    // produced a blank or untextured snapshot.
    if (framesSeen.current++ < 2) return;
    captured.current = true;
    gl.render(scene, camera);
    onReady(gl.domElement.toDataURL("image/webp", 0.92));
  });

  return null;
}

/**
 * A material "chip" — a chamfered truncated pyramid rendered with the
 * Materialize shader, tinted from the material's color. Renders once
 * per unique color, captures a thumbnail, caches in localStorage, and
 * then never mounts a canvas again for that color. Same component is
 * used for the materials index hero and the small swatches in the
 * material selector — they share the cache by color.
 */
export function MaterialCardPreview({
  color,
  className,
}: MaterialCardPreviewProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [shouldCapture, setShouldCapture] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = readCached(color);
    if (cached) {
      setThumbnail(cached);
      return;
    }
    setThumbnail(null);
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldCapture(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [color]);

  const handleCaptured = useCallback(
    (dataUrl: string) => {
      writeCached(color, dataUrl);
      setThumbnail(dataUrl);
      setShouldCapture(false);
    },
    [color]
  );

  return (
    <>
      <div ref={containerRef} className={className ?? "absolute inset-0"}>
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain"
          />
        )}
      </div>
      {!thumbnail && shouldCapture && (
        // Capture happens in a fixed-size offscreen canvas so every
        // consumer (small swatch, hero card, detail page) gets the same
        // high-resolution thumbnail regardless of how big the visible
        // container is. Without this, the first consumer to mount
        // dictates the cached resolution.
        <div
          className="pointer-events-none fixed -left-[9999px] top-0"
          style={{ width: CAPTURE_SIZE, height: CAPTURE_SIZE }}
        >
          <Canvas
            camera={{ position: [0, 0.4, 4.2], fov: 32 }}
            dpr={2}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          >
            <BeveledPyramidMesh color={color} />
            <CaptureOnce onReady={handleCaptured} />
          </Canvas>
        </div>
      )}
    </>
  );
}
