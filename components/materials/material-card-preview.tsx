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
const THUMBNAIL_VERSION = 4;
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
 * A truncated square pyramid (frustum) with chamfered edges. Built as
 * the convex hull of points clustered around each ideal corner — three
 * offset points per corner, one along each adjacent edge — so the hull
 * algorithm produces small triangular chamfer faces at every vertex
 * and rectangular bevel strips along every edge automatically. No need
 * to author the topology by hand or worry about smoothing groups.
 */
function ChamferedPyramidMesh({ color }: { color: string }) {
  const geometry = useMemo(() => {
    const baseHalf = 0.95;
    const topHalf = 0.32;
    const height = 1.55;
    const chamfer = 0.07;

    // Eight ideal corners — base square at y=0, top square at y=height.
    const corners: [number, number, number][] = [
      [-baseHalf, 0, -baseHalf], // 0
      [baseHalf, 0, -baseHalf], // 1
      [baseHalf, 0, baseHalf], // 2
      [-baseHalf, 0, baseHalf], // 3
      [-topHalf, height, -topHalf], // 4
      [topHalf, height, -topHalf], // 5
      [topHalf, height, topHalf], // 6
      [-topHalf, height, topHalf], // 7
    ];

    // Each vertex is incident to exactly three edges (two within its
    // square ring, one going to the opposite ring).
    const adjacency: number[][] = [
      [1, 3, 4],
      [0, 2, 5],
      [1, 3, 6],
      [0, 2, 7],
      [5, 7, 0],
      [4, 6, 1],
      [5, 7, 2],
      [4, 6, 3],
    ];

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < corners.length; i++) {
      const v = new THREE.Vector3(...corners[i]);
      for (const j of adjacency[i]) {
        const dir = new THREE.Vector3(...corners[j]).sub(v).normalize();
        points.push(v.clone().add(dir.multiplyScalar(chamfer)));
      }
    }

    const geo = new ConvexGeometry(points);
    geo.center();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} rotation={[-0.18, 0.5, 0]}>
      <MaterializeMaterial
        baseColor={color}
        accentColor={adjustBrightness(color, -32)}
        fresnelColor={adjustBrightness(color, 60)}
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
      <div
        ref={containerRef}
        className={className ?? "absolute inset-0"}
        style={{
          background: `radial-gradient(circle at 30% 25%, ${adjustBrightness(color, 22)}, ${adjustBrightness(color, -32)} 80%)`,
        }}
      >
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
            camera={{ position: [0, 0.15, 4.1], fov: 32 }}
            dpr={2}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          >
            <ChamferedPyramidMesh color={color} />
            <CaptureOnce onReady={handleCaptured} />
          </Canvas>
        </div>
      )}
    </>
  );
}
