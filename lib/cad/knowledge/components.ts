/**
 * Component / interface cutout reference for the design brief
 * (docs/text-to-cad/06 part 1, open question 2) — a tiny hand-curated table
 * mapping `interfaces[].std` ids to real cutout dimensions, so "USB-C on +X"
 * becomes a correctly-sized hole instead of a guess. Same license posture as
 * fasteners.ts: dimensions are uncopyrightable facts, re-tabled in our own
 * values with print clearance already applied.
 *
 * Screw sizes (M2–M6) resolve through METRIC_FASTENERS so there is exactly
 * one source of truth for clearance/pilot numbers.
 */

import type { CadBrief } from "../brief";
import type { DimensionTarget } from "../dimension-check";
import { METRIC_FASTENERS, type MetricFastener } from "./fasteners";

export interface ComponentCutout {
  /** Canonical std id (what the brief should use). */
  id: string;
  label: string;
  /** Alternate spellings the brief/model may emit. */
  aliases: string[];
  /** Wall cutout width x height (mm), print clearance included. */
  cutoutWMm: number;
  cutoutHMm: number;
  /** Connector body depth behind the wall face, when it matters. */
  bodyDepthMm?: number;
  note?: string;
}

export const COMPONENT_CUTOUTS: Record<string, ComponentCutout> = {
  "usb-c": {
    id: "usb-c",
    label: "USB-C",
    aliases: ["usbc", "usb c", "type-c", "type c", "usb-type-c"],
    cutoutWMm: 9.6,
    cutoutHMm: 3.8,
    bodyDepthMm: 7.5,
    note: "receptacle 8.94 x 3.26; center the cutout on the connector, plug overmold needs ~12 x 6.5 outside the wall",
  },
  "usb-a": {
    id: "usb-a",
    label: "USB-A",
    aliases: ["usba", "usb a", "type-a", "type a"],
    cutoutWMm: 14.0,
    cutoutHMm: 6.5,
    bodyDepthMm: 14.0,
    note: "receptacle 13.15 x 5.7",
  },
  "micro-usb": {
    id: "micro-usb",
    label: "micro-USB",
    aliases: ["microusb", "micro usb", "micro-b", "usb-micro"],
    cutoutWMm: 8.4,
    cutoutHMm: 3.4,
    bodyDepthMm: 6.0,
    note: "receptacle 7.5 x 2.5",
  },
  "barrel-jack-5.5": {
    id: "barrel-jack-5.5",
    label: "5.5 mm barrel jack",
    aliases: [
      "barrel jack",
      "barrel-jack",
      "dc jack",
      "dc-jack",
      "barrel jack 5.5mm",
      "5.5mm barrel jack",
      "barrel",
    ],
    cutoutWMm: 8.0,
    cutoutHMm: 8.0,
    bodyDepthMm: 14.0,
    note: "round 8.0 dia panel hole (5.5 x 2.1 panel-mount jack); plug body ~10 dia needs clearance outside the wall",
  },
  rj45: {
    id: "rj45",
    label: "RJ45 (Ethernet)",
    aliases: ["ethernet", "rj-45", "lan"],
    cutoutWMm: 16.5,
    cutoutHMm: 14.0,
    bodyDepthMm: 21.0,
    note: "jack ~16.0 x 13.5, latch on top — leave finger room above",
  },
  sd: {
    id: "sd",
    label: "SD card slot",
    aliases: ["sd-card", "sd card", "sdcard", "microsd", "micro-sd", "micro sd"],
    cutoutWMm: 25.0,
    cutoutHMm: 3.0,
    note: "full-size SD card is 24.0 x 2.1; microSD is 11.0 x 1.0 (cutout 12.0 x 2.0)",
  },
  "usb-b": {
    id: "usb-b",
    label: "USB-B",
    aliases: ["usbb", "usb b", "type-b", "usb type b", "printer usb"],
    cutoutWMm: 13.5,
    cutoutHMm: 12.5,
    bodyDepthMm: 16.0,
    note: "receptacle 12.5 x 11.3 (Arduino Uno style)",
  },
  "mini-usb": {
    id: "mini-usb",
    label: "mini-USB",
    aliases: ["miniusb", "mini usb", "mini-b", "usb-mini"],
    cutoutWMm: 8.6,
    cutoutHMm: 5.0,
    bodyDepthMm: 9.0,
    note: "receptacle 7.7 x 4.4 (Arduino Nano style)",
  },
};

