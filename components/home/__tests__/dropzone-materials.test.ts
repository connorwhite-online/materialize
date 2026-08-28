import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DROPZONE_MOBILE_MAX_WIDTH,
  DROPZONE_MOBILE_POSITION,
  DROPZONE_MOBILE_SCALE,
  DROPZONE_SQUARE_RADIUS,
  DROPZONE_LOOKS,
} from "../dropzone-looks";

describe("dropzone primitives materials", () => {
  const src = readFileSync(
    resolve(__dirname, "../dropzone-primitives.tsx"),
    "utf8"
  );

  it("renders printable PBR materials under studio IBL, not toon/cel", () => {
    expect(src).toContain("meshPhysicalMaterial");
    expect(src).toContain("DropzoneEnvironment");
    expect(src).toContain("Environment");
    expect(src).toContain("Lightformer");
    expect(src).toContain("directionalLight");
    expect(src).toContain("PhysicalSkin");
    expect(src).toContain("makeRoundedPyramidGeometry");
    expect(src).not.toContain("DropzoneToonMaterial");
    expect(src).not.toContain("Outlines");
    expect(src).not.toContain("meshBasicMaterial");
    expect(src).not.toContain("meshToonMaterial");
    expect(src).not.toContain("coneGeometry");
    expect(src).not.toContain("flatShading");
  });

  it("uses per-shape soft contact shadows (no hard shadow maps)", () => {
    expect(src).toContain("ContactShadows");
    expect(src).toContain("PrimitiveContactShadow");
    expect(src).toContain("envMapIntensity");
    expect(src).toMatch(/PrimitiveContactShadow[\s\S]*?resolution=\{768\}/);
    expect(src).toMatch(/Environment resolution=\{512\}/);
    // One floor catcher + hard maps looked noisy on the short well.
    expect(src).not.toContain("CardShadowCatcher");
    expect(src).not.toContain("CardContactShadows");
    expect(src).not.toContain("shadowMaterial");
    expect(src).not.toContain("castShadow");
  });

  it("wires stainless / resin / nylon PBR fields onto the physical material", () => {
    expect(src).toContain("look.metalness");
    expect(src).toContain("look.roughness");
    expect(src).toContain("look.transmission");
    expect(src).toContain("look.clearcoat");
    expect(DROPZONE_LOOKS.steel.metalness).toBe(1);
    expect(DROPZONE_LOOKS.resin.transmission).toBeGreaterThan(0.5);
    expect(DROPZONE_LOOKS.nylon.metalness).toBe(0);
    expect(DROPZONE_LOOKS.nylon.roughness).toBeGreaterThan(0.5);
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

  it("places primitives in frustum fractions", () => {
    expect(src).toContain("viewport.width");
    expect(src).toContain("viewport.height");
  });

  it("paints the CSS stand-in from the material colours", () => {
    const fallback = readFileSync(
      resolve(__dirname, "../dropzone-primitives-fallback.tsx"),
      "utf8"
    );
    expect(fallback).toContain("look.color");
    expect(fallback).toContain("look.metalness");
    expect(fallback).toContain("linear-gradient");
    expect(fallback).toContain("boxShadow");
    expect(fallback).not.toContain("toonColor");
    expect(fallback).not.toContain("TOON_INK");
  });
});
