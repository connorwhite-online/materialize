import { describe, it, expect } from "vitest";
import { processLimits, withCatalogLimits } from "../limits";
import { MATERIALS } from "@/lib/materials/preset-library";
import { designLimits, formatLimit } from "@/lib/craftcloud/design-limits";

const sls = { name: "SLS", minWallThickness: 0.8, minDetails: 0.3 };
const mjf = { name: "MJF", minWallThickness: 0.6, minDetails: 0.25 };

describe("withCatalogLimits", () => {
  it("replaces editorial limits with the catalog's", () => {
    const [m] = withCatalogLimits(
      MATERIALS.filter((x) => x.id === "nylon-pa12"),
      () => ({
        id: "cc",
        name: "SLS Nylon PA12",
        maximumPrintingDimensions: [700, 380, 580],
        printingMethods: [mjf, sls],
      })
    );
    expect(m.limitsFrom).toBe("craftcloud");
    // Takes the method the editorial row names (SLS), not the first one.
    expect(m.constraints.minWallThickness).toBe(0.8);
    expect(m.constraints.minDetail).toBe(0.3);
    expect(m.constraints.maxDimensions).toEqual({ x: 700, y: 380, z: 580 });
  });

  it("falls back to editorial numbers when the catalog has none", () => {
    const original = MATERIALS.find((x) => x.id === "pla-white")!;
    const [m] = withCatalogLimits([original], () => null);
    expect(m.limitsFrom).toBe("editorial");
    expect(m.constraints).toEqual(original.constraints);
  });

  it("keeps editorial values for fields the catalog leaves empty", () => {
    const original = MATERIALS.find((x) => x.id === "petg")!;
    const [m] = withCatalogLimits([original], () => ({
      id: "cc",
      name: "PETG",
      printingMethods: [{ name: "FDM", minWallThickness: 1, minDetails: null }],
    }));
    expect(m.constraints.minWallThickness).toBe(1);
    expect(m.constraints.minDetail).toBe(original.constraints.minDetail);
    expect(m.constraints.maxDimensions).toEqual(original.constraints.maxDimensions);
  });
});

describe("processLimits", () => {
  it("summarises 3D-printing processes and skips CNC", () => {
    const rows = processLimits([
      { id: "1", name: "a", technology: "3d_printing", maximumPrintingDimensions: [100, 100, 100], printingMethods: [sls] },
      { id: "2", name: "b", technology: "3d_printing", maximumPrintingDimensions: [700, 380, 580], printingMethods: [sls] },
      { id: "3", name: "c", technology: "cnc", printingMethods: [{ name: "CNC", minWallThickness: null }] },
    ]);
    expect(rows).toEqual([
      { process: "SLS", minWallMm: 0.8, minDetailMm: 0.3, maxBuildMm: [700, 380, 580], materialCount: 2 },
    ]);
  });
});

describe("designLimits / formatLimit", () => {
  it("collapses agreeing processes and spells out differing ones", () => {
    expect(formatLimit(designLimits({ printingMethods: [sls, { ...sls, name: "X" }] }), (l) => l.minWallMm)).toBe("0.8 mm");
    expect(formatLimit(designLimits({ printingMethods: [sls, mjf] }), (l) => l.minWallMm)).toBe("SLS 0.8 mm, MJF 0.6 mm");
    expect(formatLimit(designLimits({ printingMethods: [{ name: "CNC" }] }), (l) => l.minWallMm)).toBeNull();
  });
});

describe("withCatalogLimits process fallback", () => {
  it("uses the process's wall minimum when no catalog material matches", () => {
    const original = MATERIALS.find((x) => x.id === "mjf-pa11")!;
    const [m] = withCatalogLimits([original], () => null, [
      { process: "MJF", minWallMm: 0.8, minDetailMm: 0.25, maxBuildMm: [520, 520, 830], materialCount: 19 },
    ]);
    expect(m.limitsFrom).toBe("craftcloud");
    expect(m.constraints.minWallThickness).toBe(0.8);
    // The editorial build volume stays: "largest anywhere" would pass everything.
    expect(m.constraints.maxDimensions).toEqual(original.constraints.maxDimensions);
  });

  it("reads our DMLS as CraftCloud's SLM / DMLS", () => {
    const original = MATERIALS.find((x) => x.id === "inconel-625")!;
    const [m] = withCatalogLimits([original], () => null, [
      { process: "SLM / DMLS", minWallMm: 1, minDetailMm: 0.25, maxBuildMm: null, materialCount: 15 },
    ]);
    expect(m.constraints.minWallThickness).toBe(1);
  });
});
