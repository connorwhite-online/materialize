import { describe, it, expect } from "vitest";
import {
  CAD_EXEMPLARS,
  selectExemplars,
  formatExemplars,
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

  it("returns nothing from the real (currently unverified) exemplar set", () => {
    // Guard: until exemplars are sidecar-verified, none reach a prompt.
    expect(selectExemplars("an enclosure box")).toEqual([]);
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
  it("every exemplar assigns `result` and ships unverified until sidecar-checked", () => {
    expect(CAD_EXEMPLARS.length).toBeGreaterThanOrEqual(6);
    for (const e of CAD_EXEMPLARS) {
      expect(e.code).toMatch(/result\s*=/);
      expect(e.code).toMatch(/from build123d import \*/);
      expect(e.verified).toBe(false);
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});
