import { describe, it, expect } from "vitest";
import { buildKnowledgeBlock } from "@/lib/cad/knowledge";
import { fastenersInPrompt } from "@/lib/cad/knowledge/fasteners";
import { needsErgonomics } from "@/lib/cad/knowledge/ergonomics";

describe("buildKnowledgeBlock", () => {
  it("always includes the aesthetic directives", () => {
    const block = buildKnowledgeBlock({ prompt: "a small box" });
    expect(block).toMatch(/Break EVERY exposed external edge/);
  });

  it("uses the conservative multi-process block when no process is given", () => {
    const block = buildKnowledgeBlock({ prompt: "a small box" });
    expect(block).toMatch(/process-agnostic \(conservative\)/);
    expect(block).toMatch(/Minimum wall thickness: 2 mm/);
  });

  it("uses the process-specific block when a process is given", () => {
    const block = buildKnowledgeBlock({ prompt: "a small box", process: "fdm" });
    expect(block).toMatch(/FDM\/FFF/);
    expect(block).toMatch(/Minimum wall thickness: 1 mm/);
    expect(block).not.toMatch(/process-agnostic/);
  });

  it("adds resin drain-hole guidance for SLA", () => {
    const block = buildKnowledgeBlock({ prompt: "a hollow vase", process: "sla" });
    expect(block).toMatch(/drain hole/);
  });

  it("includes fastener rows only when the prompt references a size", () => {
    const withM3 = buildKnowledgeBlock({ prompt: "a bracket for an M3 screw" });
    expect(withM3).toMatch(/M3: clearance hole 3\.4/);
    expect(withM3).toMatch(/heat-set insert bore 4/);

    const without = buildKnowledgeBlock({ prompt: "a decorative coaster" });
    expect(without).not.toMatch(/clearance hole/);
  });

  it("includes ergonomic defaults only for human-held parts", () => {
    const grip = buildKnowledgeBlock({ prompt: "an ergonomic handle for a tool" });
    expect(grip).toMatch(/Power-grip handle diameter/);

    const plain = buildKnowledgeBlock({ prompt: "a wall mounting plate" });
    expect(plain).not.toMatch(/Power-grip/);
  });
});

describe("fastenersInPrompt", () => {
  it("matches M-sizes case-insensitively and dedupes", () => {
    expect(fastenersInPrompt("two M3 bolts and one m3").map((f) => f.size)).toEqual([
      "M3",
    ]);
    expect(fastenersInPrompt("M2.5 standoff").map((f) => f.size)).toEqual(["M2.5"]);
    expect(fastenersInPrompt("no fasteners here")).toEqual([]);
  });
});

describe("needsErgonomics", () => {
  it("triggers on held/worn keywords, not on generic parts", () => {
    expect(needsErgonomics("a comfortable grip")).toBe(true);
    expect(needsErgonomics("a knob for a stove")).toBe(true);
    expect(needsErgonomics("a flat bracket")).toBe(false);
  });
});
