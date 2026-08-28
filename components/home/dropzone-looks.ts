/**
 * Printable-material looks for the authed-home dropzone primitives.
 *
 * Inlined (rather than imported from `lib/materials`) so the home
 * client chunk doesn't pull the full editorial preset library. A test
 * pins each `catalogId` + PBR against the real catalog / hero
 * overrides so these can't drift silently.
 *
 * Live set: stainless 316L, translucent resin, Nylon PA11 — the
 * three shapes read as real print materials under studio IBL.
 */

export type DropzoneLook = {
  catalogId: string;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
};

export const DROPZONE_LOOKS: Record<"steel" | "resin" | "nylon", DropzoneLook> =
  {
    steel: {
      // Stainless Steel 316L — catalog row as-is.
      catalogId: "steel-316l",
      color: "#8a8a8a",
      metalness: 1,
      roughness: 0.35,
    },
    resin: {
      // Hero resin override — cream + transmission so the sphere reads
      // translucent, not chalky opaque stock resin.
      catalogId: "resin-standard",
      color: "#e6dfcc",
      metalness: 0,
      roughness: 0.08,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      transmission: 0.85,
      ior: 1.5,
      thickness: 1.2,
    },
    nylon: {
      // Nylon PA11 — warm sand SLS nylon. Natural PA12 chalks out on
      // the light well; black dyes the set too heavy next to steel.
      catalogId: "nylon-pa11",
      color: "#b8a88a",
      metalness: 0,
      roughness: 0.75,
    },
  };

export type DropzoneLookId = keyof typeof DROPZONE_LOOKS;

export type DropzonePrimitiveKind = "roundedBox" | "sphere" | "pyramid";

export interface DropzonePrimitive {
  look: DropzoneLookId;
  kind: DropzonePrimitiveKind;
  /**
   * Rest pose as a fraction of the visible frustum: x -1 is the left
   * edge, +1 the right; y -1 is the bottom, +1 the top. Values past
   * ±1 (or a scale that overruns the remaining margin) clip against
   * the dropzone border — that's intentional on desktop; mobile
   * pulls positions inward (see `DROPZONE_MOBILE_POSITION`).
   */
  position: readonly [number, number, number];
  scale: number;
  rotSpeed: readonly [number, number, number];
  floatAmp: number;
  floatSpeed: number;
  phase: number;
  /**
   * Starting Euler tilt. Omitted → derived from `phase`. The pyramid
   * and square set this so their silhouettes stay readable.
   */
  restRotation?: readonly [number, number, number];
  /**
   * Tailwind placement for the CSS stand-in (loading / no-WebGL).
   */
  fallbackClass: string;
}

/** Canvas CSS width (px) below which shapes shrink to fit the well. */
export const DROPZONE_MOBILE_MAX_WIDTH = 520;

/** Multiplier applied to each primitive's `scale` on narrow canvases. */
export const DROPZONE_MOBILE_SCALE = 0.68;

/** Corner radius on the unit rounded square — chubby, still a square. */
export const DROPZONE_SQUARE_RADIUS = 0.36;

/**
 * Pull frustum positions slightly inward on mobile so chubby shapes
 * sit inside the dashed well instead of clipping past the frame.
 */
export const DROPZONE_MOBILE_POSITION = 0.86;

/**
 * Three chubby print-material shapes: stainless square left, resin
 * sphere right, sand nylon rounded pyramid along the bottom. Desktop
 * scale is modest; the scene shrinks them further on narrow canvases.
 */
export const DROPZONE_PRIMITIVES: readonly DropzonePrimitive[] = [
  {
    look: "steel",
    kind: "roundedBox",
    // Parked close to the title so the set reads as one cluster.
    position: [-0.52, 0.04, -0.1],
    scale: 0.92,
    restRotation: [0.32, 0.52, 0.08],
    rotSpeed: [0.012, 0.028, 0.006],
    floatAmp: 0.035,
    floatSpeed: 0.55,
    phase: 0.4,
    fallbackClass:
      "left-[12%] top-[22%] size-12 rounded-[1rem] sm:size-14 sm:rounded-[1.15rem]",
  },
  {
    look: "resin",
    kind: "sphere",
    position: [0.52, 0.06, 0.05],
    scale: 0.88,
    rotSpeed: [0.014, 0.032, 0.006],
    floatAmp: 0.04,
    floatSpeed: 0.65,
    phase: 1.2,
    fallbackClass: "right-[12%] top-[18%] size-12 rounded-full sm:size-14",
  },
  {
    look: "nylon",
    kind: "pyramid",
    position: [0.06, -0.38, 0.1],
    scale: 0.9,
    // Slow tumble so the chubby ridges catch light without spinning.
    rotSpeed: [0.008, 0.028, 0.006],
    floatAmp: 0.022,
    floatSpeed: 0.55,
    phase: 0.2,
    // Tip + 45° yaw so two faces meet at a ridge toward the camera.
    restRotation: [0.38, Math.PI / 4, 0.08],
    fallbackClass:
      "bottom-[10%] left-1/2 h-12 w-12 -translate-x-1/2 [clip-path:polygon(50%_6%,94%_72%,78%_96%,22%_96%,6%_72%)] sm:h-14 sm:w-14",
  },
];
