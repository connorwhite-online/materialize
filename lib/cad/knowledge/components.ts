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

/**
 * Dev-board reference table — true PCB dimensions and mounting facts for the
 * boards people most often ask for enclosures around. Exists so "ESP32
 * enclosure" gets REAL dims implied automatically (the brief must never ask
 * the user to confirm a guessed bounding box for a known board) and so the
 * code model learns facts like "DevKitC has no mounting holes."
 */
export interface DevBoard {
  id: string;
  label: string;
  aliases: string[];
  /** PCB length x width x thickness, mm. */
  boardMm: [number, number, number];
  /** Rectangular mounting-hole grid; null when the board has none. */
  holes: { dxMm: number; dyMm: number; diaMm: number } | null;
  holeNote?: string;
  /** USB connector (std id in COMPONENT_CUTOUTS) and the edge it exits. */
  usb?: { std: string; edge: "short-end" | "long-side" };
  /** Tallest component above the board top, mm. */
  tallestAboveMm?: number;
  /** Pin/lead protrusion below the board, mm. */
  pinsBelowMm?: number;
  note?: string;
}

export const DEV_BOARDS: Record<string, DevBoard> = {
  pico: {
    id: "pico",
    label: "Raspberry Pi Pico",
    aliases: ["raspberry pi pico", "rpi pico", "pico w", "pico 2", "pico2"],
    boardMm: [51.0, 21.0, 1.0],
    holes: { dxMm: 47.0, dyMm: 11.4, diaMm: 2.1 },
    usb: { std: "micro-usb", edge: "short-end" },
    tallestAboveMm: 3.0,
    pinsBelowMm: 0,
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
    boardMm: [55.0, 28.0, 1.6],
    holes: null,
    holeNote:
      "most DevKitC boards have NO mounting holes — locate with a perimeter shelf + corner posts or clips, never screws",
    usb: { std: "micro-usb", edge: "short-end" },
    tallestAboveMm: 3.5,
    pinsBelowMm: 3.0,
    note: "newer clones ship USB-C instead of micro-USB — worth a question when the variant is unknown",
  },
  "arduino-uno": {
    id: "arduino-uno",
    label: "Arduino Uno",
    aliases: ["uno", "arduino uno r3", "uno r3", "arduino-uno-r3"],
    boardMm: [68.6, 53.4, 1.6],
    holes: null,
    holeNote:
      "irregular 4-hole M3 pattern at (14.0, 2.5), (15.3, 50.7), (66.1, 7.6), (66.1, 35.5) from the USB-corner origin",
    usb: { std: "usb-b", edge: "short-end" },
    tallestAboveMm: 11.0,
    pinsBelowMm: 3.0,
    note: "USB-B and the barrel jack exit the same short end; both overhang the board edge slightly",
  },
  "arduino-nano": {
    id: "arduino-nano",
    label: "Arduino Nano",
    aliases: ["nano", "arduino nano every", "nano every"],
    boardMm: [45.0, 18.0, 1.6],
    holes: { dxMm: 43.2, dyMm: 15.2, diaMm: 1.8 },
    usb: { std: "mini-usb", edge: "short-end" },
    tallestAboveMm: 3.5,
    pinsBelowMm: 3.0,
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

/** One line per board for the brief system prompt — true dims, no guessing. */
export function formatBoardCatalog(): string {
  const lines = Object.values(DEV_BOARDS).map((b) => {
    const bits = [
      `${b.label}: PCB ${b.boardMm.join(" x ")} mm`,
      b.holes
        ? `holes ${b.holes.dxMm} x ${b.holes.dyMm} grid, D${b.holes.diaMm}`
        : (b.holeNote ?? "no mounting holes"),
      b.usb ? `${b.usb.std} on a ${b.usb.edge.replace("-", " ")}` : null,
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
      if (board.usb) {
        const cut = componentCutoutFor(board.usb.std);
        if (cut) cutouts.set(cut.id, cut);
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
      b.holes
        ? `mounting holes ${b.holes.dxMm} x ${b.holes.dyMm} grid, D${b.holes.diaMm}`
        : (b.holeNote ?? "no mounting holes"),
      b.usb ? `${b.usb.std} exits a ${b.usb.edge.replace("-", " ")}` : null,
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
