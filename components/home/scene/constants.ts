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
  TEARDOWN: 2,
  COMMERCE: 3,
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
 * Shared orientation for the COMMERCE stage so the lone device and the
 * box that encloses it stay aligned while viewed at a slight angle —
 * the yaw is what makes the carton's side walls read as 3D depth.
 */
export const COMMERCE_YAW = -0.5;
// Reclined further back so the device lies down into the (shallow) mold
// rather than standing up in it. Shared by the device + tray so they
// stay aligned.
export const COMMERCE_PITCH = -0.72;

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
  /** Short model spec shown under the label (e.g. "nRF52840"). */
  sub?: string;
  /**
   * Resting position as a FRACTION of the shell size [x=width, y=height,
   * z=thickness]; resolved against the loaded geometry in DeviceModel.
   */
  rest: [number, number, number];
  /**
   * Layer index along the single explode axis (device-local +Z /
   * thickness). Lower = deeper in the stack.
   */
  order: number;
  /** Which side the leader-line label sits on. */
  labelSide: "left" | "right";
  /** Label anchor height as a fraction of the shell height. */
  labelY: number;
  /** Show the GitHub mark next to the label (the firmware target). */
  github?: boolean;
  /** Optional external link for the label (pneuma repo / BOM). */
  href?: string;
}

/** Layer index assigned to the mainboard (it sits between cells + chips). */
export const PCB_ORDER = 1.5;
/** Centre of the order range, so the exploded stack stays centred. */
export const ORDER_CENTER = 2.5;
/** Spacing (scene units) between adjacent layers along the explode axis. */
export const EXPLODE_SPACING = 0.38;

const PNEUMA_REPO = "https://github.com/connorwhite-online/pneuma";
const PNEUMA_BOM =
  "https://github.com/connorwhite-online/pneuma/blob/main/hardware/BOM.md";

// Real components + dimensions from the pneuma BOM; geometry is sized in
// mm against the shell (see DeviceModel). Positions are fractional.
export const TEARDOWN_PARTS: TeardownPart[] = [
  {
    id: "battery",
    label: "Battery",
    sub: "2000 mAh",
    rest: [0, -0.05, -0.2],
    order: 0,
    labelSide: "left",
    labelY: -0.18,
    href: PNEUMA_BOM,
  },
  {
    id: "speaker",
    label: "Speaker",
    sub: "18 mm · haptics",
    rest: [0, -0.38, 0.06],
    order: 1,
    labelSide: "left",
    labelY: -0.4,
    href: PNEUMA_BOM,
  },
  {
    id: "modem",
    label: "LTE Modem",
    sub: "EG915U",
    rest: [0.13, -0.16, 0.18],
    order: 2,
    labelSide: "right",
    labelY: -0.14,
    href: PNEUMA_BOM,
  },
  {
    id: "mcu",
    label: "Wake MCU",
    sub: "nRF52840",
    rest: [-0.15, 0.08, 0.18],
    order: 3,
    labelSide: "left",
    labelY: 0.1,
    href: PNEUMA_BOM,
  },
  {
    id: "soc",
    label: "Firmware",
    sub: "RV1106G3",
    rest: [0.08, 0.13, 0.18],
    order: 4,
    labelSide: "right",
    labelY: 0.0,
    github: true,
    href: PNEUMA_REPO,
  },
  {
    id: "camera",
    label: "Camera",
    sub: "SC3336 · 3MP",
    rest: [0, 0.4, 0.24],
    order: 5,
    labelSide: "right",
    labelY: 0.42,
    href: PNEUMA_BOM,
  },
];
