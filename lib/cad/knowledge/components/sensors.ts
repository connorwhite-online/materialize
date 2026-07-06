import type { ComponentSpec } from "./schema";

/**
 * MTR-203 sensors & input modules. Sourcing rules in boards.ts. Adafruit
 * breakouts are measured on the OCP kernel from Adafruit_CAD_Parts STEPs
 * (MIT) — generic clones of the same chip usually sit on DIFFERENT PCBs.
 * Deferred for lack of a fetchable, non-conflicting source (do NOT add from
 * memory): DHT22 (fetched community numbers conflicted), HC-SR501 PIR (only
 * dome-diameter fragments found), INMP441, MQ-series gas modules, capacitive
 * soil-moisture v1.2.
 */
export const SENSORS: Record<string, ComponentSpec> = {
  bme280: {
    id: "bme280",
    label: "BME280 breakout (Adafruit)",
    category: "sensor",
    aliases: [
      "bme280 breakout",
      "bmp280",
      "bme 280",
      "temperature humidity pressure sensor",
      "adafruit bme280",
    ],
    boardMm: [19.05, 17.78, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: 6.99, yMm: -6.35, diaMm: 2.2 },
        { xMm: 6.99, yMm: 6.35, diaMm: 2.2 },
      ],
      note: "two holes on the end away from the 7-pin header row; M2 screws",
    },
    exits: [],
    tallestAboveMm: 1.4,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "thermal",
        note: "environmental sensor — vent the enclosure so ambient air actually reaches it, and keep it away from warm regulators",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/2652%20Adafruit%20BME280/Adafruit%20BME280.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: PCB 17.78 x 19.05 x 1.57, 2 holes dia 2.2 at (6.99, ±6.35), header row of 7 on the opposite end, overall 2.97",
      dateChecked: "2026-07-06",
      verified: true,
      note: "this is the Adafruit 2652 board; generic purple GY-BME280 modules are ~10.5 x 14 with a single D3 hole (openscad-rpi-library) — different part, measure yours",
    },
  },
  sht31: {
    id: "sht31",
    label: "SHT31-D breakout (Adafruit)",
    category: "sensor",
    aliases: ["sht31-d", "sht31 breakout", "sht30", "sht35", "humidity sensor breakout"],
    boardMm: [25.4, 17.78, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -10.16, yMm: -6.35, diaMm: 2.5 },
        { xMm: -10.16, yMm: 6.35, diaMm: 2.5 },
        { xMm: 10.16, yMm: -6.35, diaMm: 2.5 },
        { xMm: 10.16, yMm: 6.35, diaMm: 2.5 },
      ],
      note: "standard Adafruit 1.0 x 0.7 inch breakout hole pattern; M2.5 screws",
    },
    exits: [],
    tallestAboveMm: 3.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "thermal",
        note: "humidity/temperature sensor — needs airflow slots in the enclosure",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/2857%20SHT31-D/2857%20SHT31-D.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: PCB 25.4 x 17.78 x 1.57, 4 holes dia 2.5 at (±10.16, ±6.35), overall 4.53",
      dateChecked: "2026-07-06",
      verified: true,
    },
  },
  as7341: {
    id: "as7341",
    label: "AS7341 light/color sensor (Adafruit)",
    category: "sensor",
    aliases: ["as7341 breakout", "light sensor breakout", "color sensor", "spectral sensor"],
    boardMm: [25.4, 17.78, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -10.16, yMm: -6.35, diaMm: 2.5 },
        { xMm: -10.16, yMm: 6.35, diaMm: 2.5 },
        { xMm: 10.16, yMm: -6.35, diaMm: 2.5 },
        { xMm: 10.16, yMm: 6.35, diaMm: 2.5 },
      ],
      note: "standard Adafruit 1.0 x 0.7 inch breakout hole pattern; M2.5 screws",
    },
    exits: [
      {
        kind: "sensor_window",
        direction: "+z",
        centerMm: [0, 0],
        diaMm: 6,
        approx: true,
        note: "the sensor die must see light — leave an opening or clear window above the board center (exact die position not in the STEP measurement)",
      },
    ],
    tallestAboveMm: 3.0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/4698%20AS7341%20Light%20Color%20Sensor/4698%20AS7341%20Light%20Color%20Sensor.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: PCB 25.4 x 17.78 x 1.57, 4 holes dia 2.5 at (±10.16, ±6.35), overall 4.53",
      dateChecked: "2026-07-06",
      verified: true,
      note: "hole pattern verified; the light window position is nominal (board center) — not fit-enforced",
    },
  },
  max98357: {
    id: "max98357",
    label: "MAX98357 I2S amp (Adafruit)",
    category: "sensor",
    aliases: ["max98357a", "i2s amplifier", "i2s amp breakout", "audio amp breakout"],
    boardMm: [19.05, 17.78, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: 6.99, yMm: -6.35, diaMm: 2.5 },
        { xMm: 6.99, yMm: 6.35, diaMm: 2.5 },
      ],
      note: "two holes on the end away from the 7-pin header row; M2.5 screws",
    },
    exits: [],
    tallestAboveMm: 1.0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/3006%20MAX98357/3006%20MAX98357.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: PCB 17.78 x 19.05 x 1.57, 2 holes dia 2.5 at (6.99, ±6.35), screw-terminal footprint on board, overall 2.57",
      dateChecked: "2026-07-06",
      verified: true,
      note: "speaker wires leave via the screw terminal — leave wire routing room above the board",
    },
  },
  "mpu6050-gy521": {
    id: "mpu6050-gy521",
    label: "GY-521 (MPU-6050 IMU)",
    category: "sensor",
    aliases: ["mpu6050", "mpu-6050", "gy521", "gy 521", "imu module", "accelerometer module", "gyroscope module"],
    boardMm: [21.0, 15.6, 1.2],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -7.5, yMm: 4.8, diaMm: 3.0 },
        { xMm: 7.5, yMm: 4.8, diaMm: 3.0 },
      ],
      note: "two holes on the long edge opposite the 8-pin header row",
    },
    exits: [],
    tallestAboveMm: 2.5,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/RigacciOrg/openscad-rpi-library/blob/master/misc_boards.scad",
      docRevision:
        "community triangulation (2026-07-06): openscad-rpi-library mpu6050_gy521 (21 x 15.6 x 1.2, 2x D3 at 3 mm corner insets on one edge) + PierreCuv/PowerVBT (21.7 x 15.6 x 1.2). No vendor drawing reachable",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only confidence: clones vary ~0.7 in length; tallestAboveMm is nominal. IMU orientation matters — mount rigidly, note axes in the build guide",
    },
  },
  "hc-sr04": {
    id: "hc-sr04",
    label: "HC-SR04 ultrasonic sensor",
    category: "sensor",
    aliases: ["hcsr04", "hc sr04", "ultrasonic sensor", "ultrasonic module", "distance sensor"],
    boardMm: [45.0, 20.0, 1.5],
    mounting: {
      kind: "none",
      note: "most clones have 4 small (~Ø2) corner holes but positions vary — the reliable mount is a bracket/pocket capturing the PCB with the transducers through a front wall",
    },
    exits: [
      {
        kind: "sensor_window",
        direction: "+z",
        centerMm: [-13.0, 0],
        diaMm: 16.5,
        approx: true,
        note: "transducer 1 (Ø16 can, ~12 tall); center-to-center spacing is 25.4 on some clones and 26.0 on others — measure yours",
      },
      {
        kind: "sensor_window",
        direction: "+z",
        centerMm: [13.0, 0],
        diaMm: 16.5,
        approx: true,
        note: "transducer 2 — both cans must be fully open to air (no grille directly in front)",
      },
    ],
    tallestAboveMm: 12.0,
    pinsBelowMm: 4.0,
    provenance: {
      sourceUrl:
        "https://github.com/uwudwagonl/Swiity/blob/main/3DPrinting/OpenSCAD/hc_sr04_dual_mount.scad",
      docRevision:
        "community triangulation (2026-07-06): uwudwagonl/Swiity (PCB 45 x 20, transducer Ø16, c-t-c 26.0, height ~15 overall) + marcus-k/ArduinoRadar (c-t-c 25.4, Ø16, height 11.9). PCB size and transducer diameter agree; SPACING DISAGREES 25.4 vs 26.0 — captured as a variance",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only: transducer positions are hints, never fit-enforced. Crystal/components on the back need ~4 clearance",
    },
  },
  "joystick-2axis": {
    id: "joystick-2axis",
    label: "2-axis analog joystick breakout (Adafruit)",
    category: "sensor",
    aliases: ["joystick", "analog joystick", "thumb joystick", "joystick module", "ky-023"],
    boardMm: [38.1, 38.1, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -15.24, yMm: -15.24, diaMm: 3.2 },
        { xMm: -15.24, yMm: 15.24, diaMm: 3.2 },
        { xMm: 15.24, yMm: -15.24, diaMm: 3.2 },
        { xMm: 15.24, yMm: 15.24, diaMm: 3.2 },
      ],
      note: "M3 screws at the four corners",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [0, 0],
        approx: true,
        note: "stick + cap protrude ~19.4 above the PCB and need a large clearance opening for full travel — size it to your cap, don't guess",
      },
    ],
    tallestAboveMm: 19.4,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/512%20Analog%202-axis%20Joystick/512%20Analog%202-axis%20Joystick.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: PCB 38.1 x 38.1 x 1.6, 4 holes dia 3.2 at (±15.24, ±15.24), overall height 21.0",
      dateChecked: "2026-07-06",
      verified: true,
      note: "this is the Adafruit 512 breakout; KY-023 clones use a smaller rectangular PCB with a different hole pattern — measure those",
    },
  },
  "ky-040": {
    id: "ky-040",
    label: "KY-040 rotary encoder module",
    category: "sensor",
    aliases: ["ky040", "rotary encoder", "rotary encoder module", "encoder knob"],
    boardMm: [26.3, 19.5, 1.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -8.42, yMm: -6.95, diaMm: 3.0 },
        { xMm: 8.36, yMm: -6.95, diaMm: 3.0 },
      ],
      note: "two holes along one long edge; the stronger mount is the encoder's own M7 threaded bushing through a panel",
    },
    exits: [
      {
        kind: "shaft",
        direction: "+z",
        centerMm: [-2.35, 1.55],
        diaMm: 7.5,
        approx: true,
        note: "encoder body 12 x 12 with an M7 threaded bushing + D6 flatted shaft — Ø7.5 panel hole lets the bushing/nut clamp the panel",
      },
    ],
    tallestAboveMm: 20.0,
    pinsBelowMm: 3.0,
    provenance: {
      sourceUrl:
        "https://github.com/nophead/NopSCADlib/blob/master/vitamins/pcbs.scad",
      docRevision:
        "NopSCADlib master KY_040 (PCB 26.3 x 19.5 x 1.6, 2x D3 holes, encoder at (10.8, 11.3) from corner; encoder body 12 x 12 x 6.5, M7 bushing, D6 shaft per vitamins/potentiometers.scad KY_040_encoder)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "single engineering source — positions are hints; overall height above PCB ~20 nominal (body + bushing + shaft)",
    },
  },
  rc522: {
    id: "rc522",
    label: "RC522 RFID reader module",
    category: "sensor",
    aliases: ["mfrc522", "rfid module", "rfid reader", "rfid-rc522", "rc-522"],
    boardMm: [60.0, 40.0, 1.5],
    mounting: {
      kind: "none",
      note: "clone boards carry 2-4 small (~Ø3) holes in varying places — pocket/shelf mounting is the portable choice",
    },
    exits: [],
    tallestAboveMm: 4.0,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "antenna",
        note: "the PCB coil antenna reads through plastic but NOT metal — keep the card-side wall thin (≤3) and metal-free",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/JoergOstertag/projects/blob/master/3D-Things/RFID-RC522/RFID-RC522.scad",
      docRevision:
        "community triangulation (2026-07-06): JoergOstertag/projects (40 x 60 x 1.5), 19bk/UmbaLabs3D (40 x 60 x 4 incl. parts), hdrckji/justintime (39 x 60, stack 7 with header). No vendor drawing reachable",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only; the angled header pins on one short end add height — 'stack 7' when populated",
    },
  },
  "neo-6m-gps": {
    id: "neo-6m-gps",
    label: "NEO-6M GPS module (GY-GPS6MV2 class)",
    category: "sensor",
    aliases: ["neo-6m", "neo6m", "gps module", "gy-gps6mv2", "ublox gps", "neo-7m", "neo-m8n"],
    boardMm: [36.0, 24.0, 1.0],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -15.0, yMm: -9.0, diaMm: 3.0 },
        { xMm: -15.0, yMm: 9.0, diaMm: 3.0 },
        { xMm: 15.0, yMm: -9.0, diaMm: 3.0 },
        { xMm: 15.0, yMm: 9.0, diaMm: 3.0 },
      ],
      note: "30 x 18 grid per the openscad-rpi-library model — other clones (e.g. the common GY-GPS6MV2) are 26.6 x 35.8 with different holes; measure",
    },
    exits: [],
    tallestAboveMm: 3.5,
    pinsBelowMm: 0,
    keepOuts: [
      {
        kind: "antenna",
        note: "GPS needs sky view: no metal or thick/filled plastic above the ceramic patch antenna (onboard or the separate 25 x 25 patch on a pigtail)",
      },
    ],
    provenance: {
      sourceUrl:
        "https://github.com/RigacciOrg/openscad-rpi-library/blob/master/misc_boards.scad",
      docRevision:
        "community triangulation (2026-07-06): openscad-rpi-library ublox_neo6m_gps (24 x 36 x 0.8, 4x D3 at 18 x 30 grid, ceramic antenna 15 x 12 x 2.4 on top) vs MuellerA/Thingiverse PCB/pcb.scad (26.6 x 35.8 x 1.2) — ENVELOPES DISAGREE by ~2.6; clone families differ",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only; positions never fit-enforced. Antenna variant changes the height budget a lot",
    },
  },
  vl53l0x: {
    id: "vl53l0x",
    label: "VL53L0X ToF module (GY-530)",
    category: "sensor",
    aliases: ["vl53l0x breakout", "gy-530", "tof sensor", "time of flight sensor", "vl53l1x", "laser distance sensor"],
    boardMm: [13.3, 10.5, 1.0],
    mounting: {
      kind: "hole-pattern",
      holes: [{ xMm: -4.5, yMm: 0, diaMm: 3.0 }],
      note: "single D3 hole near the sensor end (GY-530 variant)",
    },
    exits: [
      {
        kind: "sensor_window",
        direction: "+z",
        centerMm: [2.8, 0],
        diaMm: 4,
        approx: true,
        note: "the two ToF apertures must see the target — open hole, NOT clear plastic (cover glass needs an optical-grade window with an air gap)",
      },
    ],
    tallestAboveMm: 1.5,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/teamon/ikea-trotten-motorized-desk-controller/blob/main/case/vl53l0x.scad",
      docRevision:
        "teamon/ikea-trotten (GY-530 dims extracted from a KiCad footprint: PCB 10.5 x 13.3 x 1.0, D3 hole at (0, -4.5), OLGA-12 sensor at (0, 2.8)); note OkidNorbert/FarmBot models a DIFFERENT 'VL53L0X V2' clone at 20 x 12.7",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only: VL53L0X carrier boards come in at least two unrelated sizes — resolve the variant before cutting",
    },
  },
};
