import * as THREE from "three";

/**
 * Procedural brushed-titanium maps for the payment card body.
 *
 * Catalog titanium is a flat PBR row (color + metalness + roughness).
 * Brushed metal needs directional grain — horizontal streaks that
 * break up the specular lobe. We paint a small canvas once and wrap
 * it as a roughness map; MeshPhysicalMaterial.anisotropy stretches
 * the highlight along the same axis. No image assets, no custom
 * shader — same stack as the dropzone metals, just with grain.
 */

export const BRUSH_REPEAT = 3.2;

/** Mid gray = base roughness; lighter streaks = shinier grooves. */
export function paintBrushCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  ctx.fillStyle = "#7a7a7a";
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y++) {
    // Dense fine grain — every scanline gets a faint streak so the
    // surface never reads as flat plastic under IBL.
    const shade = 90 + ((y * 37 + 11) % 70);
    const alpha = 0.18 + ((y * 13) % 40) / 100;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha})`;
    ctx.fillRect(0, y, w, 1);

    // Occasional brighter / darker bands for a hand-brushed feel.
    if (y % 7 === 0) {
      const band = 140 + ((y * 5) % 60);
      ctx.fillStyle = `rgba(${band},${band},${band},0.35)`;
      ctx.fillRect(0, y, w, 1);
    }
    if (y % 17 === 0) {
      ctx.fillStyle = "rgba(40,40,44,0.28)";
      ctx.fillRect(0, y, w, 2);
    }
  }

  // Sparse longer highlights — the bright catch you see on real
  // brushed plates when a softbox skims the grain.
  for (let i = 0; i < 28; i++) {
    const y = ((i * 97) % (h - 2)) + 1;
    const x = (i * 53) % Math.floor(w * 0.45);
    const len = w * (0.35 + ((i * 19) % 40) / 100);
    ctx.fillStyle = `rgba(210,210,215,${0.18 + (i % 5) / 20})`;
    ctx.fillRect(x, y, len, 1);
  }
}

export function makeBrushedTitaniumMaps(): {
  roughnessMap: THREE.CanvasTexture;
} {
  const w = 256;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    paintBrushCanvas(ctx, w, h);
  }
  // Headless / no-2d-context still gets a texture so the material
  // constructs; anisotropy alone carries the look until a real
  // canvas paints the grain.
  const roughnessMap = new THREE.CanvasTexture(canvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(BRUSH_REPEAT, BRUSH_REPEAT);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = 4;
  return { roughnessMap };
}
