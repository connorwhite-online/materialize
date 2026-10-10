import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { paletteKey, type IsometricPalette } from "../palette";
import { isometricMatrix } from "../pose";

const palette: IsometricPalette = {
  top: [1, 1, 1],
  left: [0.9, 0.9, 0.9],
  right: [0.8, 0.8, 0.8],
  ink: [0.4, 0.4, 0.4],
};

describe("paletteKey", () => {
  it("is stable for equal colours and changes when one does", () => {
    expect(paletteKey(palette)).toBe(paletteKey({ ...palette }));
    expect(paletteKey(palette)).not.toBe(paletteKey({ ...palette, ink: [0, 0, 0] }));
  });
});

describe("isometricMatrix", () => {
  it("foreshortens all three axes equally (true isometric)", () => {
    const m = isometricMatrix();
    const lengths = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ].map((v) => {
      v.applyMatrix4(m);
      return Math.hypot(v.x, v.y); // projected onto the screen (camera looks down -Z)
    });
    expect(lengths[0]).toBeCloseTo(lengths[1], 6);
    expect(lengths[1]).toBeCloseTo(lengths[2], 6);
  });
});
