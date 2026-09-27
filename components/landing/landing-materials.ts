/**
 * The five material families the hero carousel cycles through. These
 * are render looks, not catalogue entries — they stand in for a family
 * (every plastic, every alloy), so they don't share ids with
 * lib/materials or the CraftCloud catalog.
 */
export interface LandingMaterial {
  id: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
}

export const LANDING_MATERIALS: readonly LandingMaterial[] = [
  {
    id: "plastic",
    name: "Plastics",
    // Warm white — the colour the prototype is actually printed in.
    color: "#e9e4da",
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0.2,
  },
  {
    id: "tpu",
    name: "TPU",
    color: "#25272b",
    metalness: 0,
    roughness: 0.88,
  },
  {
    id: "alloy",
    name: "Alloys",
    color: "#c9ccd1",
    metalness: 1,
    roughness: 0.34,
  },
  {
    // Satin, not mirror: a near-mirror only reflects the dark studio and
    // reads black.
    id: "steel",
    name: "Steel",
    color: "#a4a7ad",
    metalness: 1,
    roughness: 0.3,
    clearcoat: 0.4,
  },
  {
    id: "resin",
    name: "Resin",
    color: "#a9d8e6",
    metalness: 0,
    roughness: 0.06,
    transmission: 0.92,
    ior: 1.52,
    thickness: 0.6,
  },
];

export function wrapIndex(i: number): number {
  const n = LANDING_MATERIALS.length;
  return ((i % n) + n) % n;
}
