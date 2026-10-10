import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage", () => ({ getObjectBytes: vi.fn() }));

import { measureGeometry } from "../geometry";

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
