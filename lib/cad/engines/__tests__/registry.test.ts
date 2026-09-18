import { describe, expect, it } from "vitest";

import {
  allEngines,
  CAD_ENGINE_LABELS,
  DEFAULT_CAD_ENGINE,
  engineFor,
  isCadEngineId,
} from "../index";
import { buildSystemPrompt, selectSystemPromptSections } from "../../prompt";

describe("engine registry", () => {
  it("defaults to brep and is byte-identical to the pre-registry prompt", () => {
    // The whole safety argument for this refactor: routing that does not ask
    // for an engine must behave EXACTLY as it did before.
    expect(DEFAULT_CAD_ENGINE).toBe("brep");
    for (const prompt of [
      "a 20mm cube",
      "an organic bracket with a gyroid infill",
      "a two-fluid counterflow heat exchanger, 60mm",
    ]) {
      expect(engineFor().systemPrompt(prompt)).toBe(
        buildSystemPrompt(selectSystemPromptSections(prompt))
      );
    }
  });

  it("falls back to the default for an unknown id", () => {
    expect(engineFor(undefined).id).toBe("brep");
    expect(engineFor(null).id).toBe("brep");
    // A stale client sending a retired engine id must not crash a generation.
    expect(engineFor("nope" as never).id).toBe("brep");
  });

  it("validates engine ids", () => {
    expect(isCadEngineId("sdf")).toBe(true);
    expect(isCadEngineId("brep")).toBe(true);
    expect(isCadEngineId("cadquery")).toBe(false);
    expect(isCadEngineId(null)).toBe(false);
  });

  it("keeps the sdf engine off the CAD kernel entirely", () => {
    const sdf = engineFor("sdf");
    // Mesh mode skips the OCCT warm import, which is what makes an SDF run
    // incapable of producing an OpenCASCADE failure — the property the
    // engine comparison depends on.
    expect(sdf.sidecarEngine).toBe("mesh");
    expect(sdf.producesBrep).toBe(false);
    // No B-rep means no STEP and no topology to export.
    expect(sdf.outputFormats).toEqual(["stl"]);
  });

  it("gives the sdf engine its own prompt, not the build123d one", () => {
    const prompt = "a phone stand";
    const sdf = engineFor("sdf").systemPrompt(prompt);
    const brep = engineFor("brep").systemPrompt(prompt);
    expect(sdf).not.toBe(brep);
    expect(sdf).toMatch(/from sdf_kit import/);
    expect(sdf).toMatch(/mesh_subtract/);
    // It must never carry the build123d CONTRACT — that framing is what kept
    // the implicit path unreachable, since the B-rep prompt opens by casting
    // the model as a build123d engineer and treats implicit as an exception.
    expect(sdf).not.toMatch(/from build123d import/);
    expect(sdf).not.toMatch(/Use the build123d library/i);
    expect(brep).toMatch(/build123d Python code/);
    expect(sdf).not.toMatch(/build123d Python code/);
    // It names the kernel exactly once, to say there isn't one — without
    // that, the model reaches for `import build123d` and fails confusingly.
    expect(sdf).toMatch(/You do not write build123d/);
  });

  it("assembles prompts deterministically (prompt caching depends on it)", () => {
    for (const engine of allEngines()) {
      const a = engine.systemPrompt("a bracket with two M5 holes");
      const b = engine.systemPrompt("a bracket with two M5 holes");
      expect(a).toBe(b);
    }
  });

  it("gates the sdf exchanger vocabulary on exchanger-shaped prompts", () => {
    const sdf = engineFor("sdf");
    expect(sdf.systemPrompt("a wall bracket")).not.toMatch(/DUAL-FLUID/);
    expect(sdf.systemPrompt("an air-to-water intercooler core")).toMatch(
      /DUAL-FLUID/
    );
  });

  it("has ONE definition of each engine's label", () => {
    // The drift PR #279 names: two hand-copied strings that agree until one
    // side is edited. The client panel cannot import the registry (that would
    // bundle ~33KB of system prompts into the browser), so the labels live in
    // engines/types — prompt-free — and both sides read them.
    for (const engine of allEngines()) {
      expect(engine.label).toBe(CAD_ENGINE_LABELS[engine.id]);
    }
  });

  it("gives every engine a distinct stored engine name", () => {
    const stored = allEngines().map((e) => e.storedEngine);
    expect(new Set(stored).size).toBe(stored.length);
  });
});
