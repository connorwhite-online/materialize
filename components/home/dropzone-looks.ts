/**
 * Catalog colours for the authed-home dropzone primitives.
 *
 * Inlined (rather than imported from `lib/materials`) so the home
 * client chunk doesn't pull the full editorial preset library. A test
 * pins each `catalogId` + colour against the real catalog / hero
 * overrides so these can't drift silently. Shade is a hard four-chip
 * cel ramp (`toonDeep` / `toonShadow` / `toonColor` / `toonHighlight`)
 * plus a specular coin and a rim stroke. Metalness and transmission
 * stay on the object so the catalog pin still matches the row, but
 * they are not used at draw time.
 */
export type DropzoneLook = {
  catalogId: string;
  color: string;
  /**
   * Cel-ramp tints — purplish blue, pinkish red, yellowish green.
   * Poster-flat cartoon paint, still those three hues.
   */
  toonColor: string;
  toonDeep: string;
  toonShadow: string;
  toonHighlight: string;
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
    // Cube — cartoon periwinkle.
    toonColor: "#7a6ef0",
    toonDeep: "#241e6a",
    toonShadow: "#4a40c0",
    toonHighlight: "#fff6ff",
    metalness: 1,
    roughness: 0.35,
  },
  resin: {
    catalogId: "resin-standard",
    // Hero override — translucent cream, not the stock opaque resin.
    color: "#e6dfcc",
    // Sphere — cartoon rose.
    toonColor: "#f45d6c",
    toonDeep: "#7a1830",
    toonShadow: "#d0344c",
    toonHighlight: "#fff1f3",
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
    toonDeep: "#6a4a12",
    toonShadow: "#9a6e22",
    toonHighlight: "#f6e3a4",
    metalness: 1,
    roughness: 0.15,
  },
  pla: {
    catalogId: "pla-white",
    // Hero override — warmer off-white so it holds a silhouette.
    color: "#c4bca8",
    // Triangle — cartoon yellow-green.
    toonColor: "#c8ea3a",
    toonDeep: "#3a6410",
    toonShadow: "#6aaa1c",
    toonHighlight: "#fbffce",
    metalness: 0,
    roughness: 0.42,
    clearcoat: 0.25,
  },
  aluminum: {
    catalogId: "aluminum",
    color: "#b0b0b0",
    toonColor: "#b0b0b0",
    toonDeep: "#3e4a54",
    toonShadow: "#6a7886",
    toonHighlight: "#eef2f5",
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
   * the dropzone border — that's intentional.
   */
  position: readonly [number, number, number];
  scale: number;
  rotSpeed: readonly [number, number, number];
  floatAmp: number;
  floatSpeed: number;
  phase: number;
  /**
   * Starting Euler tilt. Omitted → derived from `phase` (the cube and
   * sphere). The triangle sets this explicitly so it stays face-on
   * enough to read as a triangle, not a tumbling wedge.
   */
  restRotation?: readonly [number, number, number];
  /**
   * Tailwind placement for the CSS stand-in (loading / no-WebGL).
   * Hang off the dashed well so the CSS stand-in also clips a little.
   */
  fallbackClass: string;
}

/**
 * Three primitives parked on the frame: steel cube left, resin sphere
 * right, PLA triangle along the bottom. Scale stays modest so the
 * silhouettes read; they may kiss the dashed well. `position` is a
 * fraction of the frustum (see field note). Rotation is slow on
 * purpose.
 */
export const DROPZONE_PRIMITIVES: readonly DropzonePrimitive[] = [
  {
    look: "steel",
    kind: "roundedBox",
    position: [-0.9, 0.08, -0.15],
    scale: 1.08,
    rotSpeed: [0.035, 0.08, 0.018],
    floatAmp: 0.08,
    floatSpeed: 0.7,
    phase: 0.4,
    fallbackClass:
      "-left-3 top-[18%] size-20 rounded-3xl sm:size-24",
  },
  {
    look: "resin",
    kind: "sphere",
    position: [0.9, 0.14, 0.05],
    scale: 1.04,
    rotSpeed: [0.025, 0.055, 0.012],
    floatAmp: 0.1,
    floatSpeed: 0.85,
    phase: 1.2,
    fallbackClass: "-right-3 top-[14%] size-20 rounded-full sm:size-24",
  },
  {
    look: "pla",
    kind: "roundedTriangle",
    // Bottom edge, slightly right of the copy — its own slot.
    position: [0.22, -0.62, 0.12],
    scale: 1.06,
    rotSpeed: [0.006, 0.035, 0.004],
    floatAmp: 0.04,
    floatSpeed: 0.55,
    phase: 0.2,
    restRotation: [0.08, 0.18, 0],
    fallbackClass:
      "-bottom-3 right-[24%] h-20 w-[4.5rem] [clip-path:polygon(50%_2%,56%_8%,97%_88%,90%_100%,10%_100%,3%_88%,44%_8%)] sm:h-24 sm:w-[5.25rem]",
  },
];
