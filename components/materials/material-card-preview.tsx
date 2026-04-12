"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
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
const THUMBNAIL_VERSION = 3;
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
 * A beveled rounded rectangle — the canonical "material chip" shape.
 * Generous bevel so the fresnel + hemisphere lighting in MaterializeMaterial
 * has surface curvature to play against (a flat extrude looks identical to
 * a CSS rect, defeating the point of running a shader). Built with arcs
 * (not quadratic curves) so the corners are exactly circular and don't
 * leave the spurious vertex sliver that quadratic approximations were
 * producing in the bottom-left of the chip.
 */
function RoundedRectMesh({ color }: { color: string }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const w = 1.55;
    const h = 1.05;
    const r = 0.2;
    const x = -w / 2;
    const y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x + w, y + h - r);
    shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    shape.lineTo(x + r, y + h);
    shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(x, y + r);
    shape.absarc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2, false);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelSize: 0.08,
      bevelThickness: 0.08,
      bevelSegments: 10,
      curveSegments: 28,
    });
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} rotation={[-0.22, 0.42, 0]}>
      <MaterializeMaterial
        baseColor={color}
        accentColor={adjustBrightness(color, -28)}
        fresnelColor={adjustBrightness(color, 55)}
      />
    </mesh>
  );
}

function CaptureOnce({ onReady }: { onReady: (dataUrl: string) => void }) {
  const { gl, scene, camera } = useThree();
  const captured = useRef(false);

  useFrame(() => {
    if (captured.current) return;
    captured.current = true;
    requestAnimationFrame(() => {
      gl.render(scene, camera);
      onReady(gl.domElement.toDataURL("image/webp", 0.9));
    });
  });

  return null;
}

/**
 * A material "chip" — a rounded extruded rectangle rendered with the
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
            camera={{ position: [0, 0, 3.1], fov: 32 }}
            dpr={1}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          >
            <RoundedRectMesh color={color} />
            <CaptureOnce onReady={handleCaptured} />
          </Canvas>
        </div>
      )}
    </>
  );
}
