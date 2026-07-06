/**
 * Component / interface cutout reference for the design brief
 * (docs/text-to-cad/06 part 1, open question 2) — a hand-curated table
 * mapping `interfaces[].std` ids to real cutout dimensions, so "USB-C on +X"
 * becomes a correctly-sized hole instead of a guess. Same license posture as
 * fasteners.ts: dimensions are uncopyrightable facts, re-tabled in our own
 * values with print clearance already applied.
 *
 * Screw sizes (M2–M6) resolve through METRIC_FASTENERS so there is exactly
 * one source of truth for clearance/pilot numbers.
 */

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
