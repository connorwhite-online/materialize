import { describe, it, expect } from "vitest";
import { buildKnowledgeBlock } from "@/lib/cad/knowledge";
import { fastenersInPrompt } from "@/lib/cad/knowledge/fasteners";
import {
  needsStandardParts,
  usesInternalThreadRecipe,
} from "@/lib/cad/knowledge/bd-warehouse";
import { needsErgonomics } from "@/lib/cad/knowledge/ergonomics";
import { needsEnclosureRecipe } from "@/lib/cad/knowledge/enclosure-recipe";

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

  it("includes bd_warehouse rules when the prompt references standard parts (MTR-200)", () => {
    // Via a metric size…
    const withM3 = buildKnowledgeBlock({ prompt: "a bracket for an M3 screw" });
    expect(withM3).toMatch(/NEVER hand-model a standard fastener/);
    expect(withM3).toMatch(/SocketHeadCapScrew\(size="M3-0\.5"/);

    // …or via a part word with no size at all.
    const bearing = buildKnowledgeBlock({ prompt: "a mount with a bearing pocket" });
    expect(bearing).toMatch(/bd_warehouse/);

    const without = buildKnowledgeBlock({ prompt: "a decorative coaster" });
    expect(without).not.toMatch(/bd_warehouse/);
  });

  it("includes ergonomic defaults only for human-held parts", () => {
    const grip = buildKnowledgeBlock({ prompt: "an ergonomic handle for a tool" });
    expect(grip).toMatch(/Power-grip handle diameter/);

    const plain = buildKnowledgeBlock({ prompt: "a wall mounting plate" });
    expect(plain).not.toMatch(/Power-grip/);
  });
});

describe("needsEnclosureRecipe / enclosure recipe block", () => {
  it("injects the drape-and-split recipe for enclosure-shaped prompts", () => {
    const block = buildKnowledgeBlock({
      prompt: "an enclosure for a 60x40 PCB and a battery",
    });
    expect(block).toMatch(/DEFAULT ENCLOSURE RECIPE/);
    expect(block).toMatch(/split_shell/);
    expect(block).toMatch(/heat-set boss = 4\.0 mm bore/);
  });

  it("triggers on case/box + component hints, but not on a bare box", () => {
    expect(needsEnclosureRecipe("a case for a raspberry pi pico")).toBe(true);
    expect(needsEnclosureRecipe("a box for an ESP32 sensor module")).toBe(true);
    expect(needsEnclosureRecipe("a housing for electronics")).toBe(true);
    expect(needsEnclosureRecipe("a rectangular box 60x40x30mm")).toBe(false);
    expect(needsEnclosureRecipe("a spiral staircase")).toBe(false);
    expect(needsEnclosureRecipe("a bookcase shelf")).toBe(false);
  });

  it("stays out of non-enclosure prompts", () => {
    const block = buildKnowledgeBlock({ prompt: "a decorative coaster" });
    expect(block).not.toMatch(/DEFAULT ENCLOSURE RECIPE/);
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

describe("needsStandardParts", () => {
  it("triggers on part words, not bare 'insert' or unrelated prompts", () => {
    expect(needsStandardParts("enclosure with heat-set bosses")).toBe(true);
    expect(needsStandardParts("a 608zz bearing mount")).toBe(true);
    expect(needsStandardParts("bolt-on bracket")).toBe(true); // bolt-on implies bolts
    expect(needsStandardParts("insert a hole in the lid")).toBe(false);
    expect(needsStandardParts("a decorative coaster")).toBe(false);
  });

  it("triggers on functional-thread prompts (the df06cce4 failure class)", () => {
    expect(
      needsStandardParts("a rounded cube with big chunky threads through it")
    ).toBe(true);
    expect(needsStandardParts("threaded hole through the center")).toBe(true);
    expect(needsStandardParts("a spool of thread for sewing")).toBe(true); // acceptable over-trigger
  });
});

describe("usesInternalThreadRecipe", () => {
  it("detects internal bd_warehouse threads and nothing else", () => {
    expect(
      usesInternalThreadRecipe(
        "from bd_warehouse.thread import IsoThread\nt = IsoThread(major_diameter=20, pitch=2.5, length=40, external=False)"
      )
    ).toBe(true);
    // External threads fuse clean — no remesh needed.
    expect(
      usesInternalThreadRecipe(
        "from bd_warehouse.thread import TrapezoidalThread\nt = TrapezoidalThread(diameter=24, pitch=4, thread_angle=30, length=30, external=True)"
      )
    ).toBe(false);
    // Fasteners import from bd_warehouse.fastener, not .thread.
    expect(
      usesInternalThreadRecipe(
        "from bd_warehouse.fastener import HexNut\nn = HexNut(size='M3-0.5', fastener_type='iso4032')"
      )
    ).toBe(false);
  });
});

describe("needsErgonomics", () => {
  it("triggers on held/worn keywords, not on generic parts", () => {
    expect(needsErgonomics("a comfortable grip")).toBe(true);
    expect(needsErgonomics("a knob for a stove")).toBe(true);
    expect(needsErgonomics("a flat bracket")).toBe(false);
  });
});
