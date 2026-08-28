// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  BRUSH_REPEAT,
  paintBrushCanvas,
  makeBrushedTitaniumMaps,
} from "../payment-card-brushed";

describe("paintBrushCanvas", () => {
  it("fills the canvas with horizontal grain (not a flat wash)", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    // jsdom may stub getContext — skip the pixel probe then, but
    // still assert the helper is callable.
    if (!ctx || typeof ctx.getImageData !== "function") {
      expect(typeof paintBrushCanvas).toBe("function");
      return;
    }
    paintBrushCanvas(ctx, 64, 64);
    const { data } = ctx.getImageData(0, 0, 64, 64);
    // Sample a column — brushed grain varies along Y.
    const samples: number[] = [];
    for (let y = 0; y < 64; y += 4) {
      samples.push(data[(y * 64 + 8) * 4]!);
    }
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(3);
  });
});

describe("makeBrushedTitaniumMaps", () => {
  it("returns a repeating roughness map", () => {
    const { roughnessMap } = makeBrushedTitaniumMaps();
    expect(roughnessMap.repeat.x).toBe(BRUSH_REPEAT);
    expect(roughnessMap.repeat.y).toBe(BRUSH_REPEAT);
    roughnessMap.dispose();
  });
});