// ---------------------------------------------------------------------------
// Component mechanical schema (MTR-204, shaped for the MTR-203 registry).
//
// COMPONENT FRAME convention (every position below uses it):
//   origin  = center of the PCB/body footprint
//   +x      = along the LENGTH (the longer footprint axis)
//   +y      = along the width
//   z       = up; exit heights are measured above the PCB TOP face.
// The fit verifier (cad-runner/fit.py) solves the component's actual pose
// inside the built mesh, trying all four flat rotations — so the ±x choice for
// "which end the USB is on" is a convention, not an assertion.
// ---------------------------------------------------------------------------

/** Where a mechanical fact set came from, and whether it was actually read. */
export interface ComponentProvenance {
  /** URL of the mechanical source actually consulted. */
  sourceUrl: string;
  /** Document/file revision or snapshot identifier at that source. */
  docRevision: string;
  /** ISO date the source was last checked. */
  dateChecked: string;
  /**
   * True when the positions in the entry were read off the cited source.
   * False = envelope-level facts only; positional fields are absent or
   * marked `approx` and MUST NOT be fit-enforced.
   */
  verified: boolean;
  note?: string;
}

/** One mounting hole, component frame, mm. */
export interface MountingHole {
  xMm: number;
  yMm: number;
  diaMm: number;
}

/**
 * How the component fixes to the enclosure. Discriminated union so actuators
 * (flange/tab mounts, MTR-203) join without a schema migration.
 */
export type ComponentMounting =
  | { kind: "hole-pattern"; holes: MountingHole[]; note?: string }
  | {
      /** Flange/tab mounting (servos etc.) — MTR-203 fills these in. */
      kind: "flange";
      holes?: MountingHole[];
      flangeThicknessMm?: number;
      note?: string;
    }
  | { kind: "none"; note?: string };

/** Everything the enclosure must open up or leave room for (MTR-203). */
export type ComponentExitKind =
  | "connector"
  | "shaft"
  | "lens"
  | "screen_window"
  | "button"
  | "vent";

/** A lateral component edge, component frame (see convention above). */
export type ComponentEdge = "+x" | "-x" | "+y" | "-y";

export interface ComponentExit {
  kind: ComponentExitKind;
  /** COMPONENT_CUTOUTS std id when kind is "connector". */
  std?: string;
  /** Edge/face the exit lives on. */
  edge: ComponentEdge;
  /** Offset of the exit center along that edge, from the edge midpoint, mm. */
  offsetMm: number;
  /** Exit center height above the PCB top face, mm. */
  heightMm?: number;
  /** Opening size when it differs from the std cutout (w along edge, h up). */
  dims?: { wMm: number; hMm: number };
  /** Protrusion direction when not the edge's outward normal (e.g. "+z"). */
  direction?: ComponentEdge | "+z" | "-z";
  /**
   * Position is nominal (not read off a verified drawing): still shown in
   * prompt hints, but NEVER fit-enforced — see ComponentProvenance.verified.
   */
  approx?: boolean;
  note?: string;
}

/** Stack composition placeholders (MTR-203: drape consumes component STACKS). */
export interface ComponentStacking {
  /** Component id this part usually sits on / plugs into. */
  sitsOn?: string;
  /** Header/socket height between the two boards, mm. */
  headerHeightMm?: number;
  /** Extra clearance to leave above this part, mm. */
  clearanceAboveMm?: number;
}

