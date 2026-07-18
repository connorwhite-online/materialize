import { describe, expect, it } from "vitest";

import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CADQUERY,
  extractCode,
  gradeRun,
} from "../prompt";
import type { CadRunResult } from "../types";

/**
 * Regression guards for the shared generate prompt. The `parts` dict contract
 * (MTR-44) is easy to silently drop in a prompt reword, and dropping it sends
 * the model back to emitting one `result` compound of N bodies — which the
 * fragment gate then fails. These assertions keep the contract present and
 * unambiguous without needing a live model.
 */
describe("SYSTEM_PROMPT parts-dict contract (MTR-44)", () => {
  it("documents the parts dict as the multi-part output shape", () => {
    expect(SYSTEM_PROMPT).toContain("parts");
    // The concrete shape the persist/sidecar path keys on.
    expect(SYSTEM_PROMPT).toMatch(/parts\s*=\s*\{/);
    expect(SYSTEM_PROMPT).toContain('"lid"');
    expect(SYSTEM_PROMPT).toContain('"base"');
  });

  it("steers separate printed parts to the dict, not a single result", () => {
    expect(SYSTEM_PROMPT).toMatch(/INSTEAD of `?result/i);
    expect(SYSTEM_PROMPT).toMatch(/never assign both/i);
  });

  it("warns against disjoint bodies in a single result", () => {
    // The known failure mode this steering exists to prevent.
    expect(SYSTEM_PROMPT).toMatch(/disjoint bodies/i);
    expect(SYSTEM_PROMPT).toMatch(/parts` wins|`parts` wins/i);
  });

  it("cadquery variant keeps a single-solid contract (no parts dict path)", () => {
    // Assemblies route through build123d; the cadquery A/B front-end stays
    // single-solid. If that ever changes, this test should be updated
    // deliberately, not by accident.
    expect(SYSTEM_PROMPT_CADQUERY).toContain("result");
  });
});

describe("extractCode", () => {
  it("pulls a fenced python block", () => {
    expect(extractCode("prose\n```python\nresult = 1\n```\nmore")).toBe(
      "result = 1"
    );
  });
  it("returns trimmed text when unfenced", () => {
    expect(extractCode("  result = 1  ")).toBe("result = 1");
  });
});

describe("gradeRun", () => {
  const okRun: CadRunResult = {
    ok: true,
    files: {},
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
    geometry: { dimensions: { x: 20, y: 20, z: 20 } },
  };

  it("passes a valid run with on-target dims", () => {
    expect(gradeRun(okRun, { x: 20, y: 20, z: 20 }).pass).toBe(true);
  });

  it("fails when a dimension is off target", () => {
    const g = gradeRun(okRun, { x: 40 });
    expect(g.pass).toBe(false);
    expect(g.failures).toContain("dimensions off target");
  });
});
