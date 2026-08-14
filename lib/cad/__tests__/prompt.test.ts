import { describe, expect, it } from "vitest";

import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CADQUERY,
  buildSystemPrompt,
  selectSystemPromptSections,
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

  it("bans edge-by-edge fillet loops that time generations out", () => {
    expect(SYSTEM_PROMPT).toMatch(/CRITICAL PERFORMANCE/i);
    expect(SYSTEM_PROMPT).toMatch(/one-at-a-time/i);
  });

  it("cadquery variant keeps a single-solid contract (no parts dict path)", () => {
    // Assemblies route through build123d; the cadquery A/B front-end stays
    // single-solid. If that ever changes, this test should be updated
    // deliberately, not by accident.
    expect(SYSTEM_PROMPT_CADQUERY).toContain("result");
  });
});

describe("system prompt gating (MTR-222)", () => {
  it("assembles core-only sections for a plain mechanical prompt", () => {
    const sections = selectSystemPromptSections("a bracket with two M5 bolt holes");
    expect(sections).toEqual({ mesh: false, sdf: false, exchanger: false, scan: false });
    const prompt = buildSystemPrompt(sections);
    expect(prompt).toContain("build123d");
    expect(prompt).toContain("SYMBOLIC SELECTORS");
    expect(prompt).not.toContain("MESH MODE");
    expect(prompt).not.toContain("ORGANIC-FUNCTIONAL");
    expect(prompt).not.toContain("DUAL-FLUID EXCHANGERS");
  });

  it("includes the mesh + SDF/TPMS sections and the exchanger bullets for a two-fluid prompt", () => {
    const prompt = "a dual-fluid gyroid heat exchanger, hot across cold";
    const sections = selectSystemPromptSections(prompt);
    expect(sections).toEqual({ mesh: true, sdf: true, exchanger: true, scan: false });
    const assembled = buildSystemPrompt(sections);
    expect(assembled).toContain("MESH MODE");
    expect(assembled).toContain("ORGANIC-FUNCTIONAL");
    expect(assembled).toContain("DUAL-FLUID EXCHANGERS");
  });

  it("includes the mesh + TPMS sections (but not the exchanger bullets) for an organic-shaped prompt", () => {
    const prompt = "a flowing, organic gyroid lattice lamp shade";
    const sections = selectSystemPromptSections(prompt);
    expect(sections.mesh).toBe(true);
    expect(sections.sdf).toBe(true);
    expect(sections.exchanger).toBe(false);
    const assembled = buildSystemPrompt(sections);
    expect(assembled).toContain("MESH MODE");
    expect(assembled).toContain("ORGANIC-FUNCTIONAL");
    expect(assembled).not.toContain("DUAL-FLUID EXCHANGERS");
  });

  it("adds the scan contract only when the turn carries geometry", () => {
    // A payload signal, not a prompt one: the words give nothing away.
    const prompt = "make a case for this";
    expect(selectSystemPromptSections(prompt).scan).toBe(false);
    expect(buildSystemPrompt(selectSystemPromptSections(prompt))).not.toContain(
      "SCANNED OBJECT"
    );

    const withScan = selectSystemPromptSections(prompt, { scan: true });
    expect(withScan.scan).toBe(true);
    // A scan is organic by construction — the proxy is a mesh, so the mesh and
    // SDF vocabulary has to come with it or the model cannot use the binding.
    expect(withScan.mesh).toBe(true);
    expect(withScan.sdf).toBe(true);

    const assembledWithScan = buildSystemPrompt(withScan);
    expect(assembledWithScan).toContain("SCANNED OBJECT");
    expect(assembledWithScan).toContain("MESH MODE");
    // The two rails that keep an over-confident model from designing to a
    // precision the capture never had, and from trapping the object.
    expect(assembledWithScan).toContain("MUST COME BACK OUT");
    expect(assembledWithScan).toMatch(/do NOT design press fits/i);
  });

  it("keeps the full SYSTEM_PROMPT export containing every section for compatibility", () => {
    expect(SYSTEM_PROMPT).toContain("build123d");
    expect(SYSTEM_PROMPT).toContain("MESH MODE");
    expect(SYSTEM_PROMPT).toContain("ORGANIC-FUNCTIONAL");
    expect(SYSTEM_PROMPT).toContain("DUAL-FLUID EXCHANGERS");
    expect(SYSTEM_PROMPT).toEqual(
      buildSystemPrompt({ mesh: true, sdf: true, exchanger: true, scan: false })
    );
    // The scan contract claims an object is already bound in the namespace,
    // so it must stay OUT of the always-on prompt.
    expect(SYSTEM_PROMPT).not.toContain("SCANNED OBJECT");
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
