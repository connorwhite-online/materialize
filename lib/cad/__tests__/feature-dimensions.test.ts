import { describe, it, expect } from "vitest";
import {
  resolveDiameter,
  resolveDistance,
  matchDirection,
  captureBandMm,
} from "@/lib/cad/feature-dimensions";
import type { CadTopology, TopoFace } from "@/components/viewer/topology";

// --- topology builders -------------------------------------------------

function cylFace(
  id: number,
  radius: unknown,
  opts: { axis?: unknown; origin?: unknown } = {}
): TopoFace {
  return {
    id,
    surface: "cylinder",
    params: { radius, axis: opts.axis ?? [0, 0, 1], origin: opts.origin ?? [0, 0, 0] },
    triRange: [id, id + 1],
  };
}

function planeFace(id: number, normal: unknown, origin: unknown): TopoFace {
  return {
    id,
    surface: "plane",
    params: { normal, origin },
    triRange: [id, id + 1],
  };
}

function topo(faces: TopoFace[]): CadTopology {
  return { faces, edges: [] };
}

// --- resolveDiameter -----------------------------------------------------

describe("resolveDiameter", () => {
  it("matches a single cylinder face group nearest the spec", () => {
    const t = topo([cylFace(0, 3)]); // diameter 6
    const match = resolveDiameter(t, 6);
    expect(match).toMatchObject({ measured: 6, faceIds: [0] });
    expect(match?.note).toMatch(/1 cylindrical face/);
  });

  it("groups multiple faces at the same radius into one match", () => {
    const t = topo([cylFace(0, 1.6), cylFace(1, 1.6), cylFace(2, 1.6), cylFace(3, 1.6)]);
    const match = resolveDiameter(t, 3.2);
    expect(match).not.toBeNull();
    expect(match!.measured).toBeCloseTo(3.2);
    expect(match!.faceIds.slice().sort()).toEqual([0, 1, 2, 3]);
    expect(match!.note).toMatch(/4 cylindrical faces/);
  });

  it("returns null when no cylinder is within the capture band", () => {
    const t = topo([cylFace(0, 50)]); // diameter 100, spec 8, band 3
    expect(resolveDiameter(t, 8)).toBeNull();
  });

  it("returns null when the topology has no cylinder faces at all", () => {
    const t = topo([planeFace(0, [0, 0, 1], [0, 0, 0])]);
    expect(resolveDiameter(t, 8)).toBeNull();
  });

  it("ignores faces with missing or invalid radius params", () => {
    const t = topo([
      { id: 0, surface: "cylinder", params: null, triRange: [0, 1] },
      { id: 1, surface: "cylinder", params: {}, triRange: [1, 2] },
      { id: 2, surface: "cylinder", params: { radius: "4" }, triRange: [2, 3] },
      { id: 3, surface: "cylinder", params: { radius: 0 }, triRange: [3, 4] },
      { id: 4, surface: "cylinder", params: { radius: -4 }, triRange: [4, 5] },
      cylFace(5, 4), // the only valid one, diameter 8
    ]);
    const match = resolveDiameter(t, 8);
    expect(match).toMatchObject({ measured: 8, faceIds: [5] });
  });

  it("picks the closest of several diameter groups", () => {
    const t = topo([cylFace(0, 2.5), cylFace(1, 3), cylFace(2, 5)]); // diameters 5, 6, 10
    const match = resolveDiameter(t, 6.2);
    expect(match).toMatchObject({ measured: 6, faceIds: [1] });
  });

  it("returns a measured value outside tolerance but inside the capture band", () => {
    const t = topo([cylFace(0, 4.45)]); // diameter 8.9
    const match = resolveDiameter(t, 8);
    expect(match).not.toBeNull();
    expect(match!.measured).toBeCloseTo(8.9);
    expect(match!.faceIds).toEqual([0]);
  });
});

// --- resolveDistance -------------------------------------------------------

describe("resolveDistance", () => {
  it("measures two parallel plane faces, canonicalizing opposed normals", () => {
    const t = topo([
      planeFace(0, [0, 0, 1], [0, 0, 0]),
      planeFace(1, [0, 0, -1], [0, 0, 30]),
    ]);
    const match = resolveDistance(t, 30);
    expect(match).toMatchObject({ measured: 30 });
    expect(match!.faceIds.slice().sort()).toEqual([0, 1]);
    expect(match!.note).toMatch(/30\.00 mm apart/);
  });

  it("collapses coplanar duplicate faces instead of pairing them with each other", () => {
    const t = topo([
      planeFace(0, [0, 0, 1], [0, 0, 0]),
      planeFace(1, [0, 0, 1], [0, 0, 0.03]),
    ]);
    // If the near-duplicate faces didn't collapse into one plane entry, they'd
    // pair with each other and "measure" a phantom 0.03mm gap here.
    expect(resolveDistance(t, 0.03)).toBeNull();
  });

  it("returns null when no parallel pair lands near spec", () => {
    const t = topo([
      planeFace(0, [0, 0, 1], [0, 0, 0]),
      planeFace(1, [0, 0, 1], [0, 0, 5]),
    ]);
    expect(resolveDistance(t, 30)).toBeNull();
  });

  it("never pairs non-parallel planes, even when offsets differ by the spec value", () => {
    const t = topo([
      planeFace(0, [1, 0, 0], [0, 0, 0]),
      planeFace(1, [0, 0, 1], [0, 0, 30]),
    ]);
    expect(resolveDistance(t, 30)).toBeNull();
  });
});

// --- matchDirection ----------------------------------------------------

describe("matchDirection", () => {
  it("returns the normalized cylinder axis for a diameter match's faceIds", () => {
    const t = topo([cylFace(0, 3, { axis: [0, 0, 5] })]); // unnormalized axis
    const dir = matchDirection(t, [0]);
    expect(dir).not.toBeNull();
    expect(dir![0]).toBeCloseTo(0);
    expect(dir![1]).toBeCloseTo(0);
    expect(dir![2]).toBeCloseTo(1);
  });

  it("returns the plane normal for plane faces", () => {
    const t = topo([planeFace(0, [0, 2, 0], [0, 0, 0])]); // unnormalized
    const dir = matchDirection(t, [0]);
    expect(dir).toEqual([0, 1, 0]);
  });

  it("returns null for faces with no usable params", () => {
    const t = topo([{ id: 0, surface: "cylinder", params: null, triRange: [0, 1] }]);
    expect(matchDirection(t, [0])).toBeNull();
  });

  it("returns null when the faceIds don't resolve to any face in the topology", () => {
    const t = topo([cylFace(0, 3)]);
    expect(matchDirection(t, [99])).toBeNull();
  });
});

// --- captureBandMm -----------------------------------------------------

describe("captureBandMm", () => {
  it("floors at 3mm for small values", () => {
    expect(captureBandMm(1)).toBe(3);
    expect(captureBandMm(12)).toBe(3); // 25% of 12 is exactly the 3mm floor
  });

  it("is 25% of the value once that exceeds the 3mm floor", () => {
    expect(captureBandMm(20)).toBe(5);
    expect(captureBandMm(100)).toBe(25);
  });

  it("uses the absolute value for negative input", () => {
    expect(captureBandMm(-20)).toBe(5);
  });
});
