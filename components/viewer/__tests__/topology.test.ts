import { describe, it, expect } from "vitest";
import {
  parseTopology,
  faceForTriangle,
  describeFace,
  describeEdge,
  edgeLength,
  type CadTopology,
} from "@/components/viewer/topology";

const sample = {
  faces: [
    {
      id: 2,
      surface: "cylinder",
      params: { origin: [0, 0, 0], axis: [0, 0, 1], radius: 2.7 },
      triRange: [10, 30],
    },
    {
      id: 0,
      surface: "plane",
      params: { origin: [0, 0, 0], normal: [0, 0, 1] },
      triRange: [0, 10],
    },
  ],
  edges: [
    {
      id: 0,
      curve: "circle",
      polyline: [
        [0, 0, 0],
        [3, 0, 0],
        [3, 4, 0],
      ],
      faceIds: [0, 2],
    },
  ],
};

describe("parseTopology", () => {
  it("parses + sorts faces by triRange start", () => {
    const topo = parseTopology(sample)!;
    expect(topo).not.toBeNull();
    expect(topo.faces.map((f) => f.id)).toEqual([0, 2]); // plane [0,10) first
    expect(topo.edges).toHaveLength(1);
  });

  it("returns null for non-objects and missing faces", () => {
    expect(parseTopology(null)).toBeNull();
    expect(parseTopology("nope")).toBeNull();
    expect(parseTopology({ edges: [] })).toBeNull();
  });

  it("drops malformed faces and returns null when none survive", () => {
    expect(
      parseTopology({ faces: [{ id: "x", surface: "plane" }] })
    ).toBeNull();
  });

  it("drops edges with <2 polyline points but keeps valid faces", () => {
    const topo = parseTopology({
      faces: sample.faces,
      edges: [{ id: 0, curve: "line", polyline: [[0, 0, 0]] }],
    })!;
    expect(topo.edges).toHaveLength(0);
    expect(topo.faces).toHaveLength(2);
  });
});

describe("faceForTriangle", () => {
  const topo = parseTopology(sample)! as CadTopology;
  it("binary-searches the containing face", () => {
    expect(faceForTriangle(topo.faces, 0)?.id).toBe(0);
    expect(faceForTriangle(topo.faces, 9)?.id).toBe(0);
    expect(faceForTriangle(topo.faces, 10)?.id).toBe(2);
    expect(faceForTriangle(topo.faces, 29)?.id).toBe(2);
  });
  it("returns null outside every range (end is exclusive)", () => {
    expect(faceForTriangle(topo.faces, 30)).toBeNull();
    expect(faceForTriangle(topo.faces, -1)).toBeNull();
  });
});

describe("describeFace / describeEdge", () => {
  const topo = parseTopology(sample)! as CadTopology;
  it("names a cylinder with radius + dominant axis", () => {
    const cyl = topo.faces.find((f) => f.surface === "cylinder")!;
    expect(describeFace(cyl)).toBe("cylinder, r=2.7, axis Z");
  });
  it("names a plane with its normal axis", () => {
    const plane = topo.faces.find((f) => f.surface === "plane")!;
    expect(describeFace(plane)).toBe("planar face, normal Z");
  });
  it("computes polyline length and edge description", () => {
    expect(edgeLength(topo.edges[0])).toBeCloseTo(7, 5); // 3 + 4
    expect(describeEdge(topo.edges[0])).toBe("circular edge, length 7 mm");
  });
});
