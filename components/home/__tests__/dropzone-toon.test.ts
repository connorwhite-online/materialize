import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOON_INK, TOON_OUTLINE_THICKNESS } from "../dropzone-toon";

describe("dropzone primitives shading", () => {
  const src = readFileSync(
    resolve(__dirname, "../dropzone-primitives.tsx"),
    "utf8"
  );

  it("uses unlit toon fills and ink outlines, not PBR, IBL, or cel ramps", () => {
    expect(src).toContain("meshBasicMaterial");
    expect(src).toContain("Outlines");
    expect(src).toContain("TOON_INK");
    expect(src).toContain("TOON_OUTLINE_THICKNESS");
    expect(src).not.toContain("meshToonMaterial");
    expect(src).not.toContain("meshPhysicalMaterial");
    expect(src).not.toContain("StudioEnvironment");
    expect(src).toContain("screenspace");
  });

  it("inks in the warm near-black, not pure black", () => {
    expect(TOON_INK).toMatch(/^#2/);
    expect(TOON_INK.toLowerCase()).not.toBe("#000000");
  });

  it("keeps outline thickness in world units, not screen pixels", () => {
    expect(TOON_OUTLINE_THICKNESS).toBeGreaterThan(0.02);
    expect(TOON_OUTLINE_THICKNESS).toBeLessThan(0.08);
  });
});