/**
 * Dev-board reference table — true PCB dimensions and mounting facts for the
 * boards people most often ask for enclosures around. Exists so "ESP32
 * enclosure" gets REAL dims implied automatically (the brief must never ask
 * the user to confirm a guessed bounding box for a known board), so the code
 * model learns facts like "DevKitC has no mounting holes", and — since
 * MTR-204 — so the sidecar can VERIFY the built enclosure actually fits the
 * board (cavity, bosses, cutouts) instead of trusting the prompt.
 */
export interface DevBoard {
  id: string;
  label: string;
  aliases: string[];
  /** PCB length x width x thickness, mm. */
  boardMm: [number, number, number];
  /** Mounting interface; positions in the component frame. */
  mounting: ComponentMounting;
  /** Ports and other openings the enclosure must accommodate. */
  exits: ComponentExit[];
  /** Tallest component above the board top, mm. */
  tallestAboveMm?: number;
  /** Pin/lead protrusion below the board, mm. */
  pinsBelowMm?: number;
  /** Stack composition placeholders (MTR-203). */
  stacking?: ComponentStacking;
  /** Source of the mechanical facts + whether positions were verified. */
  provenance?: ComponentProvenance;
  note?: string;
}

// Sources: the org egress policy blocks the vendor datasheet hosts
// (datasheets.raspberrypi.com, docs.arduino.cc, docs.espressif.com), so each
// entry cites the officially-published engineering source that WAS fetched and
// measured for this table (KiCad official library footprints — CC-BY-SA with
// design exception, dims extracted as uncopyrightable facts; Espressif's
// dimension drawing from the esp-idf docs). The canonical vendor document is
// named in the note so a later pass can re-verify against it directly.
export const DEV_BOARDS: Record<string, DevBoard> = {
  pico: {
    id: "pico",
    label: "Raspberry Pi Pico",
    aliases: ["raspberry pi pico", "rpi pico", "pico w", "pico 2", "pico2"],
    boardMm: [51.0, 21.0, 1.0],
    mounting: {
      kind: "hole-pattern",
      // 47.0 x 11.4 grid: 2.0 mm from the short ends, 4.8 mm from long edges.
      holes: [
        { xMm: -23.5, yMm: -5.7, diaMm: 2.1 },
        { xMm: -23.5, yMm: 5.7, diaMm: 2.1 },
        { xMm: 23.5, yMm: -5.7, diaMm: 2.1 },
        { xMm: 23.5, yMm: 5.7, diaMm: 2.1 },
      ],
      note: "M2 screws or push posts; holes are unplated",
    },
    exits: [
      {
        kind: "connector",
        std: "micro-usb",
        edge: "-x",
        offsetMm: 0,
        heightMm: 1.3,
        note: "centered on the short end, overhangs the PCB edge ~1.3; height is the connector centerline (shell ~2.5 tall)",
      },
    ],
    tallestAboveMm: 3.0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Module.pretty/RaspberryPi_Pico_Common_Unspecified.kicad_mod",
      docRevision: "kicad-footprints master (F.Fab outline 51x21 + 4x D2.1 fab circles at (±5.7, ±23.5))",
      dateChecked: "2026-07-05",
      verified: true,
      note: "canonical: Raspberry Pi Pico datasheet mechanical drawing (same figures); connector centerline height from the micro-B receptacle standard, ±0.5",
    },
    note: "castellated edges; fitted headers add ~3 below the board",
  },
  "esp32-devkitc": {
    id: "esp32-devkitc",
    label: "ESP32 DevKitC",
    aliases: [
      "esp32",
      "esp32 devkit",
      "esp32_devkit",
      "esp32-devkit",
      "esp32 dev board",
      "esp32 development board",
      "devkitc",
      "esp32-wroom-32",
      "nodemcu-32s",
    ],
    boardMm: [54.4, 27.9, 1.6],
    mounting: {
      kind: "none",
      note: "most DevKitC boards have NO mounting holes — locate with a perimeter shelf + corner posts or clips, never screws",
    },
    exits: [
      {
        kind: "connector",
        std: "micro-usb",
        edge: "-x",
        offsetMm: 0,
        heightMm: 1.3,
        // Espressif's dimensions drawing verifies the outline only; the port
        // offset is nominal (centered) — hint the model, don't fit-enforce.
        approx: true,
        note: "on the short end opposite the antenna; offset unverified (drawing covers outline only)",
      },
    ],
    tallestAboveMm: 3.5,
    pinsBelowMm: 3.0,
    provenance: {
      sourceUrl:
        "https://raw.githubusercontent.com/espressif/esp-idf/v4.4/docs/_static/esp32-devkitc-dimensions-back.jpg",
      docRevision: "esp-idf v4.4 ESP32-DevKitC V4 getting-started dimensions figure (54.4 x 27.9)",
      dateChecked: "2026-07-05",
      verified: false,
      note: "board outline verified from Espressif's own drawing; port position not stated there, so it stays approx",
    },
    note: "newer clones ship USB-C instead of micro-USB — worth a question when the variant is unknown",
  },
  "arduino-uno": {
    id: "arduino-uno",
    label: "Arduino Uno",
    aliases: ["uno", "arduino uno r3", "uno r3", "arduino-uno-r3"],
    boardMm: [68.58, 53.34, 1.6],
    mounting: {
      kind: "hole-pattern",
      // Irregular 4-hole pattern; corner-frame (from the USB-corner origin):
      // (13.97, 2.54), (15.24, 50.80), (66.04, 7.62), (66.04, 35.56).
      holes: [
        { xMm: -20.32, yMm: -24.13, diaMm: 3.2 },
        { xMm: -19.05, yMm: 24.13, diaMm: 3.2 },
        { xMm: 31.75, yMm: -19.05, diaMm: 3.2 },
        { xMm: 31.75, yMm: 8.89, diaMm: 3.2 },
      ],
      note: "M3 screws; the pattern is deliberately irregular — never mirror it",
    },
    exits: [
      {
        kind: "connector",
        std: "usb-b",
        edge: "-x",
        offsetMm: 11.43,
        heightMm: 5.5,
        note: "overhangs the edge ~6.4; height is the shell centerline (~10.9 tall), ±0.5",
      },
      {
        kind: "connector",
        std: "barrel-jack-5.5",
        edge: "-x",
        offsetMm: -19.05,
        heightMm: 5.5,
        note: "overhangs the edge ~1.9; height is the jack centerline, ±1",
      },
    ],
    tallestAboveMm: 11.0,
    pinsBelowMm: 3.0,
    provenance: {
      sourceUrl:
        "https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Module.pretty/Arduino_UNO_R3_WithMountingHoles.kicad_mod",
      docRevision:
        "kicad-footprints master (exact mil-grid NPTH + fab outlines matching Arduino's published UNO R3 Eagle design)",
      dateChecked: "2026-07-05",
      verified: true,
      note: "connector centerline heights from the USB-B / DC-021 jack standards, not the footprint",
    },
    note: "USB-B and the barrel jack exit the same short end; both overhang the board edge slightly",
  },
  "arduino-nano": {
    id: "arduino-nano",
    label: "Arduino Nano",
    aliases: ["nano", "arduino nano every", "nano every"],
    boardMm: [43.18, 17.78, 1.6],
    mounting: {
      kind: "hole-pattern",
      // 40.64 x 15.24 grid — every hole 1.27 mm in from its two edges.
      holes: [
        { xMm: -20.32, yMm: -7.62, diaMm: 1.78 },
        { xMm: -20.32, yMm: 7.62, diaMm: 1.78 },
        { xMm: 20.32, yMm: -7.62, diaMm: 1.78 },
        { xMm: 20.32, yMm: 7.62, diaMm: 1.78 },
      ],
    },
    exits: [
      {
        kind: "connector",
        std: "mini-usb",
        edge: "-x",
        offsetMm: 0,
        heightMm: 2.0,
        note: "centered on the short end, overhangs ~2.5; height is the shell centerline (~3.9 tall), ±0.5",
      },
    ],
    tallestAboveMm: 3.5,
    pinsBelowMm: 3.0,
    provenance: {
      sourceUrl:
        "https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Module.pretty/Arduino_Nano_WithMountingHoles.kicad_mod",
      docRevision:
        "kicad-footprints master (NPTH grid + F.Fab outline; PCB 43.18 x 17.78 — Arduino lists 45 x 18 INCLUDING the mini-USB overhang)",
      dateChecked: "2026-07-05",
      verified: true,
      note: "connector centerline height from the mini-B receptacle standard",
    },
  },
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Resolve a free-form component name ("ESP32_devkit", "raspberry pi pico")
 * to a dev-board row. Substring match on squashed forms so the model's
 * naming variance doesn't defeat the table.
 */
