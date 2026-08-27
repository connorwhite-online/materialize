/**
 * Catalog-backed PBR looks for the authed-home dropzone primitives.
 *
 * Inlined (rather than imported from `lib/materials`) so the home
 * client chunk doesn't pull the full editorial preset library. A test
 * pins each `catalogId` + colour/PBR against the real catalog / hero
 * overrides so these can't drift silently.
 */
export type DropzoneLook = {
  catalogId: string;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
};

export const DROPZONE_LOOKS: Record<
  "steel" | "resin" | "gold" | "pla" | "aluminum",
  DropzoneLook
> = {
  steel: {
    catalogId: "steel-316l",
    color: "#8a8a8a",
    metalness: 1,
    roughness: 0.35,
  },
  resin: {
    catalogId: "resin-standard",
    // Hero override — translucent cream, not the stock opaque resin.
    color: "#e6dfcc",
    metalness: 0,
    roughness: 0.08,
    clearcoat: 0.9,
    transmission: 0.85,
    ior: 1.5,
    thickness: 1.2,
  },
  gold: {
    catalogId: "gold-18k",
    color: "#d4a94a",
    metalness: 1,
    roughness: 0.15,
  },
  pla: {
    catalogId: "pla-white",
    // Hero override — warmer off-white so it holds a silhouette.
    color: "#c4bca8",
    metalness: 0,
    roughness: 0.42,
    clearcoat: 0.25,
  },
  aluminum: {
    catalogId: "aluminum",
    color: "#b0b0b0",
    metalness: 1,
    roughness: 0.42,
  },
};

export type DropzoneLookId = keyof typeof DROPZONE_LOOKS;

export type DropzonePrimitiveKind =
  | "roundedBox"
  | "sphere"
  | "torus"
  | "capsule"
  | "roundedSlab";

export interface DropzonePrimitive {
  look: DropzoneLookId;
  kind: DropzonePrimitiveKind;
  /** World-space rest pose inside the dropzone canvas. */
  position: readonly [number, number, number];
  scale: number;
  rotSpeed: readonly [number, number, number];
  floatAmp: number;
  floatSpeed: number;
  phase: number;
  /**
   * Tailwind placement for the CSS stand-in (loading / no-WebGL).
   * Keep these on the edges so the "Add a File" copy stays clear.
   */
  fallbackClass: string;
}

/**
 * Five chunky, round-cornered primitives around the copy. Tuned for a
 * wide, short dropzone (~2:1) with the camera at z ≈ 6.5, fov 28.
 */
export const DROPZONE_PRIMITIVES: readonly DropzonePrimitive[] = [
  {
    look: "steel",
    kind: "roundedBox",
    position: [-2.05, 0.22, -0.2],
    scale: 0.86,
    rotSpeed: [0.16, 0.28, 0.07],
    floatAmp: 0.08,
    floatSpeed: 0.7,
    phase: 0.4,
    fallbackClass:
      "left-[5%] top-[16%] size-16 rounded-3xl sm:size-[4.5rem]",
  },
  {
    look: "resin",
    kind: "sphere",
    position: [2.1, 0.28, 0.05],
    scale: 0.78,
    rotSpeed: [0.1, 0.18, 0.04],
    floatAmp: 0.1,
    floatSpeed: 0.85,
    phase: 1.2,
    fallbackClass: "right-[6%] top-[12%] size-16 rounded-full sm:size-[4.25rem]",
  },
  {
    look: "gold",
    kind: "torus",
    position: [-1.75, -0.42, 0.35],
    scale: 0.7,
    rotSpeed: [0.24, 0.14, 0.18],
    floatAmp: 0.07,
    floatSpeed: 0.6,
    phase: 2.1,
    fallbackClass:
      "left-[11%] bottom-[10%] size-14 rounded-full sm:size-16",
  },
  {
    look: "pla",
    kind: "capsule",
    position: [1.85, -0.4, 0.28],
    scale: 0.72,
    rotSpeed: [0.12, 0.32, 0.05],
    floatAmp: 0.09,
    floatSpeed: 0.75,
    phase: 2.8,
    fallbackClass:
      "right-[10%] bottom-[8%] h-16 w-10 rounded-full sm:h-[4.5rem] sm:w-11",
  },
  {
    look: "aluminum",
    kind: "roundedSlab",
    position: [0.08, 0.58, -0.5],
    scale: 0.52,
    rotSpeed: [0.2, 0.3, 0.1],
    floatAmp: 0.06,
    floatSpeed: 0.95,
    phase: 0.9,
    fallbackClass:
      "left-1/2 top-[7%] h-9 w-14 -translate-x-1/2 rotate-12 rounded-2xl sm:h-10 sm:w-16",
  },
];
