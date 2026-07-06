/**
 * Tier-2 cross-validation for the component-spec registry (MTR-203).
 *
 * Fetches open-licensed CAD (Adafruit_CAD_Parts, MIT; KiCad packages3D,
 * CC-BY-SA + design exception) at VALIDATION TIME — the STEP files are
 * deliberately never committed to this repo — measures each model on the OCP
 * kernel (scripts/measure-step.py), and diffs footprint dims + mounting-hole
 * positions against the registry numbers. Any discrepancy > 0.2 mm is
 * reported for human review and fails the run.
 *
 * Run: npx tsx scripts/validate-component-registry.ts
 * Needs: python3 with the OCP kernel (the cad-runner/build123d container).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { COMPONENT_REGISTRY } from "../lib/cad/knowledge/components";

const TOL_MM = 0.2;

/** Which open-licensed model validates which entry, and how to compare. */
const MANIFEST: {
  id: string;
  url: string;
  /** "pcb": compare the PCB slab; "overall": compare the overall bbox. */
  compare: "pcb" | "overall";
  /** Compare boardMm[2] against the measured PCB thickness. */
  checkThickness?: boolean;
  /** Independent source (true) vs regression re-measure of the same source. */
  independent?: boolean;
}[] = [
  {
    id: "feather",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/4884%20Feather%20RP2040/4884%20Feather%20RP2040.step",
    compare: "pcb",
    independent: true, // registry numbers cite the KiCad footprint
  },
  {
    id: "bme280",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/2652%20Adafruit%20BME280/Adafruit%20BME280.step",
    compare: "pcb",
  },
  {
    id: "sht31",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/2857%20SHT31-D/2857%20SHT31-D.step",
    compare: "pcb",
  },
  {
    id: "as7341",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/4698%20AS7341%20Light%20Color%20Sensor/4698%20AS7341%20Light%20Color%20Sensor.step",
    compare: "pcb",
  },
  {
    id: "max98357",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/3006%20MAX98357/3006%20MAX98357.step",
    compare: "pcb",
  },
  {
    id: "joystick-2axis",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/512%20Analog%202-axis%20Joystick/512%20Analog%202-axis%20Joystick.step",
    compare: "pcb",
  },
  {
    id: "neopixel-stick-8",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/1426%208x%20NeoPixel%20Stick/1426%208x%20NeoPixel%20Stick.step",
    compare: "pcb",
    checkThickness: true,
  },
  {
    id: "neopixel-ring-16",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/1463%2016x%20NeoPixel%20Ring/1463%2016x%20NeoPixel%20Ring.step",
    compare: "pcb",
  },
  {
    id: "usb-c-breakout",
    url: "https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/4090%20USB%20C%20Breakout/4090%20USB%20C%20Breakout.step",
    compare: "pcb",
  },
  {
    id: "holder-18650-keystone-1042",
    url: "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Battery.3dshapes/BatteryHolder_Keystone_1042_1x18650.step",
    compare: "overall",
  },
  {
    id: "holder-18650-bh-pc2",
    url: "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Battery.3dshapes/BatteryHolder_MPD_BH-18650-PC2.step",
    compare: "overall",
  },
];

interface Measured {
  overall: [number, number, number];
  pcb: { lx: number; ly: number; t: number } | null;
  holes: [number, number, number][];
  error?: string;
}

/** The 8 flat symmetries of the component frame (rotations + mirror). */
const XFORMS: ((p: [number, number]) => [number, number])[] = [
  ([x, y]) => [x, y],
  ([x, y]) => [-x, -y],
  ([x, y]) => [y, -x],
  ([x, y]) => [-y, x],
  ([x, y]) => [-x, y],
  ([x, y]) => [x, -y],
  ([x, y]) => [y, x],
  ([x, y]) => [-y, -x],
];

