import { describe, it, expect } from "vitest";
import { DROPZONE_LOOKS, DROPZONE_PRIMITIVES } from "../dropzone-looks";
import { HERO_MATERIALS, getMaterialById } from "@/lib/materials";

function heroLook(catalogId: string) {
  return HERO_MATERIALS.find((m) => m.id === catalogId);
}

describe("DROPZONE_LOOKS", () => {
  it("steel matches the stainless 316L catalog row", () => {
    const steel = getMaterialById("steel-316l")!;
    expect(DROPZONE_LOOKS.steel.catalogId).toBe("steel-316l");
    expect(DROPZONE_LOOKS.steel.color).toBe(steel.color);
    expect(DROPZONE_LOOKS.steel.metalness).toBe(steel.pbr.metalness);
    expect(DROPZONE_LOOKS.steel.roughness).toBe(steel.pbr.roughness);
  });

  it("resin follows the hero translucency override, not the stock row", () => {
    const resin = heroLook("resin-standard")!;
    expect(DROPZONE_LOOKS.resin.catalogId).toBe("resin-standard");
    expect(DROPZONE_LOOKS.resin.color).toBe(resin.color);
    expect(DROPZONE_LOOKS.resin.transmission).toBe(resin.pbr.transmission);
    expect(DROPZONE_LOOKS.resin.clearcoat).toBe(resin.pbr.clearcoat);
    expect(DROPZONE_LOOKS.resin.roughness).toBe(resin.pbr.roughness);
  });

  it("nylon matches the PA12 Black catalog row", () => {
    const nylon = getMaterialById("nylon-pa12-black")!;
    expect(DROPZONE_LOOKS.nylon.catalogId).toBe("nylon-pa12-black");
    expect(DROPZONE_LOOKS.nylon.color).toBe(nylon.color);
    expect(DROPZONE_LOOKS.nylon.metalness).toBe(nylon.pbr.metalness);
    expect(DROPZONE_LOOKS.nylon.roughness).toBe(nylon.pbr.roughness);
  });
});

describe("DROPZONE_PRIMITIVES", () => {
  it("uses a stainless square, resin sphere, and nylon triangle", () => {
    const kinds = DROPZONE_PRIMITIVES.map((p) => p.kind);
    expect(kinds).toEqual(["roundedBox", "sphere", "roundedTriangle"]);
    expect(DROPZONE_PRIMITIVES.map((p) => p.look)).toEqual([
      "steel",
      "resin",
      "nylon",
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

  it("parks modest-scale chubby shapes on the frame", () => {
    const [square, sphere, triangle] = DROPZONE_PRIMITIVES;
    for (const spec of DROPZONE_PRIMITIVES) {
      expect(spec.scale).toBeGreaterThanOrEqual(0.9);
      expect(spec.scale).toBeLessThanOrEqual(1.1);
    }
    expect(square.position[0]).toBeLessThan(-0.8);
    expect(sphere.position[0]).toBeGreaterThan(0.8);
    expect(triangle.position[1]).toBeLessThan(-0.5);
    expect(triangle.position[0]).toBeGreaterThan(0.1);
    expect(triangle.position[0]).toBeLessThan(0.5);
    expect(triangle.restRotation).toBeDefined();
    // Keep the triangular face camera-facing — large Y tumble would
    // flash the thin edge and read as an extrusion again.
    expect(Math.abs(triangle.rotSpeed[1])).toBeLessThanOrEqual(0.025);
    expect(Math.abs(triangle.restRotation![0])).toBeLessThan(0.35);
    expect(Math.abs(triangle.restRotation![1])).toBeLessThan(0.35);
    expect(square.restRotation).toBeDefined();
    expect(square.fallbackClass).toMatch(/size-14/);
    expect(sphere.fallbackClass).toMatch(/size-14/);
  });
});
