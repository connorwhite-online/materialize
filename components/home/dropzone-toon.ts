import * as THREE from "three";

/**
 * Four-stop grayscale ramp for MeshToonMaterial. Nearest-filtered so
 * the bands stay hard (cel) instead of smoothing back into Lambert.
 */
export function makeToonRamp(): THREE.DataTexture {
  const data = new Uint8Array([
    72, 72, 72, 255, 168, 168, 168, 255, 255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Warm ink, same hue family as the UI foreground — not pure black. */
export const TOON_INK = "#2c261c";
