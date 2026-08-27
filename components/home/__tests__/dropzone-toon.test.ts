import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DROPZONE_MOBILE_MAX_WIDTH,
  DROPZONE_MOBILE_POSITION,
  DROPZONE_MOBILE_SCALE,
  DROPZONE_SQUARE_RADIUS,
  TOON_INK,
  TOON_OUTLINE_THICKNESS,
  TOON_PENCIL_STRENGTH,
} from "../dropzone-toon";
import { DROPZONE_LOOKS } from "../dropzone-looks";

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luma({ r, g, b }: { r: number; g: number; b: number }) {
  return r + g + b;
}

function chroma({ r, g, b }: { r: number; g: number; b: number }) {
  return Math.max(r, g, b) - Math.min(r, g, b);
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

  it("uses the flat sketch shader and ink outlines, not PBR or cel bands", () => {
    expect(src).toContain("DropzoneToonMaterial");
    expect(src).toContain("Outlines");
    expect(src).toContain("TOON_INK");
    expect(src).toContain("screenspace");
    expect(src).not.toContain("meshBasicMaterial");
    expect(src).not.toContain("meshToonMaterial");
    expect(src).not.toContain("meshPhysicalMaterial");
    expect(src).not.toContain("StudioEnvironment");
    expect(shader).not.toContain("celstep");
    expect(shader).not.toContain("specBlob");
    expect(shader).not.toContain("deepBand");
  });

  it("shades with a flat fill and soft pencil, plus paper grain", () => {
    expect(shader).toContain("uColor");
    expect(shader).toContain("uShadow");
    expect(shader).toContain("uPencil");
    expect(shader).toContain("paperGrain");
    expect(shader).toContain("look.toonColor");
    expect(shader).toContain("look.toonShadow");
    expect(TOON_PENCIL_STRENGTH).toBeGreaterThan(0.1);
    expect(TOON_PENCIL_STRENGTH).toBeLessThan(0.4);
  });

  it("inks in the warm near-black, not pure black", () => {
    expect(TOON_INK).toMatch(/^#2/);
    expect(TOON_INK.toLowerCase()).not.toBe("#000000");
  });

  it("keeps outline thickness in world units, not screen pixels", () => {
    expect(TOON_OUTLINE_THICKNESS).toBeGreaterThan(0.02);
    expect(TOON_OUTLINE_THICKNESS).toBeLessThan(0.08);
  });

  it("places primitives in frustum fractions so they clip the well", () => {
    expect(src).toContain("viewport.width");
    expect(src).toContain("viewport.height");
  });

  it("shrinks shapes on narrow canvases so they fit the mobile well", () => {
    expect(src).toContain("DROPZONE_MOBILE_SCALE");
    expect(src).toContain("DROPZONE_MOBILE_POSITION");
    expect(DROPZONE_MOBILE_MAX_WIDTH).toBeGreaterThan(400);
    expect(DROPZONE_MOBILE_MAX_WIDTH).toBeLessThan(700);
    expect(DROPZONE_MOBILE_SCALE).toBeGreaterThan(0.5);
    expect(DROPZONE_MOBILE_SCALE).toBeLessThan(0.85);
    expect(DROPZONE_MOBILE_POSITION).toBeGreaterThan(0.75);
    expect(DROPZONE_MOBILE_POSITION).toBeLessThan(1);
  });

  it("keeps the square chubby-round", () => {
    expect(DROPZONE_SQUARE_RADIUS).toBeGreaterThanOrEqual(0.3);
    expect(DROPZONE_SQUARE_RADIUS).toBeLessThan(0.45);
    expect(src).toContain("DROPZONE_SQUARE_RADIUS");
  });

  it("paints the CSS stand-in as a flat fill with ink ring", () => {
    const fallback = readFileSync(
      resolve(__dirname, "../dropzone-primitives-fallback.tsx"),
      "utf8"
    );
    expect(fallback).toContain("look.toonColor");
    expect(fallback).toContain("TOON_INK");
    expect(fallback).not.toContain("toonDeep");
    expect(fallback).not.toContain("linear-gradient");
  });
});

describe("toon sketch tints", () => {
  it("tints the three live primitives as pastel hues, not grey", () => {
    const steel = rgb(DROPZONE_LOOKS.steel.toonColor);
    expect(steel.b).toBeGreaterThan(steel.r);
    expect(steel.r).toBeGreaterThanOrEqual(steel.g);
    expect(chroma(steel)).toBeGreaterThan(40);

    const resin = rgb(DROPZONE_LOOKS.resin.toonColor);
    expect(resin.r).toBeGreaterThan(resin.g);
    expect(resin.r).toBeGreaterThan(resin.b);
    expect(chroma(resin)).toBeGreaterThan(40);

    const pla = rgb(DROPZONE_LOOKS.pla.toonColor);
    expect(pla.g).toBeGreaterThan(pla.r);
    expect(pla.g).toBeGreaterThan(pla.b);
    expect(pla.r).toBeGreaterThan(pla.b);
    expect(chroma(pla)).toBeGreaterThan(40);
  });

  it("keeps the pencil shade darker than the flat fill on every look", () => {
    for (const look of Object.values(DROPZONE_LOOKS)) {
      expect(luma(rgb(look.toonShadow))).toBeLessThan(luma(rgb(look.toonColor)));
      expect(look.toonShadow).not.toBe(look.toonColor);
    }
  });
});
