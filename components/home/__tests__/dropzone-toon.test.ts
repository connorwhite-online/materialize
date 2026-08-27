import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { makeToonRamp, TOON_INK } from "../dropzone-toon";

describe("makeToonRamp", () => {
  it("is a 3-stop nearest-filtered grayscale ramp", () => {
    const tex = makeToonRamp();
    expect(tex.image.width).toBe(3);
    expect(tex.image.height).toBe(1);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    tex.dispose();
  });
});

describe("dropzone primitives shading", () => {
  const src = readFileSync(
    resolve(__dirname, "../dropzone-primitives.tsx"),
    "utf8"
  );

  it("uses toon fills and ink outlines, not PBR + IBL", () => {
    expect(src).toContain("meshToonMaterial");
    expect(src).toContain("Outlines");
    expect(src).toContain("TOON_INK");
    expect(src).not.toContain("meshPhysicalMaterial");
    expect(src).not.toContain("StudioEnvironment");
  });

  it("inks in the warm near-black, not pure black", () => {
    expect(TOON_INK).toMatch(/^#2/);
    expect(TOON_INK.toLowerCase()).not.toBe("#000000");
  });
});
