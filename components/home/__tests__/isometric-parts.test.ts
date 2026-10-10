import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { PART_BUILDERS } from "../isometric-parts";
import { DROPZONE_PARTS } from "../dropzone-parts-layout";

describe("isometric parts", () => {
  for (const [kind, build] of Object.entries(PART_BUILDERS)) {
    it(`${kind}: builds a centred, unit-extent mesh with normals`, () => {
      const g = build();
      const pos = g.getAttribute("position");
      expect(pos.count).toBeGreaterThan(0);
      expect(pos.count % 3).toBe(0);
      expect(g.getAttribute("normal")).toBeTruthy();
      g.computeBoundingBox();
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      g.boundingBox!.getSize(size);
      g.boundingBox!.getCenter(centre);
      expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1, 5);
      expect(centre.length()).toBeLessThan(1e-6);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }
    });
  }

  it("every layout slot names a part that exists", () => {
    for (const spec of DROPZONE_PARTS) {
      expect(PART_BUILDERS[spec.kind]).toBeTypeOf("function");
    }
  });
});
