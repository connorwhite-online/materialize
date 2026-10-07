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

  it("nylon matches the PA11 catalog row", () => {
    const nylon = getMaterialById("nylon-pa11")!;
    expect(DROPZONE_LOOKS.nylon.catalogId).toBe("nylon-pa11");
    expect(DROPZONE_LOOKS.nylon.color).toBe(nylon.color);
    expect(DROPZONE_LOOKS.nylon.metalness).toBe(nylon.pbr.metalness);
    expect(DROPZONE_LOOKS.nylon.roughness).toBe(nylon.pbr.roughness);
  });
});

describe("DROPZONE_PRIMITIVES", () => {
  it("uses a stainless square, resin sphere, and nylon pyramid", () => {
    const kinds = DROPZONE_PRIMITIVES.map((p) => p.kind);
    expect(kinds).toEqual(["roundedBox", "sphere", "pyramid"]);
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

  it("clusters modest-scale shapes above the copy", () => {
    const [square, sphere, pyramid] = DROPZONE_PRIMITIVES;
    for (const spec of DROPZONE_PRIMITIVES) {
      expect(spec.scale).toBeGreaterThanOrEqual(0.6);
      expect(spec.scale).toBeLessThanOrEqual(1.05);
      // Upper part of the well — the copy is anchored to the bottom.
      expect(spec.position[1]).toBeGreaterThan(0.3);
      // Near the centre line so the set reads as one cluster.
      expect(Math.abs(spec.position[0])).toBeLessThan(0.3);
    }
    expect(square.position[0]).toBeLessThan(0);
    expect(sphere.position[0]).toBeGreaterThan(0);
    // Pyramid sits in front of and below the other two.
    expect(pyramid.position[2]).toBeGreaterThan(square.position[2]);
    expect(pyramid.position[2]).toBeGreaterThan(sphere.position[2]);
    expect(pyramid.position[1]).toBeLessThan(square.position[1]);
    expect(pyramid.restRotation).toBeDefined();
    // Tip it enough that the chubby ridges read in 3D.
    expect(Math.abs(pyramid.restRotation![0])).toBeGreaterThan(0.15);
    expect(Math.abs(pyramid.restRotation![1])).toBeGreaterThan(0.3);
    expect(square.restRotation).toBeDefined();
    expect(square.fallbackClass).toMatch(/size-10/);
    expect(sphere.fallbackClass).toMatch(/size-10/);
  });
});
