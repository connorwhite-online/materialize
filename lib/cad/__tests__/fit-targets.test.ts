import { describe, expect, it } from "vitest";

import {
  buildFitChecksFromTargets,
  isFitTargetKind,
  type DimensionTarget,
} from "../dimension-check";
import { fitTargetsForBrief } from "../knowledge/components";
import type { CadBrief } from "../brief";

function briefWith(components: Array<Record<string, unknown>>): CadBrief {
  return {
    components,
    interfaces: [],
    keepOut: [],
  } as unknown as CadBrief;
}

describe("fitTargetsForBrief (MTR-204)", () => {
  it("emits a cavity fit target for a known board named in the brief", () => {
    const targets = fitTargetsForBrief(
      briefWith([{ name: "Raspberry Pi Pico", box: [51, 21, 4] }])
    );
    const cavity = targets.filter((t) => t.kind === "fit_cavity");
    expect(cavity).toHaveLength(1);
    expect(cavity[0].fit).toBeTruthy();
    expect(cavity[0].id).toBe("fit:pico:cavity");
  });

  it("dedupes when the same board is named twice", () => {
    const targets = fitTargetsForBrief(
      briefWith([
        { name: "pico", box: [51, 21, 4] },
        { name: "Raspberry Pi Pico W", box: [51, 21, 4] },
      ])
    );
    expect(targets.filter((t) => t.kind === "fit_cavity")).toHaveLength(1);
  });

  it("emits nothing for unknown components", () => {
    const targets = fitTargetsForBrief(
      briefWith([{ name: "mystery widget", box: [10, 10, 10] }])
    );
    expect(targets).toHaveLength(0);
  });

  it("emits boss targets only when the board has verified hole positions", () => {
    const pico = fitTargetsForBrief(
      briefWith([{ name: "pico", box: [51, 21, 4] }])
    );
    const devkit = fitTargetsForBrief(
      briefWith([{ name: "ESP32 DevKitC", box: [55, 28, 13] }])
    );
    // Pico's 4-hole pattern is drawing-verified in components.ts; DevKitC has
    // no mounting holes at all — the asymmetry is the point of the test.
    expect(pico.some((t) => t.kind === "fit_bosses")).toBe(true);
    expect(devkit.some((t) => t.kind === "fit_bosses")).toBe(false);
  });
});

describe("buildFitChecksFromTargets", () => {
  it("builds the sidecar checks payload from cavity targets", () => {
    const targets = fitTargetsForBrief(
      briefWith([{ name: "pico", box: [51, 21, 4] }])
    );
    const checks = buildFitChecksFromTargets(targets);
    expect(checks).not.toBeNull();
    expect(checks!.components.length).toBeGreaterThan(0);
  });

  it("returns null when no fit targets are present", () => {
    const plain: DimensionTarget[] = [
      {
        label: "width",
        kind: "bbox_span",
        id: "d:width",
        axis: "x",
        value: 50,
        tolerance: 0.5,
      } as DimensionTarget,
    ];
    expect(buildFitChecksFromTargets(plain)).toBeNull();
    expect(buildFitChecksFromTargets([])).toBeNull();
    expect(buildFitChecksFromTargets(null)).toBeNull();
  });
});

describe("isFitTargetKind", () => {
  it("discriminates fit kinds from dimensional kinds", () => {
    expect(isFitTargetKind("fit_cavity")).toBe(true);
    expect(isFitTargetKind("fit_bosses")).toBe(true);
    expect(isFitTargetKind("fit_cutout")).toBe(true);
    expect(isFitTargetKind("bbox_span")).toBe(false);
    expect(isFitTargetKind("count")).toBe(false);
  });
});