export function devBoardFor(name: string): DevBoard | null {
  const n = squash(name);
  if (!n) return null;
  for (const row of Object.values(DEV_BOARDS)) {
    for (const candidate of [row.id, row.label, ...row.aliases]) {
      const c = squash(candidate);
      if (n === c || n.includes(c)) return row;
    }
  }
  return null;
}

/**
 * Compact human/prompt description of a board's mounting interface.
 * Positions are in the component frame (origin board center, +x = length).
 */
function describeMounting(m: ComponentMounting): string {
  if (m.kind === "hole-pattern") {
    const dia = m.holes[0]?.diaMm;
    const uniformDia = m.holes.every((h) => h.diaMm === dia);
    const pts = m.holes.map((h) => `(${h.xMm}, ${h.yMm})`).join(", ");
    return (
      `${m.holes.length} mounting holes${uniformDia ? ` D${dia}` : ""} at ${pts} from board center` +
      (m.note ? ` — ${m.note}` : "")
    );
  }
  if (m.kind === "flange") return m.note ?? "flange/tab mount";
  return m.note ?? "no mounting holes";
}

/** Compact human/prompt description of one exit (port, shaft, window, …). */
function describeExit(e: ComponentExit): string {
  const what = e.std ?? e.kind;
  const where =
    e.edge === "+x" || e.edge === "-x" ? "a short end" : "a long side";
  const bits = [
    `${what} on ${where}`,
    e.offsetMm !== 0 ? `${Math.abs(e.offsetMm)} mm ${e.offsetMm > 0 ? "+" : "-"}y of center` : "centered",
    e.heightMm != null ? `center ${e.heightMm} above board top` : null,
    e.approx ? "(position approximate)" : null,
  ].filter(Boolean);
  return bits.join(", ");
}

