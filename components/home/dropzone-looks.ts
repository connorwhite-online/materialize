/**
 * Catalog colours for the authed-home dropzone primitives.
 *
 * Inlined (rather than imported from `lib/materials`) so the home
 * client chunk doesn't pull the full editorial preset library. A test
 * pins each `catalogId` + colour against the real catalog / hero
 * overrides so these can't drift silently. Shade is a soft colored
 * toon gradient (`toonShadow` / `toonColor` / `toonHighlight`); metalness
 * and transmission stay on the object so the catalog pin still
 * matches the row, but they are not used at draw time.
 */
export type DropzoneLook = {
  catalogId: string;
  color: string;
  /**
   * Pastel toon-gradient tints — purplish blue, pinkish red, yellowish
   * green. Quiet, but they have to read as colour, not grey.
   */
  toonColor: string;
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
    // Cube — pastel purplish blue.
    toonColor: "#8a86d4",
    toonShadow: "#5a54a8",
    toonHighlight: "#dcd8fa",
    metalness: 1,
    roughness: 0.35,
  },
  resin: {
    catalogId: "resin-standard",
    // Hero override — translucent cream, not the stock opaque resin.
    color: "#e6dfcc",
    // Sphere — pastel pinkish red.
    toonColor: "#e89490",
    toonShadow: "#c06068",
    toonHighlight: "#f8d4d6",
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
    toonHighlight: "#f6e3a4",
    metalness: 1,
    roughness: 0.15,
  },
  pla: {
    catalogId: "pla-white",
    // Hero override — warmer off-white so it holds a silhouette.
    color: "#c4bca8",
    // Triangle — pastel yellowish green.
    toonColor: "#c8d878",
    toonShadow: "#8aaa48",
    toonHighlight: "#eaf4c4",
    metalness: 0,
    roughness: 0.42,
    clearcoat: 0.25,
  },
  aluminum: {
    catalogId: "aluminum",
    color: "#b0b0b0",
    toonColor: "#b0b0b0",
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
 * Three chunky primitives parked on the edges so the copy in the
 * middle stays clear: steel cube, resin sphere, PLA rounded triangle.
 * Tuned for a wide, short dropzone (~2:1) with the camera at z ≈ 6.5,
 * fov 28. Rotation is slow on purpose — a leisurely turn, not a
 * tumble (`rotSpeed` is rad/s).
 */
export const DROPZONE_PRIMITIVES: readonly DropzonePrimitive[] = [
  {
    look: "steel",
    kind: "roundedBox",
    position: [-2.2, 0.08, -0.15],
    scale: 0.92,
    rotSpeed: [0.035, 0.08, 0.018],
    floatAmp: 0.08,
    floatSpeed: 0.7,
    phase: 0.4,
    fallbackClass:
      "left-[4%] top-[18%] size-16 rounded-3xl sm:size-[4.5rem]",
  },
  {
    look: "resin",
    kind: "sphere",
    position: [2.25, 0.14, 0.05],
    scale: 0.84,
    rotSpeed: [0.025, 0.055, 0.012],
    floatAmp: 0.1,
    floatSpeed: 0.85,
    phase: 1.2,
    fallbackClass: "right-[5%] top-[14%] size-16 rounded-full sm:size-[4.25rem]",
  },
  {
    look: "pla",
    kind: "roundedTriangle",
    position: [1.9, -0.48, 0.12],
    scale: 0.82,
    rotSpeed: [0.04, 0.07, 0.02],
    floatAmp: 0.06,
    floatSpeed: 0.55,
    phase: 0.9,
    fallbackClass:
      "right-[6%] bottom-[5%] h-[3.5rem] w-12 [clip-path:polygon(50%_0%,62%_8%,96%_86%,86%_100%,14%_100%,4%_86%,38%_8%)]",
  },
];
