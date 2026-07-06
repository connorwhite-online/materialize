import type { ComponentSpec } from "./schema";

/**
 * MTR-203 actuators & motors. Sourcing rules in boards.ts. Servo/stepper
 * bodies are solid blocks: boardMm is the full body (z = height), the flange
 * mounting union carries ear geometry, and shafts are "+z" exits. Deferred
 * for lack of a fetchable source (do NOT add from memory): TT gear motor,
 * N20 micro gearmotor (pololu.com unreachable), 5V solenoid, coin vibration
 * motor, single-channel relay module (the 2-channel entry covers the class).
 */
export const ACTUATORS: Record<string, ComponentSpec> = {
  sg90: {
    id: "sg90",
    label: "SG90 micro servo",
    category: "actuator",
    aliases: ["sg-90", "9g servo", "micro servo", "tower pro sg90", "towerpro sg90"],
    // Solid body (z = body height, flange and shaft above).
    boardMm: [22.5, 12.2, 22.7],
    mounting: {
      kind: "flange",
      holes: [
        { xMm: -13.5, yMm: 0, diaMm: 2.0 },
        { xMm: 13.5, yMm: 0, diaMm: 2.0 },
      ],
      flangeSpanMm: 32.2,
      flangeThicknessMm: 2.5,
      flangeAtMm: 15.9,
      note: "ear screw holes 27.0-27.1 c-t-c with slot cuts; the body drops through a 23 x 12.5 rectangular cutout and the ears screw to the panel",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [5.2, 0],
        diaMm: 4.9,
        approx: true,
        note: "output spline offset ~5.2 toward one end; the horn sweeps a much larger circle — leave clearance above the whole top face",
      },
      {
        kind: "connector",
        edge: "-x",
        offsetMm: 0,
        heightMm: 4.5,
        approx: true,
        note: "3-wire ribbon exits low on the cable end — needs a slot or channel",
      },
    ],
    tallestAboveMm: 7.2,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl: "https://github.com/openscad/MCAD/blob/master/servos.scad",
      docRevision:
        "community triangulation (2026-07-06): MCAD towerprosg90 (body 22.5 x 11.8 x 22.7, flange 31.9 x 11.8 x 2.5 at 15.9, screws D2 at 27.1 c-t-c, shaft top at 29.9) + lhartmann/HCAD sg90.scad (22.5 x 12.4 x 22.0, wings 32.15 x 2.5, holes D2 at 27.0, shaft D4.9). Width varies 11.8-12.6 across sources",
      dateChecked: "2026-07-06",
      verified: false,
      note: "clone servos vary ~0.5 in every dimension — positions are hints, never fit-enforced. Canonical: TowerPro SG90 drawing (unreachable through the proxy)",
    },
  },
  mg90s: {
    id: "mg90s",
    label: "MG90S micro servo",
    category: "actuator",
    aliases: ["mg-90s", "mg90", "metal gear micro servo"],
    boardMm: [22.9, 12.5, 22.8],
    mounting: {
      kind: "flange",
      holes: [
        { xMm: -13.5, yMm: 0, diaMm: 2.0 },
        { xMm: 13.5, yMm: 0, diaMm: 2.0 },
      ],
      flangeSpanMm: 32.4,
      flangeThicknessMm: 2.5,
      flangeAtMm: 15.9,
      note: "same case family as the SG90 — ears ~27 c-t-c; brackets designed for SG90 fit",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [5.2, 0],
        diaMm: 4.9,
        approx: true,
        note: "metal-gear version of the SG90 case; spline position matches",
      },
    ],
    tallestAboveMm: 7.2,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/kartchnb/openscad-servo-library/blob/main/servos/mg90s_clone.scad",
      docRevision:
        "kartchnb/openscad-servo-library mg90s_clone ('actual measurements from clones': body width 22.92, wing width 32.38); case geometry otherwise carried over from the SG90 sources (MCAD/HCAD)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only; treat every position as a hint",
    },
  },
  mg996r: {
    id: "mg996r",
    label: "MG996R standard servo",
    category: "actuator",
    aliases: ["mg996", "mg995", "standard servo", "servo mg996r"],
    boardMm: [40.7, 19.7, 42.9],
    mounting: {
      kind: "flange",
      holes: [
        { xMm: -24.75, yMm: 0, diaMm: 4.8 },
        { xMm: 24.75, yMm: 0, diaMm: 4.8 },
      ],
      note: "tab holes 49.5 c-t-c lengthwise, Ø4.8; each ear actually carries TWO holes stacked across the width — crosswise spacing not verified, measure before drilling four",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [10.35, 0],
        approx: true,
        note: "output shaft ~10 from one end of the body; horn clearance needed above",
      },
    ],
    tallestAboveMm: 0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/maniginam/foldit/blob/master/hardware_files/servo_mount.scad",
      docRevision:
        "community triangulation (2026-07-06): maniginam/foldit (40.7 x 19.7 x 42.9, tabs 49.5 c-t-c Ø4.8, shaft 10 from end), Haus1775/kinetic-sand-table (40.7 x 19.7 x 42.9), RamenAnime/Karakuri (40.7 x 20.5 class, 49 tab spacing)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "42.9 is the overall height including the output boss; MG995 shares the case. Positions are hints only",
    },
  },
  nema17: {
    id: "nema17",
    label: "NEMA 17 stepper motor",
    category: "actuator",
    aliases: ["nema-17", "nema 17 stepper", "17hs4401", "stepper motor", "42 stepper"],
    // 42.3 square face; 40 body length is the most common class (34/47 exist).
    boardMm: [42.3, 42.3, 40.0],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -15.5, yMm: -15.5, diaMm: 3.0 },
        { xMm: -15.5, yMm: 15.5, diaMm: 3.0 },
        { xMm: 15.5, yMm: -15.5, diaMm: 3.0 },
        { xMm: 15.5, yMm: 15.5, diaMm: 3.0 },
      ],
      note: "M3 TAPPED holes on a 31 x 31 grid in the motor face (use M3 clearance holes in the mount plate); pilot boss Ø22 x 2 deep around the shaft",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [0, 0],
        diaMm: 22.5,
        note: "Ø5 shaft (typ. 20-24 long) through the Ø22 pilot boss — the mount plate needs a Ø22.5 bore so the boss registers",
      },
    ],
    tallestAboveMm: 26.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "thermal",
        note: "steppers run hot at full current — don't fully entomb the body in insulating plastic; leave vent area",
      },
      {
        kind: "wire-bend",
        note: "4-wire cable or JST connector exits one side of the body — leave a channel",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/stepper_motors.scad",
      docRevision:
        "three independent engineering libraries agree (2026-07-06): NopSCADlib NEMA17_40 (side 42.3, holes 31 grid, boss r11 x 2, shaft Ø5 x 20-24, lengths 26.5/34/40/47), nophead/Mendel90 vitamins (identical numbers), VikOlliver/RepRapMicron nema17lib (face 42.3, screw sep 31, collar Ø22.5 incl. 0.5 oversize, shaft 24). NEMA ICS 16-2001 is the canonical standard",
      dateChecked: "2026-07-06",
      verified: true,
      note: "body LENGTH varies by model (26.5-47+): 40 here is the common 17HS4401 class — confirm the variant when depth matters. tallestAboveMm = shaft 24 + boss 2 above the face",
    },
  },
  "28byj-48": {
    id: "28byj-48",
    label: "28BYJ-48 geared stepper",
    category: "actuator",
    aliases: ["28byj", "byj48", "geared stepper", "5v stepper", "unipolar stepper"],
    // Ø28 can, 19 tall; boardMm as the round body's bounding block.
    boardMm: [28.0, 28.0, 19.0],
    mounting: {
      kind: "flange",
      holes: [
        { xMm: -17.5, yMm: 0, diaMm: 4.2 },
        { xMm: 17.5, yMm: 0, diaMm: 4.2 },
      ],
      flangeThicknessMm: 1.0,
      flangeSpanMm: 42.0,
      flangeAtMm: 19.0,
      note: "two Ø7.8 ears, holes 35 c-t-c, coplanar with the shaft-side face; M3 or M4 screws",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [0, 8.0],
        diaMm: 10.0,
        note: "Ø9-10 shaft boss offset 8 from the can center (perpendicular to the ear axis); Ø5 flatted shaft, ~10 long",
      },
    ],
    tallestAboveMm: 10.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "wire-bend",
        note: "5-wire ribbon with JST-XH plug exits the can side — leave a channel to the ULN2003 driver board",
      },
    ],
    stacking: {
      note: "always paired with a ULN2003 driver board (uln2003-driver) — budget enclosure space for both",
    },
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/geared_steppers.scad",
      docRevision:
        "two independent sources agree (2026-07-06): NopSCADlib 28BYJ_48 (Ø28 x 19, lug pitch 35, hole 4.2, boss Ø9 x 1.5, shaft Ø5 offset 8) + MuellerA/Thingiverse Pcb28BYJ (Ø28.8 envelope, ears 35 c-t-c Ø7.8, screw clearance 4.5, shaft boss Ø9.9 at offset 8)",
      dateChecked: "2026-07-06",
      verified: true,
      note: "the most standardized of the generic parts — ear and shaft positions agree across sources to 0.3",
    },
  },
  "uln2003-driver": {
    id: "uln2003-driver",
    label: "ULN2003 driver board",
    category: "actuator",
    aliases: ["uln2003", "stepper driver board", "uln2003 module"],
    boardMm: [35.2, 32.5, 1.8],
    mounting: {
      kind: "none",
      note: "small (~Ø1-3) corner holes vary by maker — shelf/pocket mount, or standoffs if your board's holes allow",
    },
    exits: [],
    tallestAboveMm: 10.0,
    pinsBelowMm: 3.0,
    stacking: {
      note: "companion to the 28BYJ-48; the 4 driver LEDs are worth a light pipe or window",
    },
    provenance: {
      sourceUrl:
        "https://raw.githubusercontent.com/MuellerA/Thingiverse/master/PCB/pcb.scad",
      docRevision:
        "MuellerA/Thingiverse PcbUln2003 (32.5 x 35.2 x 1.8, corner pin insets 2.8)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "single community source — envelope-only; tallest part (header + terminal) nominal ~10",
    },
  },
  "relay-2ch": {
    id: "relay-2ch",
    label: "2-channel 5V relay module",
    category: "actuator",
    aliases: ["relay module", "2 channel relay", "dual relay", "5v relay", "relay board"],
    boardMm: [51.0, 39.0, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -22.75, yMm: -16.75, diaMm: 3.0 },
        { xMm: -22.75, yMm: 16.75, diaMm: 3.0 },
        { xMm: 22.75, yMm: -16.75, diaMm: 3.0 },
        { xMm: 22.75, yMm: 16.75, diaMm: 3.0 },
      ],
      note: "45.5 x 33.5 grid, 2.75 corner insets (SainSmart-style boards); clones vary",
    },
    exits: [],
    tallestAboveMm: 16.0,
    pinsBelowMm: 3.0,
    keepOuts: [
      {
        kind: "insertion",
        note: "screw terminals need top-down screwdriver access and side wire entry — don't wall them in",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/RigacciOrg/openscad-rpi-library/blob/master/misc_boards.scad",
      docRevision:
        "openscad-rpi-library board_2relays_sainsmart (39 x 51 x 1.6, 4x D3 at 2.75 insets, relay bodies 15 x 19 x 16)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "single community source and clones differ — envelope-level confidence; mains wiring clearances are the user's responsibility",
    },
  },
};