/** One line per board for the brief system prompt — true dims, no guessing. */
export function formatBoardCatalog(): string {
  const lines = Object.values(DEV_BOARDS).map((b) => {
    const bits = [
      `${b.label}: PCB ${b.boardMm.join(" x ")} mm`,
      describeMounting(b.mounting),
      ...b.exits.map(describeExit),
      b.tallestAboveMm != null ? `parts to ${b.tallestAboveMm} above board` : null,
      b.pinsBelowMm ? `pins ${b.pinsBelowMm} below` : null,
    ].filter(Boolean);
    return `- ${bits.join("; ")}`;
  });
  return lines.join("\n");
}

/** Screw sizes the brief may reference via `std`/`mounts.screw` (e.g. "M2.5"). */
const SCREW_STD = /^m\s?(2\.5|2|3|4|5|6)$/i;

function normalize(std: string): string {
  return std.trim().toLowerCase();
}

/** Resolve a brief `std` string to a cutout row, tolerant of alias spellings. */
export function componentCutoutFor(std: string): ComponentCutout | null {
  const n = normalize(std);
  for (const row of Object.values(COMPONENT_CUTOUTS)) {
    if (row.id === n || row.aliases.includes(n)) return row;
  }
  return null;
}

/** Resolve a screw reference ("M3", "m2.5") to the fastener table row. */
export function screwFor(std: string): MetricFastener | null {
  const m = normalize(std).match(SCREW_STD);
  if (!m) return null;
  return METRIC_FASTENERS[`M${m[1]}`.replace(".", "_")] ?? null;
}

