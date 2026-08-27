/**
 * Catalog colours for the authed-home dropzone primitives.
 *
 * Inlined (rather than imported from `lib/materials`) so the home
 * client chunk doesn't pull the full editorial preset library. A test
 * pins each `catalogId` + colour against the real catalog / hero
 * overrides so these can't drift silently. Shade is a flat sketch
 * fill (`toonColor`) with a soft pencil tint (`toonShadow`). Metalness
 * and transmission stay on the object so the catalog pin still
 * matches the row, but they are not used at draw time.
 */
export type DropzoneLook = {
  catalogId: string;
  color: string;
  /**
   * Flat sketch fill + soft pencil shade — purplish blue, pinkish
   * red, yellowish green. Quiet pastels, still clearly coloured.
   */
  toonColor: string;
  toonShadow: string;
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
    // Square — sketch periwinkle.
    toonColor: "#8b84d8",
    toonShadow: "#5c56a0",
    metalness: 1,
    roughness: 0.35,
  },
  resin: {
    catalogId: "resin-standard",
    // Hero override — translucent cream, not the stock opaque resin.
    color: "#e6dfcc",
    // Sphere — sketch rose.
    toonColor: "#e89096",
    toonShadow: "#b85862",
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
    toonColor: "#d4a94a",
    toonShadow: "#9a6e22",
    metalness: 1,
    roughness: 0.15,
  },
  pla: {
    catalogId: "pla-white",
    // Hero override — warmer off-white so it holds a silhouette.
    color: "#c4bca8",
    // Triangle — sketch yellow-green.
    toonColor: "#c5d66e",
    toonShadow: "#8aa03c",
    metalness: 0,
    roughness: 0.42,
    clearcoat: 0.25,
  },
  aluminum: {
    catalogId: "aluminum",
    color: "#b0b0b0",
    toonColor: "#b0b0b0",
    toonShadow: "#6a7886",
    metalness: 1,
    roughness: 0.42,
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
   * Starting Euler tilt. Omitted → derived from `phase` (the square
   * and sphere). The triangle sets this explicitly so it stays
   * face-on enough to read as a triangle, not a tumbling wedge.
   */
  restRotation?: readonly [number, number, number];
  /**
   * Tailwind placement for the CSS stand-in (loading / no-WebGL).
   * Hang off the dashed well so the CSS stand-in also clips a little.
   */
  fallbackClass: string;
}

/**
 * Three chubby sketch shapes: rounded square left, sphere right,
 * rounded triangle along the bottom. Desktop scale is modest; the
 * scene shrinks them further on narrow canvases. Rotation is slow.
 */
export const DROPZONE_PRIMITIVES: readonly DropzonePrimitive[] = [
  {
    look: "steel",
    kind: "roundedBox",
    position: [-0.88, 0.06, -0.15],
    scale: 1.0,
    // 3/4 view so the chubby square reads as a square, not a ball.
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
    look: "pla",
    kind: "roundedTriangle",
    position: [0.18, -0.58, 0.12],
    scale: 0.98,
    rotSpeed: [0.005, 0.03, 0.004],
    floatAmp: 0.035,
    floatSpeed: 0.5,
    phase: 0.2,
    // Face-on enough that the chubby triangle still reads as a triangle.
    restRotation: [0.04, 0.12, 0],
    fallbackClass:
      "-bottom-2 right-[26%] h-14 w-12 [clip-path:polygon(50%_2%,55%_10%,97%_88%,90%_100%,10%_100%,3%_88%,45%_10%)] sm:h-20 sm:w-[4.5rem]",
  },
];
