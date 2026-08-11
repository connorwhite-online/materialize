import { describe, it, expect } from "vitest";

import { parseSExpr, readKicadBoard, kicadFactLines } from "@/lib/cad/kicad";

const BOARD = `
(kicad_pcb (version 20221018)
  (gr_line (start 100 50) (end 158.4 50) (stroke (width 0.1)) (layer "Edge.Cuts"))
  (gr_line (start 158.4 50) (end 158.4 142.1) (stroke (width 0.1)) (layer "Edge.Cuts"))
  (gr_line (start 158.4 142.1) (end 100 142.1) (stroke (width 0.1)) (layer "Edge.Cuts"))
  (gr_line (start 100 142.1) (end 100 50) (stroke (width 0.1)) (layer "Edge.Cuts"))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (at 103.5 53.5)
    (fp_text reference "H1" (at 0 0) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 5.4 5.4) (drill 3.2) (layers "*.Cu" "*.Mask"))
  )
  (footprint "MountingHole:MountingHole_3.2mm_M3" (at 154.9 138.6)
    (fp_text reference "H2" (at 0 0) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 5.4 5.4) (drill 3.2) (layers "*.Cu" "*.Mask"))
  )
  (footprint "Connector_USB:USB_C_Receptacle" (at 129.2 51.5 180)
    (fp_text reference "J1" (at 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
  )
  (footprint "Package_QFP:LQFP-64" (at 130 96)
    (fp_text reference "U1" (at 0 0) (layer "F.SilkS"))
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1.0) (layers "*.Cu"))
  )
)
`;

describe("parseSExpr", () => {
  it("parses atoms, strings (with escapes), and nesting", () => {
    const [expr] = parseSExpr('(a "b \\"c\\"" (d 1.5))');
    expect(expr).toEqual(["a", 'b "c"', ["d", "1.5"]]);
  });

  it("throws on unbalanced input", () => {
    expect(() => parseSExpr("(a (b)")).toThrow();
    expect(() => parseSExpr("a) (")).toThrow();
  });
});

describe("readKicadBoard", () => {
  it("measures outline, hole POSITIONS from the top-left corner, and connectors", () => {
    const board = readKicadBoard(BOARD);
    expect(board?.outline?.widthMm).toBeCloseTo(58.4, 1);
    expect(board?.outline?.heightMm).toBeCloseTo(92.1, 1);
    // Holes at absolute (103.5, 53.5) / (154.9, 138.6); outline min = (100, 50).
    expect(board?.mountingHoles).toEqual([
      { xMm: 3.5, yMm: 3.5, drillMm: 3.2 },
      { xMm: 54.9, yMm: 88.6, drillMm: 3.2 },
    ]);
    // USB-C connector recognized by name + J reference; QFP (U1) is not.
    expect(board?.connectors).toHaveLength(1);
    expect(board?.connectors[0]).toMatchObject({
      reference: "J1",
      xMm: 29.2,
      yMm: 1.5,
    });
  });

  it("applies footprint rotation to pad offsets", () => {
    const rotated = `
      (kicad_pcb
        (gr_rect (start 0 0) (end 100 100) (layer "Edge.Cuts"))
        (footprint "MountingHole:X" (at 50 50 90)
          (pad "" np_thru_hole circle (at 10 0) (size 5 5) (drill 3) (layers "*.Cu"))
        )
      )
    `;
    const board = readKicadBoard(rotated);
    // 90° CCW in y-down space: pad offset (10, 0) → (0, -10) from center.
    expect(board?.mountingHoles[0].xMm).toBeCloseTo(50, 1);
    expect(board?.mountingHoles[0].yMm).toBeCloseTo(40, 1);
  });

  it("returns null for garbage", () => {
    expect(readKicadBoard("not a board")).toBeNull();
    expect(readKicadBoard("(kicad_pcb)")).toBeNull();
  });
});

describe("kicadFactLines", () => {
  it("renders measured facts with the coordinate convention stated", () => {
    const lines = kicadFactLines(BOARD);
    expect(lines[0]).toContain("58.4 x 92.1 mm");
    expect(lines[1]).toContain("(3.5, 3.5) drill 3.2 mm");
    expect(lines[1]).toContain("top-left corner");
    expect(lines[2]).toContain("J1");
  });

  it("returns [] when nothing parses", () => {
    expect(kicadFactLines("garbage")).toEqual([]);
  });
});