/**
 * Emit real cutout/hole dimensions for every `interfaces[].std` (and
 * `components[].mounts.screw`) the brief references. "" when nothing matches —
 * the harness appends this next to the brief so dims land in the prompt.
 */
export function formatComponentHints(brief: CadBrief): string {
  const cutouts = new Map<string, ComponentCutout>();
  const screws = new Map<string, MetricFastener>();
  const boards = new Map<string, DevBoard>();

  for (const comp of brief.components ?? []) {
    const board = devBoardFor(comp.name);
    if (board) {
      boards.set(board.id, board);
      for (const exit of board.exits) {
        if (exit.std) {
          const cut = componentCutoutFor(exit.std);
          if (cut) cutouts.set(cut.id, cut);
        }
      }
    }
  }

  for (const iface of brief.interfaces ?? []) {
    if (!iface.std) continue;
    const cut = componentCutoutFor(iface.std);
    if (cut) cutouts.set(cut.id, cut);
    const screw = screwFor(iface.std);
    if (screw) screws.set(screw.size, screw);
  }
  for (const comp of brief.components ?? []) {
    const screwRef = comp.mounts?.screw;
    if (typeof screwRef === "string") {
      const screw = screwFor(screwRef);
      if (screw) screws.set(screw.size, screw);
    }
  }

  if (cutouts.size === 0 && screws.size === 0 && boards.size === 0) return "";

  const lines = [
    "Interface cutout dimensions (mm) — use these exact sizes, do not guess:",
  ];
  for (const b of boards.values()) {
    const bits = [
      `PCB ${b.boardMm.join(" x ")}`,
      describeMounting(b.mounting),
      ...b.exits.map(describeExit),
      b.tallestAboveMm != null
        ? `components to ${b.tallestAboveMm} above the board`
        : null,
      b.pinsBelowMm ? `pins ${b.pinsBelowMm} below` : null,
      b.note,
    ].filter(Boolean);
    lines.push(`- ${b.label} board: ${bits.join("; ")}`);
  }
  for (const c of cutouts.values()) {
    lines.push(
      `- ${c.label}: cutout ${c.cutoutWMm} x ${c.cutoutHMm}` +
        (c.bodyDepthMm ? `, body depth ${c.bodyDepthMm} behind the wall` : "") +
        (c.note ? ` (${c.note})` : "")
    );
  }
  for (const s of screws.values()) {
    lines.push(
      `- ${s.size} screws: clearance hole ${s.clearanceHoleMm}, tapped/self-tap pilot ${s.tapDrillMm}, heat-set insert bore ${s.heatSetBoreMm}`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fit contract (MTR-204): auto-emitted fit targets for known components.
// ---------------------------------------------------------------------------

/**
 * The component spec the sidecar fit verifier (cad-runner/fit.py) consumes.
 * Carried on the `fit_cavity` target's `fit` field; the sibling boss/cutout
 * targets reference it by component id. All mm, component frame (see the
 * schema comment above).
 */
export interface ComponentFitSpec {
  id: string;
  label: string;
  boardMm: [number, number, number];
  /** Air gap required around the component footprint (from the brief). */
  clearanceMm: number;
  /** Tallest part above the PCB top. */
  aboveMm: number;
  /** Pin/lead protrusion below the PCB bottom (not yet fit-enforced). */
  belowMm: number;
  /** Mounting-hole pattern to match bosses against; null = none. */
  holes: { positions: [number, number][]; diaMm: number } | null;
  /** Ports that must have a through-opening (verified positions only). */
  ports: {
    id: string;
    edge: ComponentEdge;
    offsetMm: number;
    heightMm: number;
    wMm: number;
    hMm: number;
  }[];
}

/** Default air gap around a component when the brief doesn't state one. */
const DEFAULT_CLEARANCE_MM = 1.0;

/** Build the sidecar fit spec for one board (+ the brief's clearance). */
export function fitSpecForBoard(
  board: DevBoard,
  clearanceMm?: number | null
): ComponentFitSpec {
  const holes =
    board.mounting.kind === "hole-pattern" && board.mounting.holes.length > 0
      ? {
          positions: board.mounting.holes.map(
            (h) => [h.xMm, h.yMm] as [number, number]
          ),
          // Conservative: verify against the largest hole in the pattern.
          diaMm: Math.max(...board.mounting.holes.map((h) => h.diaMm)),
        }
      : null;
  const ports = board.exits
    .filter((e) => e.kind === "connector" && !e.approx && e.std)
    .flatMap((e) => {
      const cut = componentCutoutFor(e.std!);
      const wMm = e.dims?.wMm ?? cut?.cutoutWMm;
      const hMm = e.dims?.hMm ?? cut?.cutoutHMm;
      if (wMm == null || hMm == null) return [];
      return [
        {
          id: e.std!,
          edge: e.edge,
          offsetMm: e.offsetMm,
          heightMm: e.heightMm ?? 0,
          wMm,
          hMm,
        },
      ];
    });
  return {
    id: board.id,
    label: board.label,
    boardMm: board.boardMm,
    clearanceMm: clearanceMm ?? DEFAULT_CLEARANCE_MM,
    aboveMm: board.tallestAboveMm ?? 0,
    belowMm: board.pinsBelowMm ?? 0,
    holes,
    ports,
  };
}

/**
 * Emit machine-checkable FIT targets for every known component the brief
 * names (MTR-204): cavity containment, boss↔hole pattern match, cutout↔port
 * alignment. These ride the exact same per-target pass/fail → repair-hint
 * machinery as the MTR-197 dimension targets (lib/cad/dimension-check.ts);
 * the sidecar evaluates them against the real built mesh, and targets it
 * didn't evaluate report `ran: false` (honesty rail) — never "verified".
 *
 * Only VERIFIED positions are enforced: an entry whose provenance couldn't be
 * checked keeps its hints but emits no boss/cutout targets (`approx` exits are
 * skipped in fitSpecForBoard).
 */
export function fitTargetsForBrief(brief: CadBrief): DimensionTarget[] {
  const targets: DimensionTarget[] = [];
  const seen = new Set<string>();
  for (const comp of brief.components ?? []) {
    const board = devBoardFor(comp.name);
    if (!board || seen.has(board.id)) continue;
    seen.add(board.id);
    const clearance = typeof comp.clearance === "number" ? comp.clearance : null;
    const spec = fitSpecForBoard(board, clearance);

    targets.push({
      label: `${board.label} cavity fit (board + ${spec.clearanceMm} mm clearance)`,
      kind: "fit_cavity",
      id: `fit:${board.id}:cavity`,
      value: 1,
      tolerance: 0,
      fit: spec,
    });
    if (spec.holes) {
      targets.push({
        label: `${board.label} mounting bosses (${spec.holes.positions.length}-hole pattern)`,
        kind: "fit_bosses",
        id: `fit:${board.id}:bosses`,
        value: spec.holes.positions.length,
        tolerance: 0,
        fit: { component: board.id },
      });
    }
    for (const port of spec.ports) {
      targets.push({
        label: `${board.label} ${port.id} cutout (${port.wMm} x ${port.hMm} mm)`,
        kind: "fit_cutout",
        id: `fit:${board.id}:port:${port.id}`,
        value: 1,
        tolerance: 0,
        fit: { component: board.id },
      });
    }
  }
  return targets;
}
