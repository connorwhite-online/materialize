import type { ComponentSpec } from "./schema";

/**
 * Dev-board reference table (MTR-203 caps boards at ~8 — the peripherals are
 * the long tail; see the sibling category files).
 *
 * Sources: the org egress policy blocks the vendor datasheet hosts
 * (datasheets.raspberrypi.com, docs.arduino.cc, docs.espressif.com,
 * raspberrypi.com, adafruit.com product pages), so each entry cites the
 * officially-published engineering source that WAS fetched and measured for
 * this table (KiCad official library footprints — CC-BY-SA with design
 * exception, dims extracted as uncopyrightable facts; Adafruit_CAD_Parts
 * STEP models — MIT; Raspberry Pi's HAT/uHAT mechanical specs — BSD-3 repo;
 * Seeed's wiki sources — CC BY-SA). The canonical vendor document is named in
 * the note so a later pass can re-verify against it directly.
 *
 * Raspberry Pi 5 is deliberately absent: every fetchable official mechanical
 * source for the full-size Pi 5 outline was unreachable (datasheets host
 * 403s, no KiCad footprint exists) — do not add it from memory.
 */
export const DEV_BOARDS: Record<string, ComponentSpec> = {
  pico: {
    id: "pico",
    label: "Raspberry Pi Pico",
    category: "board",
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
    category: "board",
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
    keepOuts: [
      {
        kind: "antenna",
        note: "PCB antenna occupies the last ~6 mm of the +x end — no metal and ideally no thick plastic directly over it",
      },
    ],
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
    category: "board",
    aliases: ["uno", "arduino uno r3", "uno r3", "arduino-uno-r3", "uno r4", "arduino uno r4"],
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
      note: "connector centerline heights from the USB-B / DC-021 jack standards, not the footprint. R4 keeps the R3 outline/holes but swaps USB-B for USB-C",
    },
    note: "USB-B and the barrel jack exit the same short end; both overhang the board edge slightly. Uno R4 has USB-C at the same corner",
  },
  "arduino-nano": {
    id: "arduino-nano",
    label: "Arduino Nano",
    category: "board",
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
  feather: {
    id: "feather",
    label: "Adafruit Feather",
    category: "board",
    aliases: [
      "adafruit feather",
      "feather rp2040",
      "feather m0",
      "feather m4",
      "feather esp32",
      "esp32 feather",
      "huzzah32",
      "feather nrf52840",
    ],
    boardMm: [50.8, 22.86, 1.6],
    mounting: {
      kind: "hole-pattern",
      // Feather form-factor: holes 0.1" in from each corner, 45.72 x 17.78 grid.
      holes: [
        { xMm: -22.86, yMm: -8.89, diaMm: 2.5 },
        { xMm: -22.86, yMm: 8.89, diaMm: 2.5 },
        { xMm: 22.86, yMm: -8.89, diaMm: 2.5 },
        { xMm: 22.86, yMm: 8.89, diaMm: 2.5 },
      ],
      note: "M2.5 screws; the 45.72 x 17.78 grid is common to every Feather",
    },
    exits: [
      {
        kind: "connector",
        std: "usb-c",
        edge: "-x",
        offsetMm: 0,
        heightMm: 1.6,
        note: "centered on the short end, overhangs the PCB edge ~1.2; RP2040/ESP32-S2+ Feathers are USB-C, classic M0/32u4/HUZZAH32 are micro-USB (same location)",
      },
    ],
    tallestAboveMm: 4.8,
    pinsBelowMm: 0,
    stacking: {
      clearanceAboveMm: 9,
      note: "FeatherWings stack on top via 0.1\" headers (~8.5 board-to-board with stacking headers)",
    },
    provenance: {
      sourceUrl:
        "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Module.pretty/Adafruit_Feather_WithMountingHoles.kicad_mod",
      docRevision:
        "kicad-footprints master (F.Fab outline 50.8 x 22.86, 4x NPTH drill 2.5 at (±22.86, ±8.89)); cross-checked against Adafruit_CAD_Parts '4884 Feather RP2040.step' (MIT) — PCB 50.8 x 22.86 x 1.57, holes dia 2.5 at (±22.86, ±8.89), exact agreement",
      dateChecked: "2026-07-06",
      verified: true,
      note: "canonical: Adafruit Feather specification (learn.adafruit.com); tallestAboveMm/USB height measured from the RP2040 STEP (overall 6.38 incl. PCB)",
    },
    note: "the form factor is shared across the whole Feather family; radios (RFM/LoRa) add an antenna keep-out at the +x end",
  },
  "pi-zero-2w": {
    id: "pi-zero-2w",
    label: "Raspberry Pi Zero 2 W",
    category: "board",
    aliases: [
      "pi zero",
      "raspberry pi zero",
      "raspberry pi zero 2 w",
      "pi zero 2",
      "pi zero w",
      "rpi zero",
      "pi zero 2w",
    ],
    boardMm: [65.0, 30.0, 1.6],
    mounting: {
      kind: "hole-pattern",
      // uHAT-spec grid: 58.0 x 23.0, holes 3.5 mm in from each board edge.
      holes: [
        { xMm: -29.0, yMm: -11.5, diaMm: 2.75 },
        { xMm: -29.0, yMm: 11.5, diaMm: 2.75 },
        { xMm: 29.0, yMm: -11.5, diaMm: 2.75 },
        { xMm: 29.0, yMm: 11.5, diaMm: 2.75 },
      ],
      note: "M2.5 screws; non-plated per the uHAT mounting-hole spec",
    },
    exits: [
      {
        kind: "connector",
        std: "micro-usb",
        edge: "-y",
        offsetMm: 12.4,
        heightMm: 1.3,
        approx: true,
        note: "USB data port on the long edge toward the +x end; position nominal (from board photos, not a fetched drawing)",
      },
      {
        kind: "connector",
        std: "micro-usb",
        edge: "-y",
        offsetMm: 22.6,
        heightMm: 1.3,
        approx: true,
        note: "PWR IN micro-USB nearer the corner; mini-HDMI (~11.4 x 3.4 cutout) sits on the same edge toward -x — positions nominal",
      },
    ],
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "antenna",
        note: "onboard WiFi antenna near the SD-slot corner — avoid metal directly above the board end",
      },
    ],
    provenance: {
      sourceUrl: "https://github.com/raspberrypi/hats/blob/master/uhat-board-mechanical.pdf",
      docRevision:
        "uHAT board mechanical spec (c) Raspberry Pi 2018 — board 65 x 30, R3 corners, holes drilled 2.75 ±0.05 at 3.5 insets (58 x 23 grid); cross-checked against kicad-footprints Raspberry_Pi_Zero_Socketed_THT_FaceDown_MountingHoles.kicad_mod (same grid + drill)",
      dateChecked: "2026-07-06",
      verified: true,
      note: "hole pattern verified from two independent official/engineering sources; connector positions were NOT in either source and stay approx. Zero 2 W shares the original Zero mechanical outline. PCB thickness 1.6 nominal",
    },
    note: "connectors (mini-HDMI, 2x micro-USB) all exit one long edge; SD slot on the -x short end",
  },
  xiao: {
    id: "xiao",
    label: "Seeed Studio XIAO",
    category: "board",
    aliases: [
      "seeed xiao",
      "seeeduino xiao",
      "xiao esp32c3",
      "xiao esp32s3",
      "xiao esp32-c3",
      "xiao esp32-s3",
      "xiao rp2040",
      "xiao samd21",
      "xiao nrf52840",
      "xiao ble",
    ],
    // 3.5 is Seeed's published OVERALL module height (incl. USB-C + shield);
    // treat the XIAO as a solid 21 x 17.8 x 3.5 block for cavity purposes.
    boardMm: [21.0, 17.8, 3.5],
    mounting: {
      kind: "none",
      note: "no mounting holes — castellated edge pads only; locate with a perimeter shelf/pocket or clips",
    },
    exits: [
      {
        kind: "connector",
        std: "usb-c",
        edge: "-x",
        offsetMm: 0,
        heightMm: 0,
        approx: true,
        note: "USB-C centered on the short end, slight overhang; height relative to the 3.5-block top face unverified (Seeed publishes outline only)",
      },
    ],
    tallestAboveMm: 0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "antenna",
        note: "wireless variants (ESP32/nRF) use a chip or pigtail antenna at the +x end — keep metal away",
      },
    ],
    provenance: {
      sourceUrl:
        "https://raw.githubusercontent.com/Seeed-Studio/wiki-documents/docusaurus-version/sites/en/docs/Sensor/SeeedStudio_XIAO/SeeedStudio_XIAO_ESP32C3/XIAO_ESP32C3_Getting_Started.md",
      docRevision:
        "Seeed wiki source (CC BY-SA): 'Dimensions 21 x 17.8mm'; overall height 3.5 from the Seeeduino XIAO page ('21x17.8x3.5mm') in the same repo",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only: Seeed's DXF lives on files.seeedstudio.com (unreachable through the proxy), so no positional data was read — USB position stays approx",
    },
    note: "shared form factor across the XIAO family (SAMD21/RP2040/ESP32-C3/S3/nRF52840)",
  },
};
