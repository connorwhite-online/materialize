import { describe, expect, it } from "vitest";

import type { CadBrief } from "../../brief";
import {
  COMPONENT_REGISTRY,
  componentFor,
  devBoardFor,
  fitSpecForComponent,
  fitTargetsForBrief,
  formatComponentCatalog,
} from "../components";

function briefWith(components: Array<Record<string, unknown>>): CadBrief {
  return { components, interfaces: [], keepOut: [] } as unknown as CadBrief;
}

describe("componentFor alias resolution (MTR-203)", () => {
  it("resolves ids, labels and aliases in every category", () => {
    expect(componentFor("Raspberry Pi Pico")?.id).toBe("pico");
    expect(componentFor("BME280")?.id).toBe("bme280");
    expect(componentFor("sg90 servo")?.id).toBe("sg90");
    expect(componentFor("1602 LCD")?.id).toBe("lcd1602");
    expect(componentFor("TP4056")?.id).toBe("tp4056");
    expect(componentFor("Pi Camera Module 3")?.id).toBe("rpi-camera-3");
  });

  it("prefers the longest matching alias over a shorter cross-entry alias", () => {
    // "esp32" alone is a DevKitC alias; "esp32 feather" must win as Feather.
    expect(componentFor("esp32")?.id).toBe("esp32-devkitc");
    expect(componentFor("ESP32 Feather")?.id).toBe("feather");
    expect(componentFor("esp32 cam")?.id).toBe("esp32-cam");
  });

  it("devBoardFor stays board-only", () => {
    expect(devBoardFor("pico")?.id).toBe("pico");
    expect(devBoardFor("sg90")).toBeNull();
    expect(devBoardFor("1602 lcd")).toBeNull();
  });

  it("returns null for unknown names and empty strings", () => {
    expect(componentFor("mystery widget 9000")).toBeNull();
    expect(componentFor("")).toBeNull();
  });
});

describe("verified gating (MTR-203)", () => {
  it("unverified entries never contribute enforceable holes or ports", () => {
    for (const spec of Object.values(COMPONENT_REGISTRY)) {
      if (spec.provenance?.verified === true) continue;
      const fit = fitSpecForComponent(spec);
      expect(fit.holes, `${spec.id} holes must not be enforced`).toBeNull();
      expect(fit.ports, `${spec.id} ports must not be enforced`).toEqual([]);
    }
  });

  it("ssd1306-0.96 (holes present but unverified) emits only a cavity target", () => {
    const targets = fitTargetsForBrief(
      briefWith([{ name: "ssd1306", box: [28, 28, 4] }])
    );
    expect(targets.map((t) => t.kind)).toEqual(["fit_cavity"]);
  });

  it("verified entries emit bosses and cutout/window targets", () => {
    const targets = fitTargetsForBrief(
      briefWith([{ name: "1602 lcd", box: [80, 36, 10] }])
    );
    const kinds = targets.map((t) => t.kind).sort();
    expect(kinds).toEqual(["fit_bosses", "fit_cavity", "fit_cutout"]);
    const window = targets.find((t) => t.kind === "fit_cutout");
    expect(window!.id).toBe("fit:lcd1602:port:screen-window");
  });

  it("screen windows ride the fit spec as +z face ports", () => {
    const lcd = COMPONENT_REGISTRY["lcd1602"];
    const spec = fitSpecForComponent(lcd);
    expect(spec.ports).toHaveLength(1);
    expect(spec.ports[0]).toMatchObject({
      face: "+z",
      xMm: 0,
      yMm: 0,
      wMm: 64.5,
      hMm: 15.0,
    });
  });

  it("approx exits are skipped even on verified entries", () => {
    const feather = COMPONENT_REGISTRY["feather"];
    expect(feather.provenance?.verified).toBe(true);
    const spec = fitSpecForComponent(feather);
    // Feather USB-C is position-verified (non-approx) — it must be enforced…
    expect(spec.ports.map((p) => p.id)).toEqual(["usb-c"]);
    // …while the AS7341's approx sensor window must not be.
    const as7341 = fitSpecForComponent(COMPONENT_REGISTRY["as7341"]);
    expect(as7341.ports).toEqual([]);
    expect(as7341.holes).not.toBeNull();
  });

  it("verified flange holes (28BYJ-48 ears) emit boss targets", () => {
    const targets = fitTargetsForBrief(
      briefWith([{ name: "28BYJ-48", box: [42, 28, 30] }])
    );
    expect(targets.some((t) => t.kind === "fit_bosses")).toBe(true);
  });
});

describe("registry schema integrity (MTR-203)", () => {
  const entries = Object.entries(COMPONENT_REGISTRY);

  it("has entries in every category", () => {
    const cats = new Set(entries.map(([, s]) => s.category));
    expect([...cats].sort()).toEqual([
      "actuator",
      "board",
      "camera",
      "display",
      "power",
      "sensor",
    ]);
  });

  it("every entry is well-formed", () => {
    for (const [key, spec] of entries) {
      expect(spec.id, `key/id mismatch for ${key}`).toBe(key);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.boardMm).toHaveLength(3);
      for (const v of spec.boardMm) expect(v).toBeGreaterThan(0);
      // Component frame convention: +x is the long axis.
      expect(
        spec.boardMm[0] >= spec.boardMm[1],
        `${key}: boardMm must be length-major`
      ).toBe(true);
      for (const alias of spec.aliases) {
        expect(alias, `${key} aliases must be lowercase`).toBe(
          alias.toLowerCase()
        );
      }
    }
  });

  it("every entry carries provenance with the required fields", () => {
    for (const [key, spec] of entries) {
      expect(spec.provenance, `${key} must carry provenance`).toBeTruthy();
      const p = spec.provenance!;
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.docRevision.length).toBeGreaterThan(0);
      expect(p.dateChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof p.verified).toBe("boolean");
    }
  });

  it("holes are inside the footprint; +z exits carry centers and sizes when enforced", () => {
    for (const [key, spec] of entries) {
      const holes =
        spec.mounting.kind === "none" ? [] : (spec.mounting.holes ?? []);
      const [L, W] = spec.boardMm;
      const flangeSpan =
        spec.mounting.kind === "flange"
          ? (spec.mounting.flangeSpanMm ?? L * 2)
          : L;
      for (const h of holes) {
        expect(h.diaMm).toBeGreaterThan(0);
        // Flange ears legitimately overhang the body; cap at the flange span.
        const maxX = spec.mounting.kind === "flange" ? flangeSpan / 2 : L / 2;
        expect(Math.abs(h.xMm), `${key} hole x within bounds`).toBeLessThanOrEqual(maxX + 0.01);
        expect(Math.abs(h.yMm), `${key} hole y within bounds`).toBeLessThanOrEqual(W / 2 + 0.01);
      }
      for (const e of spec.exits) {
        if (e.direction === "+z" || e.direction === "-z") {
          expect(e.centerMm, `${key} ${e.kind}: +z exits need centerMm`).toBeTruthy();
          if (!e.approx) {
            expect(
              e.dims ?? e.diaMm,
              `${key} ${e.kind}: enforced +z exits need dims or diaMm`
            ).toBeTruthy();
          }
        } else {
          expect(e.edge, `${key} ${e.kind}: lateral exits need an edge`).toBeTruthy();
        }
      }
    }
  });

  it("the prompt catalog renders one line per entry under category headers", () => {
    const catalog = formatComponentCatalog();
    expect(catalog).toContain("Dev boards:");
    expect(catalog).toContain("Sensors & input modules:");
    const lines = catalog.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBe(entries.length);
  });
});
