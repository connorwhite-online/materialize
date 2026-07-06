import type { ComponentSpec } from "./schema";

/**
 * MTR-203 cameras. Envelopes come from Raspberry Pi's own documentation repo
 * (CC BY-SA); the mechanical drawings with hole positions live on
 * datasheets.raspberrypi.com which is unreachable through the proxy, so hole
 * patterns are carried from the community-measured camera v2 model and stay
 * unverified.
 */
export const CAMERAS: Record<string, ComponentSpec> = {
  "rpi-camera-3": {
    id: "rpi-camera-3",
    label: "Raspberry Pi Camera Module 3",
    category: "camera",
    aliases: [
      "pi camera",
      "raspberry pi camera",
      "camera module 3",
      "picam",
      "pi camera module",
      "camera module v3",
    ],
    boardMm: [25.0, 24.0, 1.0],
    mounting: {
      kind: "hole-pattern",
      // 21 x 12.5 grid carried from the camera v2 model — Camera Module 3
      // keeps the v2 board format per RPi, but this was NOT read off a
      // Camera 3 drawing; unverified.
      holes: [
        { xMm: -10.5, yMm: -2.57, diaMm: 2.2 },
        { xMm: -10.5, yMm: 9.93, diaMm: 2.2 },
        { xMm: 10.5, yMm: -2.57, diaMm: 2.2 },
        { xMm: 10.5, yMm: 9.93, diaMm: 2.2 },
      ],
      note: "21 x 12.5 grid, offset toward the lens end; M2 screws",
    },
    exits: [
      {
        kind: "lens",
        direction: "+z",
        centerMm: [0, 3.7],
        approx: true,
        note: "lens centered between the four holes; standard variant is 11.5 tall overall, wide variant 12.4 — opening must clear the lens barrel plus FOV cone (120° on the wide)",
      },
      {
        kind: "connector",
        edge: "-y",
        offsetMm: 0,
        heightMm: 0,
        approx: true,
        note: "22-pin flex ribbon leaves the edge opposite the lens — slot, don't pinch",
      },
    ],
    tallestAboveMm: 10.5,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/raspberrypi/documentation/blob/develop/documentation/asciidoc/accessories/camera/hardware_specification.adoc",
      docRevision:
        "raspberrypi/documentation develop (CC BY-SA): Camera Module 3 'around 25 × 24 × 11.5 mm' (12.4 wide variant); hole grid carried from NopSCADlib rpi_camera_v2 (25 x 23.862, 4x Ø2.2 at a 21 x 12.5 grid, 2 mm insets on the lens end)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope from RPi's own docs; hole positions inferred from the v2 form factor — verify against the Camera Module 3 drawing before trusting bosses",
    },
  },
  "rpi-hq-camera": {
    id: "rpi-hq-camera",
    label: "Raspberry Pi HQ Camera",
    category: "camera",
    aliases: ["hq camera", "raspberry pi hq camera", "imx477 camera"],
    boardMm: [38.0, 38.0, 1.6],
    mounting: {
      kind: "none",
      note: "4 corner holes exist on the PCB but the drawing is unreachable — the robust mount is the integrated 1/4-20 tripod boss on the C/CS housing underside",
    },
    exits: [
      {
        kind: "lens",
        direction: "+z",
        centerMm: [0, 0],
        approx: true,
        note: "C/CS lens mount + back-focus ring occupy the board center to 18.4 above (29.5 with adapter and dust cap); lens adds more — measure your lens",
      },
      {
        kind: "connector",
        edge: "-y",
        offsetMm: 0,
        heightMm: 0,
        approx: true,
        note: "flex ribbon exits one edge",
      },
    ],
    tallestAboveMm: 16.8,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/raspberrypi/documentation/blob/develop/documentation/asciidoc/accessories/camera/hardware_specification.adoc",
      docRevision:
        "raspberrypi/documentation develop (CC BY-SA): HQ Camera '38 × 38 × 18.4 mm (excluding lens)' / '29.5 mm with adaptor and dust cap'",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only: hole grid and tripod-boss position need the official drawing (datasheets host unreachable)",
    },
  },
  "esp32-cam": {
    id: "esp32-cam",
    label: "ESP32-CAM (OV2640)",
    category: "camera",
    aliases: ["esp32 cam", "ov2640", "ov2640 module", "esp32 camera"],
    boardMm: [40.0, 27.0, 1.7],
    mounting: {
      kind: "none",
      note: "no mounting holes — pocket/rail mount; the camera ribbon and antenna decide the orientation",
    },
    exits: [
      {
        kind: "lens",
        direction: "+z",
        centerMm: [0, 0],
        approx: true,
        note: "OV2640 lens housing sits on a short ribbon near the board center — position varies with assembly; microSD slot on the same face",
      },
    ],
    tallestAboveMm: 5.0,
    pinsBelowMm: 3.0,
    keepOuts: [
      {
        kind: "antenna",
        note: "onboard PCB antenna at one short end (u.FL variant exists) — keep metal away",
      },
      {
        kind: "thermal",
        note: "the ESP32 runs hot when streaming — vent the enclosure",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/cameras.scad",
      docRevision: "NopSCADlib ESP32_CAM (PCB 27 x 40 x 1.7)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "single engineering source; lens/SD positions are hints. AI-Thinker form factor",
    },
  },
};
