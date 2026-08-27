/**
 * Printable-material looks for the authed-home dropzone primitives.
 *
 * Inlined (rather than imported from `lib/materials`) so the home
 * client chunk doesn't pull the full editorial preset library. A test
 * pins each `catalogId` + PBR against the real catalog / hero
 * overrides so these can't drift silently.
 *
 * Live set: stainless 316L, translucent resin, Nylon PA12 — the three
 * shapes read as real print materials under studio IBL.
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
      // Nylon PA12 — matte SLS plastic.
      catalogId: "nylon-pa12",
      color: "#d4cfc7",
      metalness: 0,
      roughness: 0.8,
    },
  };

export type DropzoneLookId = keyof typeof DROPZONE_LOOKS;

export type DropzonePrimitiveKind = "roundedBox" | "sphere" | "roundedTriangle";

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
   * Starting Euler tilt. Omitted → derived from `phase`. The triangle
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
 * sphere right, nylon triangle along the bottom. Desktop scale is
 * modest; the scene shrinks them further on narrow canvases.
 */
export const DROPZONE_PRIMITIVES: readonly DropzonePrimitive[] = [
  {
    look: "steel",
    kind: "roundedBox",
    position: [-0.88, 0.06, -0.15],
    scale: 1.0,
    restRotation: [0.32, 0.52, 0.08],
    rotSpeed: [0.02, 0.045, 0.01],
    floatAmp: 0.07,
    floatSpeed: 0.65,
    phase: 0.4,
    fallbackClass:
      "-left-2 top-[20%] size-14 rounded-[1.15rem] sm:size-20 sm:rounded-[1.4rem]",
  },
  {
    look: "resin",
    kind: "sphere",
    position: [0.88, 0.1, 0.05],
    scale: 0.96,
    rotSpeed: [0.022, 0.05, 0.01],
    floatAmp: 0.09,
    floatSpeed: 0.8,
    phase: 1.2,
    fallbackClass: "-right-2 top-[16%] size-14 rounded-full sm:size-20",
  },
  {
    look: "nylon",
    kind: "roundedTriangle",
    position: [0.18, -0.58, 0.12],
    scale: 0.98,
    rotSpeed: [0.005, 0.03, 0.004],
    floatAmp: 0.035,
    floatSpeed: 0.5,
    phase: 0.2,
    restRotation: [0.04, 0.12, 0],
    fallbackClass:
      "-bottom-2 right-[26%] h-14 w-12 [clip-path:polygon(50%_2%,55%_10%,97%_88%,90%_100%,10%_100%,3%_88%,45%_10%)] sm:h-20 sm:w-[4.5rem]",
  },
];
