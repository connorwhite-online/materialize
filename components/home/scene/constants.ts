import type { MaterialMetadata } from "@/lib/materials/preset-library";
import { MATERIALS } from "@/lib/materials";

/**
 * Shared constants for the scroll-driven anon-home 3D scene.
 *
 * The home page scrolls through a fixed sequence of full-viewport
 * "stages". A single persistent <Canvas> stays pinned behind the
 * scrolling text and morphs the device as the reader moves from one
 * stage to the next. `progress` (0 → STAGE_COUNT-1) is the raw scroll
 * position in stage units; `stage` is the eased value the scene
 * actually renders. See scene-controller.tsx.
 */

export const STAGE = {
  HERO: 0,
  MATERIALS: 1,
  COMMERCE: 2,
  TEARDOWN: 3,
  FOOTER: 4,
} as const;

export type StageId = (typeof STAGE)[keyof typeof STAGE];

export const STAGE_COUNT = 5;
export const MAX_STAGE = STAGE_COUNT - 1;

/**
 * Triangular weight for a stage: 1 when `stage` sits exactly on
 * `center`, ramping linearly to 0 one stage away in either direction.
 * Used by each scene element to fade/scale itself in and out as the
 * eased stage value sweeps past its section.
 */
export function stageWeight(stage: number, center: number): number {
  return Math.max(0, 1 - Math.abs(stage - center));
}

/** Smoothstep 0→1 across [edge0, edge1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const findMaterial = (id: string): MaterialMetadata => {
  const hit = MATERIALS.find((m) => m.id === id);
  if (!hit) throw new Error(`scene/constants: missing material ${id}`);
  return hit;
};

/**
 * The three materials fanned out on swatches in the Materials stage.
 * Picked to read as visually distinct under camera-front lighting:
 * a warm matte plastic, a polished metal, and a translucent resin.
 */
export const SWATCH_MATERIALS: MaterialMetadata[] = [
  {
    ...findMaterial("pla-white"),
    name: "Plastics",
    color: "#cdbfa6",
    pbr: { metalness: 0, roughness: 0.5, clearcoat: 0.2 },
  },
  {
    ...findMaterial("aluminum"),
    name: "Alloys",
    color: "#c7ccd2",
    pbr: { metalness: 0.92, roughness: 0.32 },
  },
  {
    ...findMaterial("resin-standard"),
    name: "Resin",
    color: "#e7e0cd",
    pbr: {
      metalness: 0,
      roughness: 0.08,
      clearcoat: 0.9,
      transmission: 0.86,
      ior: 1.5,
      thickness: 1.1,
    },
  },
];

/** Default material the lone device wears in the hero / commerce stages. */
export const DEVICE_DEFAULT_MATERIAL: MaterialMetadata = {
  ...findMaterial("aluminum"),
  name: "Aluminum",
  color: "#c4c9cf",
  pbr: { metalness: 0.9, roughness: 0.34, clearcoat: 0.15 },
};

/** Classic dollar-store price-sticker yellow. */
export const STICKER_YELLOW = "#f4c20d";

/**
 * Pneuma teardown parts — the internal components revealed when the
 * device "explodes" in the Teardown stage. Positions are in the
 * device's local space.
 *
 * Form: a 60×40×10 soft slab whose +X half swells to 20mm to house the
 * component stack; the battery lives flat in the −X half. Scale is
 * 40mm = 1 unit, so the footprint is 1.5 (X) × 1.0 (Y) and the slab is
 * 0.25 thick (Z, toward camera), the hump reaching ~0.5.
 *
 * Sourced from the pneuma repo BOM: nRF52840-class wake MCU, a
 * Rockchip RV1106-class Linux SoC, a Quectel EG915U LTE modem, a MIPI
 * camera, a LiPo battery, mic + micro-speaker, haptic motor.
 */
export interface TeardownPart {
  id: string;
  label: string;
  /** Resting position inside the assembled device. */
  rest: [number, number, number];
  /** Direction × magnitude the part slides out per explode unit. */
  explode: [number, number, number];
  /** Which side the leader-line label sits on. */
  labelSide: "left" | "right";
  /** Vertical offset (device units) of the label anchor. */
  labelY: number;
  /** Show the GitHub mark next to the label (the firmware target). */
  github?: boolean;
}

export const TEARDOWN_PARTS: TeardownPart[] = [
  {
    id: "soc",
    label: "Linux SoC · Firmware",
    rest: [0.3, 0.05, 0.09],
    explode: [0.05, 0.2, 1.3],
    labelSide: "right",
    labelY: 0.35,
    github: true,
  },
  {
    id: "mcu",
    label: "Wake MCU",
    rest: [0.1, 0.3, 0.08],
    explode: [-0.15, 0.85, 1.0],
    labelSide: "left",
    labelY: 0.7,
  },
  {
    id: "modem",
    label: "LTE Modem",
    rest: [0.55, -0.22, 0.08],
    explode: [0.7, -0.45, 1.0],
    labelSide: "right",
    labelY: -0.05,
  },
  {
    id: "camera",
    label: "Camera",
    rest: [0.5, 0.28, 0.16],
    explode: [0.45, 0.7, 1.15],
    labelSide: "right",
    labelY: 0.95,
  },
  {
    id: "battery",
    label: "Battery",
    rest: [-0.34, 0, 0.0],
    explode: [-1.25, -0.05, 0.25],
    labelSide: "left",
    labelY: 0.0,
  },
  {
    id: "speaker",
    label: "Speaker · Haptics",
    rest: [-0.12, -0.3, 0.05],
    explode: [-0.45, -0.9, 0.75],
    labelSide: "left",
    labelY: -0.6,
  },
];
