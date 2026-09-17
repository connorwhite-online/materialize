import { describe, it, expect } from "vitest";
import {
  CAD_EXEMPLARS,
  selectExemplars,
  selectExemplarsByIds,
  formatExemplars,
  formatExemplarCatalog,
  exemplarEngine,
  exemplarPoolFor,
  type CadExemplar,
} from "@/lib/cad/knowledge/exemplars";

// Test pool with verified entries so we can exercise selection independent of
// the real exemplars' (currently unverified) state.
const pool: CadExemplar[] = [
  { id: "box", title: "Box", keywords: ["enclosure", "box"], lesson: "L1", code: "result = 1", verified: true },
  { id: "knob", title: "Knob", keywords: ["knob", "grip"], lesson: "L2", code: "result = 2", verified: true },
  { id: "wip", title: "WIP", keywords: ["box", "enclosure"], lesson: "L3", code: "result = 3", verified: false },
];

describe("selectExemplars", () => {
  it("never returns unverified exemplars", () => {
    // "box" matches both the verified box and the unverified WIP; only the
    // verified one may come back.
    const picked = selectExemplars("a small box enclosure", { pool, limit: 5 });
    expect(picked.every((e) => e.verified)).toBe(true);
    expect(picked.map((e) => e.id)).toContain("box");
    expect(picked.map((e) => e.id)).not.toContain("wip");
  });

  it("ranks by keyword overlap and respects the limit", () => {
    const picked = selectExemplars("a knob grip", { pool, limit: 1 });
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe("knob");
  });

  it("returns nothing when no keywords match", () => {
    expect(selectExemplars("a turbine blade", { pool })).toEqual([]);
  });

  it("surfaces a matching verified exemplar from the real set", () => {
    // The real exemplars are now sidecar-verified (scripts/verify-exemplars.ts),
    // so a matching prompt reaches the model as a style reference.
    const picked = selectExemplars("an enclosure box");
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((e) => e.verified)).toBe(true);
  });
});

describe("selectExemplarsByIds", () => {
  it("returns ONLY the requested ids (regression: entries once leaked into the initializer)", () => {
    expect(selectExemplarsByIds([])).toEqual([]);
    const one = selectExemplarsByIds(["rounded_enclosure"]);
    expect(one.map((e) => e.id)).toEqual(["rounded_enclosure"]);
    // hallucinated ids resolve to nothing, and the cap is 2
    expect(selectExemplarsByIds(["not_a_real_id"])).toEqual([]);
    const capped = selectExemplarsByIds([
      "rounded_enclosure",
      "snap_fit_lid",
      "ergonomic_knob",
    ]);
    expect(capped).toHaveLength(2);
  });
});

describe("assembly exemplar retrieval (MTR-189)", () => {
  it.each([
    ["a hinged box for small parts", "hinged_case_pin_bores"],
    ["a snap-fit case for my sensor", "snap_lid_sensor_node"],
    ["a strain relief for a power cord", "strain_relief_clamshell"],
    ["a wall mount holder for the tv remote", "wall_mount_keyhole_bin"],
    ["a box with an ssd1306 oled display window", "oled_window_front_plate_box"],
  ])("%s -> retrieves %s", (prompt, id) => {
    const picked = selectExemplars(prompt, { limit: 2 });
    expect(picked.map((e) => e.id)).toContain(id);
  });

  it("lists the new entries in the plan-step catalog", () => {
    const catalog = formatExemplarCatalog();
    for (const id of [
      "snap_lid_sensor_node",
      "hinged_case_pin_bores",
      "strain_relief_clamshell",
      "oled_window_front_plate_box",
      "wall_mount_keyhole_bin",
      "draped_two_piece_enclosure",
      "pico_dev_board_enclosure",
    ]) {
      expect(catalog).toContain(id);
    }
  });
});

describe("formatExemplars", () => {
  it("is empty for no matches and wraps code in a python block otherwise", () => {
    expect(formatExemplars([])).toBe("");
    const out = formatExemplars([pool[0]]);
    expect(out).toMatch(/```python/);
    expect(out).toMatch(/do not copy verbatim/);
  });
});

describe("CAD_EXEMPLARS authoring invariants", () => {
  it("every exemplar assigns `result`, imports build123d, and is sidecar-verified", () => {
    expect(CAD_EXEMPLARS.length).toBeGreaterThanOrEqual(6);
    for (const e of CAD_EXEMPLARS) {
      // Single solid (`result =`) or a multi-part assembly (`parts =`).
      expect(e.code).toMatch(/(?:result|parts)\s*=/);
      // B-rep exemplars import build123d; mesh-mode uses trimesh; organic-
      // functional uses the SDF toolkit.
      expect(e.code).toMatch(/from build123d import \*|import trimesh|from sdf_kit import/);
      // Gate: an exemplar is only shipped once scripts/verify-exemplars.ts
      // confirms it compiles to a valid watertight solid. Keep new exemplars
      // out of this array (verified:false) until they pass.
      expect(e.verified).toBe(true);
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("engine-aware exemplar pools", () => {
  it("classifies mesh-mode exemplars as implicit even without sdf_kit", () => {
    // gyroid_tpms_core is raw numpy + skimage.measure.marching_cubes and
    // assigns a trimesh to `result`. A narrower check filed it as build123d,
    // which is how "a pair of meshing spur gears" — a core-only build123d
    // prompt — came to be offered a marching-cubes exemplar.
    const gyroid = CAD_EXEMPLARS.find((e) => e.id === "gyroid_tpms_core")!;
    expect(gyroid.code).not.toMatch(/from sdf_kit/);
    expect(exemplarEngine(gyroid)).toBe("sdf");
  });

  it("gives the sdf engine only implicit exemplars", () => {
    const pool = exemplarPoolFor("sdf");
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((e) => exemplarEngine(e) === "sdf")).toBe(true);
  });

  it("keeps implicit exemplars out of a build123d-only prompt", () => {
    // The prompt's section gate and the exemplar keyword scoring are
    // independent, so they can disagree. An exemplar must never teach a
    // dialect the assembled system prompt did not describe.
    const pool = exemplarPoolFor("brep", { prompt: "a pair of meshing spur gears" });
    expect(pool.every((e) => exemplarEngine(e) === "brep")).toBe(true);
  });

  it("allows them when the b-rep prompt did describe the implicit vocabulary", () => {
    const pool = exemplarPoolFor("brep", {
      prompt: "an organic bracket with a gyroid lattice infill",
    });
    expect(pool.some((e) => exemplarEngine(e) === "sdf")).toBe(true);
  });

  it("leaves the pool untouched when no prompt is supplied", () => {
    expect(exemplarPoolFor("brep")).toEqual(CAD_EXEMPLARS);
  });
});
