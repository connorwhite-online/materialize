"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/utils";
import { bakeIsometric, type BakedDrawing } from "@/lib/isometric/bake";
import { paletteKey, type IsometricPalette } from "@/lib/isometric/palette";
import { useIsometricPalette } from "@/lib/isometric/use-isometric-palette";
import { PART_BUILDERS, type IsometricPartKind } from "./isometric-parts";
import {
  DROPZONE_GRID,
  DROPZONE_PARTS,
  DROPZONE_PARTS_LINE_WIDTH,
  DROPZONE_PARTS_MOBILE_MAX_WIDTH,
  DROPZONE_PARTS_MOBILE_SCALE,
  type DropzonePart,
} from "./dropzone-parts-layout";

// Geometry is theme- and size-independent: build each part once per
// page load, however many times it's re-baked.
const geometryCache = new Map<IsometricPartKind, THREE.BufferGeometry>();
function partGeometry(kind: IsometricPartKind) {
  let g = geometryCache.get(kind);
  if (!g) {
    g = PART_BUILDERS[kind]();
    geometryCache.set(kind, g);
  }
  return g;
}

function useBakedPart(
  spec: DropzonePart,
  pxPerUnit: number,
  palette: IsometricPalette | null
) {
  const [baked, setBaked] = useState<BakedDrawing | null>(null);
  // Bake at whole-pixel sizes so a 1px resize doesn't re-bake.
  const ppu = Math.round(pxPerUnit);
  const key = palette ? paletteKey(palette) : null;

  useEffect(() => {
    if (!palette || ppu <= 0) return;
    let cancelled = false;
    let url: string | null = null;
    // Settle first: the well's size and the theme both land in the
    // first frames after hydration, and each would cost a bake.
    const timer = window.setTimeout(() => {
      bakeIsometric(partGeometry(spec.kind), {
        pxPerUnit: ppu,
        palette,
        yaw: spec.yaw,
        lineWidth: DROPZONE_PARTS_LINE_WIDTH,
        dpr: window.devicePixelRatio,
        label: spec.kind,
      })
        .then((d) => {
          url = d.url;
          if (cancelled) URL.revokeObjectURL(d.url);
          else setBaked(d);
        })
        .catch(() => {
          // No WebGL: the well stays plain, which is fine for a backdrop.
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // `key` stands in for `palette` (a fresh object on every re-read).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.kind, spec.yaw, ppu, key]);

  return baked;
}

function Part({
  spec,
  box,
  palette,
}: {
  spec: DropzonePart;
  box: { width: number; height: number };
  palette: IsometricPalette | null;
}) {
  const mobile = box.width < DROPZONE_PARTS_MOBILE_MAX_WIDTH;
  const ppu =
    Math.min(box.height, 140) *
    spec.size *
    (mobile ? DROPZONE_PARTS_MOBILE_SCALE : 1);
  const baked = useBakedPart(spec, ppu, palette);
  if (!baked || (mobile && spec.mobilePosition === null)) return null;

  const [fx, fy] = (mobile && spec.mobilePosition) || spec.position;
  // Fraction of the well → CSS px from its top-left, model origin there.
  const x = box.width / 2 + fx * (box.width / 2) - baked.originX;
  const y = box.height / 2 - fy * (box.height / 2) - baked.originY;
  const period = (Math.PI * 2) / spec.floatSpeed;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob URL baked on the client; next/image has nothing to optimise
    <img
      src={baked.url}
      alt=""
      width={baked.width}
      height={baked.height}
      draggable={false}
      className="mz-iso-float absolute select-none"
      style={
        {
          left: x,
          top: y,
          "--mz-float": `${spec.floatPx}px`,
          animationDuration: `${period / 2}s`,
          animationDelay: `${-(spec.phase / spec.floatSpeed)}s`,
        } as CSSProperties
      }
    />
  );
}

/**
 * Isometric line drawings of additive-only machine parts behind the
 * featured file dropzone — thruster, closed impeller, manifold — in the
 * page's own ink and paper tones.
 *
 * Each part is baked once to an image by the shared isometric renderer
 * (`lib/isometric`), then floated with a CSS animation: no live canvas,
 * no per-frame GPU work, and nothing to pause off-screen. Decorative;
 * `pointer-events` stay off so the file input remains the only control.
 */
export function DropzoneParts() {
  const containerRef = useRef<HTMLDivElement>(null);
  const palette = useIsometricPalette(containerRef);
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        prev &&
        Math.abs(prev.width - width) < 1 &&
        Math.abs(prev.height - height) < 1
          ? prev
          : { width, height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div
        className={cn(
          "absolute inset-0",
          DROPZONE_GRID === "dots" ? "mz-drafting-dots" : "mz-drafting-grid"
        )}
      />
      {box &&
        DROPZONE_PARTS.map((spec) => (
          <Part key={spec.kind} spec={spec} box={box} palette={palette} />
        ))}
    </div>
  );
}
