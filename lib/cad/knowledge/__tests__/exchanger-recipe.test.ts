import { describe, expect, it } from "vitest";

import { buildKnowledgeBlock } from "..";
import { needsExchangerRecipe } from "../exchanger-recipe";

describe("needsExchangerRecipe", () => {
  it("matches explicit exchanger nouns", () => {
    expect(needsExchangerRecipe("a compact heat exchanger for my loop")).toBe(true);
    expect(needsExchangerRecipe("liquid-air intercooler core")).toBe(true);
    expect(needsExchangerRecipe("a recuperator block")).toBe(true);
  });

  it("matches dual-fluid phrasing near TPMS vocabulary", () => {
    expect(
      needsExchangerRecipe("a gyroid core where two liquids flow past each other")
    ).toBe(true);
    expect(
      needsExchangerRecipe("TPMS lattice with hot fluid crossing cold fluid")
    ).toBe(true);
    expect(
      needsExchangerRecipe("dual-channel schwarz lattice manifold")
    ).toBe(true);
  });

  it("does NOT trigger on single-fluid lattice asks", () => {
    expect(needsExchangerRecipe("a gyroid lamp shade")).toBe(false);
    expect(needsExchangerRecipe("a lattice-infilled bracket")).toBe(false);
    expect(needsExchangerRecipe("a bottle for two liquids")).toBe(false);
    expect(needsExchangerRecipe("a parametric enclosure for an ESP32")).toBe(false);
  });

  it("is injected into the knowledge block only when triggered", () => {
    expect(
      buildKnowledgeBlock({ prompt: "dual-fluid gyroid heat exchanger" })
    ).toContain("DUAL-FLUID EXCHANGER RECIPE");
    expect(
      buildKnowledgeBlock({ prompt: "a gyroid lamp shade" })
    ).not.toContain("DUAL-FLUID EXCHANGER RECIPE");
  });
});
