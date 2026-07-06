import type { ComponentSpec } from "./schema";

/**
 * MTR-203 power & charging. Sourcing rules in boards.ts. The 18650 holders
 * are measured on the OCP kernel from official KiCad packages3D STEPs
 * (CC-BY-SA + design exception; dims extracted as facts). Deferred for lack
 * of a fetchable source (do NOT add from memory): 9V snap connector, JST-PH
 * pigtail housing, barrel-jack + terminal-block module.
 */
export const POWER: Record<string, ComponentSpec> = {
  "battery-18650": {
    id: "battery-18650",
    label: "18650 cell",
    category: "power",
    aliases: ["18650", "18650 battery", "li-ion 18650", "18650 cell"],
    // Cylinder: Ø18.3 x 65 (bounding block).
    boardMm: [65.0, 18.3, 18.3],
    mounting: {
      kind: "none",
      note: "lives in a holder (holder-18650-keystone-1042 / holder-18650-bh-pc2) or a printed cradle with retention",
    },
    exits: [],
    tallestAboveMm: 0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "thermal",
        note: "lithium cell — never fully seal without a pressure path, keep away from hot parts, and leave removal access",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/batteries.scad",
      docRevision: "NopSCADlib S25R18650 (Samsung 25R: 65 x Ø18.3)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "unprotected-cell size; protected/button-top cells run several mm longer — holder compatibility is NOT guaranteed for those",
    },
  },
  "holder-18650-keystone-1042": {
    id: "holder-18650-keystone-1042",
    label: "Keystone 1042 18650 holder",
    category: "power",
    aliases: ["keystone 1042", "18650 holder", "battery holder 18650", "1042 holder"],
    // Body above the seating plane; solder tabs extend the length to 86.4.
    boardMm: [86.4, 20.7, 16.3],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -27.6, yMm: -8.0, diaMm: 3.7 },
        { xMm: 27.6, yMm: 8.0, diaMm: 3.7 },
      ],
      note: "two Ø3.7 through-holes on a diagonal; SMT solder tabs at both ends push the overall length past the cell bay",
    },
    exits: [],
    tallestAboveMm: 0,
    pinsBelowMm: 3.5,
    keepOuts: [
      {
        kind: "insertion",
        note: "the cell snaps in from above — keep the full top face open plus finger room at the ends",
      },
    ],
    provenance: {
      sourceUrl:
        "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Battery.3dshapes/BatteryHolder_Keystone_1042_1x18650.step",
      docRevision:
        "kicad-packages3D master (measured on the OCP kernel: 86.41 x 20.65 x 16.3 above seat, tabs 3.5 below, 2 holes Ø3.68 at (±27.6, ∓8.0) from body center)",
      dateChecked: "2026-07-06",
      verified: true,
      note: "canonical: Keystone drawing 1042 (SMT version); through-hole sibling is 1043",
    },
  },
  "holder-18650-bh-pc2": {
    id: "holder-18650-bh-pc2",
    label: "MPD BH-18650-PC2 18650 holder",
    category: "power",
    aliases: ["bh-18650-pc2", "bh18650", "18650 pc holder", "mpd 18650 holder"],
    boardMm: [77.7, 20.9, 19.0],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -27.0, yMm: 0, diaMm: 3.2 },
        { xMm: 28.6, yMm: 0, diaMm: 3.2 },
      ],
      note: "two Ø3.2 holes on the centerline, 55.6 apart (slightly asymmetric about the body center — the spring end is longer)",
    },
    exits: [],
    tallestAboveMm: 0,
    pinsBelowMm: 3.2,
    keepOuts: [
      {
        kind: "insertion",
        note: "cell drops in from above against a spring — keep the top open",
      },
    ],
    provenance: {
      sourceUrl:
        "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Battery.3dshapes/BatteryHolder_MPD_BH-18650-PC2.step",
      docRevision:
        "kicad-packages3D master (measured on the OCP kernel: 77.7 x 20.9 x 19.0 above seat, PC pins 3.2 below, holes Ø3.2 at (-27.0, 0) and (28.6, 0))",
      dateChecked: "2026-07-06",
      verified: true,
      note: "single-cell holder with through-board PC pins; canonical: MPD BH-18650-PC2 drawing",
    },
  },
  tp4056: {
    id: "tp4056",
    label: "TP4056 charger module",
    category: "power",
    aliases: ["tp4056 charger", "lipo charger module", "18650 charger module", "tp-4056", "03962a"],
    boardMm: [26.2, 17.5, 1.0],
    mounting: {
      kind: "none",
      note: "no mounting holes — pocket/rail mount so the USB port aligns with the wall",
    },
    exits: [
      {
        kind: "connector",
        std: "micro-usb",
        edge: "-x",
        offsetMm: 0,
        heightMm: 1.3,
        approx: true,
        note: "micro-USB centered on the short end (the common USB-C variant, e.g. HW-373, is ~26 x 17 x 4 with USB-C in the same place)",
      },
    ],
    tallestAboveMm: 3.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "thermal",
        note: "charge/protection ICs dissipate ~1W at full charge — vent the pocket",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/pcbs.scad",
      docRevision:
        "NopSCADlib TP4056 (26.2 x 17.5 x 1.0, micro-USB on the short end, charge LEDs on top); USB-C variant envelope corroborated by 19bk/UmbaLabs3D BOM note ('HW-373 v1.2.1 USB-C charger: 26 x 17 x 4')",
      dateChecked: "2026-07-06",
      verified: false,
      note: "LED position hint: the red/blue charge LEDs benefit from a small window; solder-pad ends carry B+/B-/OUT wires",
    },
  },
  "lm2596-buck": {
    id: "lm2596-buck",
    label: "LM2596 buck converter module (HW-411)",
    category: "power",
    aliases: ["lm2596", "buck converter", "step down module", "dc-dc buck", "hw-411"],
    boardMm: [43.2, 21.2, 1.6],
    mounting: {
      kind: "none",
      note: "two Ø3.2 holes near opposite corners on most boards, but positions vary by maker — treat as unknown until measured",
    },
    exits: [],
    tallestAboveMm: 12.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "insertion",
        note: "the output-set trimpot needs top screwdriver access; IN/OUT wire pads at both short ends need routing room",
      },
      {
        kind: "thermal",
        note: "regulator + inductor run warm at load — vent above",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/teamon/ikea-trotten-motorized-desk-controller/blob/main/case/lm2596.scad",
      docRevision:
        "community triangulation (2026-07-06): teamon/ikea-trotten (43 x 21), martindubois/Models3D (43 x 21), spegelius/3DModels (43.2 x 21.2 x 1.6), philmccarthy24/selfbalancingrobot (43.25 x 21.25, 14 clearance height, 'screw holes at 6.5 and 2.5 in at each end'). Envelope agrees to 0.25; hole positions do NOT agree",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only; component height ~12 above the PCB from the 14 overall clearance figure",
    },
  },
  mt3608: {
    id: "mt3608",
    label: "MT3608 boost converter module",
    category: "power",
    aliases: ["mt-3608", "boost converter", "step up module", "dc-dc boost"],
    boardMm: [37.0, 17.0, 1.2],
    mounting: {
      kind: "none",
      note: "no mounting holes (the corner holes are IN/OUT wire pads, Ø1.5) — pocket mount",
    },
    exits: [],
    tallestAboveMm: 5.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "insertion",
        note: "output-set trimpot needs top screwdriver access",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/pcbs.scad",
      docRevision:
        "NopSCADlib MT3608 (37 x 17 x 1.2, corner wire pads Ø1.5, trimpot + SS34 diode + inductor on top)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "single engineering source; tallest part (inductor/trimpot) nominal ~5",
    },
  },
  mp1584: {
    id: "mp1584",
    label: "MP1584EN mini buck module",
    category: "power",
    aliases: ["mp1584en", "mini buck", "mini 360", "mini360", "mp-1584"],
    boardMm: [22.0, 17.0, 1.25],
    mounting: {
      kind: "none",
      note: "no mounting holes — pocket mount; corner pads are wire terminals",
    },
    exits: [],
    tallestAboveMm: 4.0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/pcbs.scad",
      docRevision: "NopSCADlib MP1584EN (22 x 17 x 1.25, corner wire pads)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "single engineering source; height nominal",
    },
  },
  "usb-c-breakout": {
    id: "usb-c-breakout",
    label: "USB-C breakout (Adafruit 4090)",
    category: "power",
    aliases: ["usb c breakout", "usb-c breakout board", "type-c breakout"],
    boardMm: [20.32, 13.97, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -7.62, yMm: 4.44, diaMm: 2.5 },
        { xMm: 7.62, yMm: 4.44, diaMm: 2.5 },
      ],
      note: "two M2.5 holes on the long edge behind the connector",
    },
    exits: [
      {
        kind: "connector",
        std: "usb-c",
        edge: "-y",
        offsetMm: 0,
        heightMm: 1.6,
        approx: true,
        note: "USB-C receptacle roughly flush with the long edge opposite the mounting holes; orientation read from the STEP's shell-pin pattern, so it stays approx",
      },
    ],
    tallestAboveMm: 3.2,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/4090%20USB%20C%20Breakout/4090%20USB%20C%20Breakout.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: PCB 20.32 x 13.97 x 1.57, 2 holes Ø2.5 at (±7.62, +4.44), overall 4.78",
      dateChecked: "2026-07-06",
      verified: true,
      note: "generic power-only USB-C breakouts are smaller and differ — this entry is the Adafruit 4090",
    },
  },
};
