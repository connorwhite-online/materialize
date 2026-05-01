import { describe, it, expect } from "vitest";
import { modelFitsInVolume } from "../fits-volume";

describe("modelFitsInVolume", () => {
  it("returns true when model fits in same orientation", () => {
    expect(modelFitsInVolume([100, 100, 100], [220, 220, 250])).toBe(true);
  });

  it("returns true when model only fits after rotation", () => {
    // Long thin part: 200x50x50. Build volume 80x80x250 — only fits
    // standing up. The naive xyz-aligned test would say no.
    expect(modelFitsInVolume([200, 50, 50], [80, 80, 250])).toBe(true);
  });

  it("returns false when no rotation fits", () => {
    // 300mm in a single axis exceeds every dim of a 250mm cube.
    expect(modelFitsInVolume([300, 50, 50], [250, 250, 250])).toBe(false);
  });

  it("returns true on exact fit", () => {
    expect(modelFitsInVolume([220, 220, 250], [220, 220, 250])).toBe(true);
  });

  it("returns false when volume is null/undefined", () => {
    expect(modelFitsInVolume([10, 10, 10], null)).toBe(false);
    expect(modelFitsInVolume([10, 10, 10], undefined)).toBe(false);
  });

  it("returns true when input is permuted (rotation handled)", () => {
    expect(modelFitsInVolume([50, 200, 50], [80, 80, 250])).toBe(true);
    expect(modelFitsInVolume([50, 50, 200], [80, 80, 250])).toBe(true);
  });
});
