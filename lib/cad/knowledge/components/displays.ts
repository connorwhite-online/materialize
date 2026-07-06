import type { ComponentSpec } from "./schema";

/**
 * MTR-203 displays & LED modules. Sourcing rules in boards.ts. Deferred for
 * lack of a fetchable source (do NOT add from memory): ST7789 1.3"/1.54"
 * generic modules, Waveshare 2.13" e-ink (waveshare.com/wiki unreachable
 * through the proxy), generic 2.8" ILI9341 touch module (the KiCad
 * CR2013-MI2120 footprint documents a 67.2 x 40.1 variant that does not match
 * the common red MSP2807 module — too ambiguous to canonize).
 */
export const DISPLAYS: Record<string, ComponentSpec> = {
  lcd1602: {
    id: "lcd1602",
    label: "1602 character LCD",
    category: "display",
    aliases: [
      "1602 lcd",
      "lcd 1602",
      "16x2 lcd",
      "1602a",
      "hd44780",
      "1602 display",
      "16x2 display",
      "lcd1602 i2c",
    ],
    boardMm: [80.0, 36.0, 1.6],
    mounting: {
      kind: "hole-pattern",
      // 75.0 x 31.0 grid, 2.5 mm in from each PCB edge.
      holes: [
        { xMm: -37.5, yMm: -15.5, diaMm: 2.5 },
        { xMm: -37.5, yMm: 15.5, diaMm: 2.5 },
        { xMm: 37.5, yMm: -15.5, diaMm: 2.5 },
        { xMm: 37.5, yMm: 15.5, diaMm: 2.5 },
      ],
      note: "drill 2.5 per the WC1602A drawing; some makers drill 2.9 — M2.5 screws fit either",
    },
    exits: [
      {
        kind: "screen_window",
        direction: "+z",
        centerMm: [0, 0],
        dims: { wMm: 64.5, hMm: 15.0 },
        note: "viewing window, centered on the PCB; the metal bezel around it is 71.3 x 24.3 and stands 7.0 above the PCB — recess the window wall to sit on the bezel",
      },
    ],
    tallestAboveMm: 7.0,
    pinsBelowMm: 3.0,
    stacking: {
      note: "the common I2C backpack solders to the 16-pin row and hangs ~10 BELOW the PCB back — leave depth behind the display",
    },
    provenance: {
      sourceUrl:
        "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Display.pretty/WC1602A.kicad_mod",
      docRevision:
        "kicad-footprints master (F.Fab outline 80 x 36, 4x drill 2.5 at (±37.5, ±15.5), viewing-window silk 64.5 x 15 centered; drawing ref wincomlcd WC1602A-SFYLYHTC06.pdf); cross-checked against NopSCADlib vitamins/displays.scad LCD1602A (PCB [80,36], holes at 2.5 insets, bezel 71.3 x 24.3 x 7.0, aperture 64.5 x 14.5) — agreement within 0.5",
      dateChecked: "2026-07-06",
      verified: true,
      note: "two independent engineering sources agree on outline, hole grid and window; bezel height 7.0 from NopSCADlib only",
    },
    note: "ubiquitous HD44780-class module; contrast trimpot on the I2C backpack needs a service opening if you seal the back",
  },
  "oled-0.91": {
    id: "oled-0.91",
    label: '0.91" 128x32 OLED module',
    category: "display",
    aliases: [
      "0.91 oled",
      "0.91in oled",
      "128x32 oled",
      "ssd1306 0.91",
      "0.91 inch oled",
    ],
    boardMm: [38.0, 12.0, 1.6],
    mounting: {
      kind: "none",
      note: "no mounting holes — capture in a pocket or behind a window frame",
    },
    exits: [
      {
        kind: "screen_window",
        direction: "+z",
        centerMm: [1.5, 0],
        dims: { wMm: 24.0, hMm: 7.0 },
        approx: true,
        note: "active area ~22.4 x 5.6 sits toward the end away from the 4-pin header; window size/offset not in the footprint — measure your module",
      },
    ],
    tallestAboveMm: 2.0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Display.pretty/ER_OLEDM0.91_1x-I2C.kicad_mod",
      docRevision:
        "kicad-footprints master (EastRising ER-OLEDM0.91 module: F.Fab outline 38 x 12, 4-pin 2.54-pitch header row at one short end)",
      dateChecked: "2026-07-06",
      verified: false,
      note: "outline verified from the footprint; glass/active-area geometry not stated there, so the window stays approx. tallestAboveMm ~2 (thin glass stack) nominal",
    },
    note: "4 header pins (GND/VCC/SCL/SDA) on one short end, usually angled or unpopulated",
  },
  "ssd1306-0.96": {
    id: "ssd1306-0.96",
    label: '0.96" 128x64 OLED module (SSD1306)',
    category: "display",
    aliases: [
      "ssd1306",
      "0.96 oled",
      "0.96in oled",
      "128x64 oled",
      "0.96 inch oled",
      "oled display",
      "i2c oled",
    ],
    // Treated as a solid block: 3.0 is the overall module thickness
    // (community-measured 2.5-3.0); generic clones vary ±0.5 in outline.
    boardMm: [27.8, 27.3, 3.0],
    mounting: {
      kind: "hole-pattern",
      // 23.5 x 23.0 grid per two community-measured sources — NOT verified
      // against a vendor drawing (clones genuinely differ); hints only.
      holes: [
        { xMm: -11.75, yMm: -11.5, diaMm: 2.5 },
        { xMm: -11.75, yMm: 11.5, diaMm: 2.5 },
        { xMm: 11.75, yMm: -11.5, diaMm: 2.5 },
        { xMm: 11.75, yMm: 11.5, diaMm: 2.5 },
      ],
      note: "grid ~23.5 x 23.0, holes fit M2.5 — clone modules vary, measure before committing bosses",
    },
    exits: [
      {
        kind: "screen_window",
        direction: "+z",
        centerMm: [-1.3, 0],
        dims: { wMm: 26.0, hMm: 15.0 },
        approx: true,
        note: "glass window offset ~1.3 away from the 4-pin header edge; active area ~21.7 x 10.9 within it — the yellow/blue split displays have a fixed color band",
      },
    ],
    tallestAboveMm: 0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/KR8MER/eas-station/blob/main/hardware/enclosure/eas_station_case.scad",
      docRevision:
        "community-measured triangulation (2026-07-06): KR8MER/eas-station (27.3 x 27.8, holes 23.0 x 23.5, M2.5 clearance), CE-ELE/pocketcom (27.3 x 27.8 x 2.5), smallwat3r/rpi-gardener (cutout 26 x 15, mount spacing 23 x 23.5). No vendor drawing was reachable",
      dateChecked: "2026-07-06",
      verified: false,
      note: "envelope-only confidence: three independent community sources agree on 27.3 x 27.8 and the ~23 x 23.5 grid, but generic clones vary — nothing here is fit-enforced",
    },
    note: "the most common 4-pin I2C module; some clones are 28.3 long or move the holes — a real vendor drawing should replace this entry when reachable",
  },
  "neopixel-stick-8": {
    id: "neopixel-stick-8",
    label: "8x NeoPixel Stick",
    category: "display",
    aliases: [
      "neopixel stick",
      "ws2812 stick",
      "8x ws2812",
      "ws2812b stick",
      "led stick",
    ],
    // 2.6 = PCB + LEDs overall (measured from the STEP); treat as a block.
    boardMm: [50.8, 10.16, 2.6],
    mounting: {
      kind: "hole-pattern",
      holes: [
        { xMm: -12.7, yMm: 3.05, diaMm: 2.2 },
        { xMm: 12.7, yMm: 3.05, diaMm: 2.2 },
      ],
      note: "two holes on the edge away from the LED row; M2 screws",
    },
    exits: [
      {
        kind: "screen_window",
        direction: "+z",
        centerMm: [0, -1.0],
        dims: { wMm: 50.8, hMm: 5.5 },
        approx: true,
        note: "the 8x 5050 LED row needs a full-length light window (or diffuser) over the face",
      },
    ],
    tallestAboveMm: 0,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/1426%208x%20NeoPixel%20Stick/1426%208x%20NeoPixel%20Stick.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: 50.8 x 10.16 x 2.6, 2 holes dia 2.2 at (±12.7, +3.05)",
      dateChecked: "2026-07-06",
      verified: true,
      note: "generic WS2812 sticks copy this Adafruit form factor but are not guaranteed identical",
    },
  },
  "neopixel-ring-16": {
    id: "neopixel-ring-16",
    label: "16x NeoPixel Ring",
    category: "display",
    aliases: [
      "neopixel ring",
      "ws2812 ring",
      "16x ws2812",
      "led ring",
      "ws2812b ring",
    ],
    // Annulus: OD 44.45, inner opening dia 31.75; envelope as a square block.
    boardMm: [44.45, 44.45, 1.6],
    mounting: {
      kind: "none",
      note: "no mounting holes — capture between a lip on the OD (44.45) and the ID (31.75), or glue",
    },
    exits: [
      {
        kind: "screen_window",
        direction: "+z",
        centerMm: [0, 0],
        dims: { wMm: 44.45, hMm: 44.45 },
        approx: true,
        note: "LED faces on the +z side of the annulus (LEDs to 1.7 above the PCB); annular window OD 44.45 / ID 31.75 — the center disk is open",
      },
    ],
    tallestAboveMm: 1.7,
    pinsBelowMm: 0,
    provenance: {
      sourceUrl:
        "https://github.com/adafruit/Adafruit_CAD_Parts/blob/main/1463%2016x%20NeoPixel%20Ring/1463%2016x%20NeoPixel%20Ring.step",
      docRevision:
        "Adafruit_CAD_Parts main (MIT) — measured on the OCP kernel: OD 44.45, ID 31.75, PCB 1.6, overall 3.3",
      dateChecked: "2026-07-06",
      verified: true,
      note: "solder pads on the back face; feed wires from -z",
    },
  },
};
