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
};

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

  if (cutouts.size === 0 && screws.size === 0) return "";

  const lines = [
    "Interface cutout dimensions (mm) — use these exact sizes, do not guess:",
  ];
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
