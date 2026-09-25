/**
 * The five material families the hero carousel cycles through. These
 * are render looks, not catalogue entries — they stand in for a family
 * (every plastic, every alloy), so they don't share ids with
 * lib/materials or the CraftCloud catalog.
 */
export interface LandingMaterial {
  id: string;
  name: string;
  /** How the family reads inside "Print ___" during the intro. */
  word: string;
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
    word: "plastics",
    // Warm white — the colour the prototype is actually printed in.
    color: "#e9e4da",
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0.2,
  },
  {
    id: "tpu",
    name: "TPU",
    word: "TPU",
    color: "#25272b",
    metalness: 0,
    roughness: 0.88,
  },
  {
    id: "alloy",
    name: "Alloys",
    word: "alloys",
    color: "#c9ccd1",
    metalness: 1,
    roughness: 0.34,
  },
  {
    id: "steel",
    name: "Steel",
    word: "steel",
    color: "#8a8d93",
    metalness: 1,
    roughness: 0.14,
    clearcoat: 0.4,
  },
  {
    id: "resin",
    name: "Resin",
    word: "resin",
    color: "#a9d8e6",
    metalness: 0,
    roughness: 0.06,
    transmission: 0.92,
    ior: 1.52,
    thickness: 0.6,
  },
];

/** The resting word. It is also what the server renders. */
export const RESTING_WORD = "anything";

export interface IntroStep {
  material: number;
  word: string;
}

/**
 * Load-time whoosh: every family once, then back to the first with the
 * resting word — "Print plastics … resin" → "Print anything".
 */
export const INTRO_SEQUENCE: readonly IntroStep[] = [
  ...LANDING_MATERIALS.map((m, i) => ({ material: i, word: m.word })),
  { material: 0, word: RESTING_WORD },
];

export const INTRO_STEP_MS = 360;

export function wrapIndex(i: number): number {
  const n = LANDING_MATERIALS.length;
  return ((i % n) + n) % n;
}