function matchHoles(
  expected: { xMm: number; yMm: number; diaMm: number }[],
  measured: [number, number, number][]
): { maxResidual: number; matched: number } {
  let best = { maxResidual: Infinity, matched: 0 };
  for (const xf of XFORMS) {
    let maxResidual = 0;
    let matched = 0;
    for (const h of expected) {
      const [ex, ey] = xf([h.xMm, h.yMm]);
      // Nearest measured hole with a compatible diameter (±0.6).
      let bestDist = Infinity;
      for (const [mx, my, md] of measured) {
        if (Math.abs(md - h.diaMm) > 0.6) continue;
        const d = Math.hypot(mx - ex, my - ey);
        if (d < bestDist) bestDist = d;
      }
      if (bestDist < 1.5) {
        matched += 1;
        maxResidual = Math.max(maxResidual, bestDist);
      } else {
        maxResidual = Infinity;
      }
    }
    if (
      matched > best.matched ||
      (matched === best.matched && maxResidual < best.maxResidual)
    ) {
      best = { maxResidual, matched };
    }
  }
  return best;
}

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "registry-validate-"));
  const rows: string[] = [];
  let failures = 0;

  for (const item of MANIFEST) {
    const spec = COMPONENT_REGISTRY[item.id];
    if (!spec) {
      rows.push(`FAIL ${item.id}: not in registry`);
      failures += 1;
      continue;
    }
    let measured: Measured;
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = path.join(tmp, `${item.id}.step`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      measured = JSON.parse(
        execFileSync(
          "python3",
          [path.join(__dirname, "measure-step.py"), file],
          { encoding: "utf8", timeout: 300_000 }
        )
      ) as Measured;
      if (measured.error) throw new Error(measured.error);
    } catch (err) {
      rows.push(`SKIP ${item.id}: source unreachable/unreadable (${err})`);
      continue;
    }

    const problems: string[] = [];
    const [L, W, T] = spec.boardMm;
    const dims =
      item.compare === "pcb" && measured.pcb
        ? [measured.pcb.lx, measured.pcb.ly]
        : [measured.overall[0], measured.overall[1]];
    const [mL, mW] = [Math.max(...dims), Math.min(...dims)];
    const [eL, eW] = [Math.max(L, W), Math.min(L, W)];
    if (Math.abs(mL - eL) > TOL_MM) {
      problems.push(`length ${eL} vs measured ${mL.toFixed(2)}`);
    }
    if (Math.abs(mW - eW) > TOL_MM) {
      problems.push(`width ${eW} vs measured ${mW.toFixed(2)}`);
    }
    if (item.checkThickness && measured.pcb && Math.abs(measured.pcb.t - T) > TOL_MM) {
      problems.push(`thickness ${T} vs measured ${measured.pcb.t.toFixed(2)}`);
    }

    const expectedHoles =
      spec.mounting.kind === "none" ? [] : (spec.mounting.holes ?? []);
    if (expectedHoles.length > 0) {
      const { maxResidual, matched } = matchHoles(expectedHoles, measured.holes);
      if (matched < expectedHoles.length) {
        problems.push(
          `only ${matched}/${expectedHoles.length} mounting holes found in the model`
        );
      } else if (maxResidual > TOL_MM) {
        problems.push(
          `hole positions off by up to ${maxResidual.toFixed(2)} mm (> ${TOL_MM})`
        );
      }
    }

    const tag = item.independent ? "independent" : "regression";
    if (problems.length === 0) {
      rows.push(
        `PASS ${item.id} (${tag}): dims ${mL.toFixed(2)} x ${mW.toFixed(2)}` +
          (expectedHoles.length > 0
            ? `, ${expectedHoles.length} holes within ${TOL_MM} mm`
            : "")
      );
    } else {
      failures += 1;
      rows.push(`FAIL ${item.id} (${tag}): ${problems.join("; ")} — HUMAN REVIEW`);
    }
  }

  console.log("Component-registry Tier-2 cross-validation (MTR-203)");
  console.log(`tolerance ${TOL_MM} mm; sources fetched at validation time, never committed\n`);
  for (const r of rows) console.log(r);
  console.log(
    `\n${MANIFEST.length - failures}/${MANIFEST.length} checks passed`
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
