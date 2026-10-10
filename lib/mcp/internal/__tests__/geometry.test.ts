import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage", () => ({ getObjectBytes: vi.fn() }));

import { hasDimensions, measureGeometry } from "../geometry";

describe("measureGeometry", () => {
  it("measures the review calibration cube as 20mm and 8 cm³", () => {
    const bytes = new Uint8Array(
      readFileSync(join(process.cwd(), "public/review/calibration-cube-20mm.stl"))
    );
    const g = measureGeometry(bytes, "stl", "mm");
    expect(g).not.toBeNull();
    expect(g!.dimensions.x).toBeCloseTo(20, 3);
    expect(g!.dimensions.y).toBeCloseTo(20, 3);
    expect(g!.dimensions.z).toBeCloseTo(20, 3);
    expect(g!.volume).toBeCloseTo(8000, 0);
    expect(g!.triangleCount).toBe(12);
  });

  it("returns null for formats it can't parse", () => {
    expect(measureGeometry(new Uint8Array([1, 2, 3]), "step", "mm")).toBeNull();
  });
});

describe("hasDimensions", () => {
  it("treats CraftCloud's all-zero dimensions as missing", () => {
    expect(hasDimensions({ dimensions: { x: 0, y: 0, z: 0 } })).toBe(false);
    expect(hasDimensions(null)).toBe(false);
    expect(hasDimensions({})).toBe(false);
    expect(hasDimensions({ dimensions: { x: 20, y: 20, z: 20 } })).toBe(true);
  });
});
