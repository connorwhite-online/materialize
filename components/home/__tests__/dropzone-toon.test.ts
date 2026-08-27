import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOON_INK, TOON_OUTLINE_THICKNESS } from "../dropzone-toon";
import { DROPZONE_LOOKS } from "../dropzone-looks";

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luma({ r, g, b }: { r: number; g: number; b: number }) {
  return r + g + b;
}

describe("dropzone primitives shading", () => {
  const src = readFileSync(
    resolve(__dirname, "../dropzone-primitives.tsx"),
    "utf8"
  );
  const shader = readFileSync(
    resolve(__dirname, "../dropzone-toon-material.tsx"),
    "utf8"
  );

  it("uses the colored toon shader and ink outlines, not PBR or flat unlit", () => {
    expect(src).toContain("DropzoneToonMaterial");
    expect(src).toContain("Outlines");
    expect(src).toContain("TOON_INK");
    expect(src).toContain("screenspace");
    expect(src).not.toContain("meshBasicMaterial");
    expect(src).not.toContain("meshToonMaterial");
    expect(src).not.toContain("meshPhysicalMaterial");
    expect(src).not.toContain("StudioEnvironment");
  });

  it("shades with a wrapped Lambert mix into hue-shifted shadow and highlight", () => {
    expect(shader).toContain("uShadow");
    expect(shader).toContain("uHighlight");
    expect(shader).toContain("smoothstep");
    expect(shader).toContain("look.toonColor");
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

function chroma({ r, g, b }: { r: number; g: number; b: number }) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

describe("toon gradient tints", () => {
  it("tints the three live primitives as pastel hues, not grey", () => {
    const steel = rgb(DROPZONE_LOOKS.steel.toonColor);
    expect(steel.b).toBeGreaterThan(steel.r);
    expect(steel.r).toBeGreaterThanOrEqual(steel.g);
    expect(chroma(steel)).toBeGreaterThan(50);

    const resin = rgb(DROPZONE_LOOKS.resin.toonColor);
    expect(resin.r).toBeGreaterThan(resin.g);
    expect(resin.g).toBeGreaterThanOrEqual(resin.b);
    expect(chroma(resin)).toBeGreaterThan(50);

    const pla = rgb(DROPZONE_LOOKS.pla.toonColor);
    expect(pla.g).toBeGreaterThan(pla.r);
    expect(pla.g).toBeGreaterThan(pla.b);
    expect(pla.r).toBeGreaterThan(pla.b);
    expect(chroma(pla)).toBeGreaterThan(50);
  });

  it("keeps the highlight lighter than the toon mid on every look", () => {
    for (const look of Object.values(DROPZONE_LOOKS)) {
      expect(luma(rgb(look.toonHighlight))).toBeGreaterThan(
        luma(rgb(look.toonColor))
      );
      expect(luma(rgb(look.toonShadow))).toBeLessThan(luma(rgb(look.toonColor)));
      expect(look.toonShadow).not.toBe(look.toonColor);
      expect(look.toonHighlight).not.toBe(look.toonColor);
    }
  });
});
