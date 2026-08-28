import { describe, it, expect } from "vitest";
import {
  DROPZONE_LOOKS,
  DROPZONE_PRIMITIVES,
  DROPZONE_PYRAMID_HEIGHT,
  DROPZONE_PYRAMID_RADIUS,
  DROPZONE_PYRAMID_SIDES,
} from "../dropzone-looks";
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
  it("uses a stainless square, resin sphere, and nylon pyramid", () => {
    const kinds = DROPZONE_PRIMITIVES.map((p) => p.kind);
    expect(kinds).toEqual(["roundedBox", "sphere", "pyramid"]);
    expect(DROPZONE_PRIMITIVES.map((p) => p.look)).toEqual([
      "steel",
      "resin",
      "nylon",
    ]);
  });

  it("builds the pyramid as a 3-sided cone (4 faces)", () => {
    expect(DROPZONE_PYRAMID_SIDES).toBe(3);
    expect(DROPZONE_PYRAMID_HEIGHT).toBeGreaterThan(DROPZONE_PYRAMID_RADIUS);
    expect(DROPZONE_PYRAMID_RADIUS).toBeGreaterThan(0.4);
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
    const [square, sphere, pyramid] = DROPZONE_PRIMITIVES;
    for (const spec of DROPZONE_PRIMITIVES) {
      expect(spec.scale).toBeGreaterThanOrEqual(0.9);
      expect(spec.scale).toBeLessThanOrEqual(1.1);
    }
    expect(square.position[0]).toBeLessThan(-0.8);
    expect(sphere.position[0]).toBeGreaterThan(0.8);
    expect(pyramid.position[1]).toBeLessThan(-0.5);
    expect(pyramid.position[0]).toBeGreaterThan(0.1);
    expect(pyramid.position[0]).toBeLessThan(0.5);
    expect(pyramid.restRotation).toBeDefined();
    // Tip it enough that facets read in 3D (not a face-on sticker).
    expect(Math.abs(pyramid.restRotation![0])).toBeGreaterThan(0.15);
    expect(Math.abs(pyramid.restRotation![1])).toBeGreaterThan(0.3);
    expect(square.restRotation).toBeDefined();
    expect(square.fallbackClass).toMatch(/size-14/);
    expect(sphere.fallbackClass).toMatch(/size-14/);
  });
});
