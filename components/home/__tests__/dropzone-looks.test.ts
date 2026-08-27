import { describe, it, expect } from "vitest";
import { DROPZONE_LOOKS, DROPZONE_PRIMITIVES } from "../dropzone-looks";
import { HERO_MATERIALS, getMaterialById } from "@/lib/materials";

function heroLook(catalogId: string) {
  return HERO_MATERIALS.find((m) => m.id === catalogId);
}

describe("DROPZONE_LOOKS", () => {
  it("steel matches the 316L catalog row", () => {
    const steel = getMaterialById("steel-316l")!;
    expect(DROPZONE_LOOKS.steel.catalogId).toBe("steel-316l");
    expect(DROPZONE_LOOKS.steel.color).toBe(steel.color);
    expect(DROPZONE_LOOKS.steel.metalness).toBe(steel.pbr.metalness);
    expect(DROPZONE_LOOKS.steel.roughness).toBe(steel.pbr.roughness);
  });

  it("resin and PLA follow the hero overrides, not the stock rows", () => {
    const resin = heroLook("resin-standard")!;
    expect(DROPZONE_LOOKS.resin.color).toBe(resin.color);
    expect(DROPZONE_LOOKS.resin.transmission).toBe(resin.pbr.transmission);
    expect(DROPZONE_LOOKS.resin.clearcoat).toBe(resin.pbr.clearcoat);

    const pla = heroLook("pla-white")!;
    expect(DROPZONE_LOOKS.pla.color).toBe(pla.color);
    expect(DROPZONE_LOOKS.pla.roughness).toBe(pla.pbr.roughness);
    expect(DROPZONE_LOOKS.pla.clearcoat).toBe(pla.pbr.clearcoat);
  });

  it("gold and aluminum match the catalog", () => {
    const gold = getMaterialById("gold-18k")!;
    expect(DROPZONE_LOOKS.gold.color).toBe(gold.color);
    expect(DROPZONE_LOOKS.gold.metalness).toBe(gold.pbr.metalness);
    expect(DROPZONE_LOOKS.gold.roughness).toBe(gold.pbr.roughness);

    const aluminum = getMaterialById("aluminum")!;
    expect(DROPZONE_LOOKS.aluminum.color).toBe(aluminum.color);
    expect(DROPZONE_LOOKS.aluminum.metalness).toBe(aluminum.pbr.metalness);
    expect(DROPZONE_LOOKS.aluminum.roughness).toBe(aluminum.pbr.roughness);
  });
});

describe("DROPZONE_PRIMITIVES", () => {
  it("uses a steel cube, resin sphere, and PLA rounded triangle", () => {
    const kinds = DROPZONE_PRIMITIVES.map((p) => p.kind);
    expect(kinds).toEqual(["roundedBox", "sphere", "roundedTriangle"]);
    expect(DROPZONE_PRIMITIVES.map((p) => p.look)).toEqual([
      "steel",
      "resin",
      "pla",
    ]);
  });

  it("keeps each used look unique", () => {
    const looks = DROPZONE_PRIMITIVES.map((p) => p.look);
    expect(looks).toEqual([...new Set(looks)]);
  });

  it("rotates slowly so the backdrop does not tumble", () => {
    for (const spec of DROPZONE_PRIMITIVES) {
      for (const speed of spec.rotSpeed) {
        expect(Math.abs(speed)).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it("parks shapes on the edges so the copy stays clear", () => {
    const [cube, sphere, triangle] = DROPZONE_PRIMITIVES;
    expect(cube.position[0]).toBeLessThan(-1.5);
    expect(sphere.position[0]).toBeGreaterThan(1.5);
    // Triangle gets the lower-left pocket, not a nest under the sphere.
    expect(triangle.position[0]).toBeLessThan(-1.0);
    expect(triangle.position[1]).toBeLessThan(-0.4);
    const distFromCube = Math.hypot(
      cube.position[0] - triangle.position[0],
      cube.position[1] - triangle.position[1]
    );
    expect(distFromCube).toBeGreaterThan(1.2);
    const distFromSphere = Math.hypot(
      sphere.position[0] - triangle.position[0],
      sphere.position[1] - triangle.position[1]
    );
    expect(distFromSphere).toBeGreaterThan(2.5);
  });
});
