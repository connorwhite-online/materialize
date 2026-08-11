import { describe, it, expect, vi, beforeEach } from "vitest";

const completeText = vi.fn(async (..._args: unknown[]) => "");
vi.mock("@/lib/cad/model-client", () => ({
  completeText: (...args: unknown[]) =>
    completeText(...(args as Parameters<typeof completeText>)),
  hasModelCredentials: () => true,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  proposeConceptDirections,
  classifyConceptPhase,
  FALLBACK_DIRECTIONS,
} from "@/lib/cad/concept-directions";

describe("proposeConceptDirections", () => {
  beforeEach(() => completeText.mockReset());

  it("parses proposed directions (explore)", async () => {
    completeText.mockResolvedValue(
      'Here you go: [{"label":"Flush architectural","detail":"planar faces, hidden fasteners"},{"label":"Vented utilitarian","detail":"honest grilles, exposed bosses"},{"label":"Soft consumer","detail":"pebble radii, seamless shell"}]'
    );
    const dirs = await proposeConceptDirections({
      prompt: "a wall-mounted sensor housing",
      phase: "explore",
    });
    expect(dirs).toHaveLength(3);
    expect(dirs[0].label).toBe("Flush architectural");
  });

  it("explore falls back to the presets on garbage", async () => {
    completeText.mockResolvedValue("I cannot help with that.");
    const dirs = await proposeConceptDirections({ prompt: "x", phase: "explore" });
    expect(dirs).toEqual(FALLBACK_DIRECTIONS);
  });

  it("refine falls back to [] (keep the current target, no preset pivot)", async () => {
    completeText.mockRejectedValueOnce(new Error("down"));
    const dirs = await proposeConceptDirections({ prompt: "x", phase: "refine" });
    expect(dirs).toEqual([]);
  });
});

describe("classifyConceptPhase", () => {
  beforeEach(() => completeText.mockReset());

  it("fresh builds explore without a model call", async () => {
    expect(
      await classifyConceptPhase({ prompt: "a phone stand", isRevision: false })
    ).toBe("explore");
    expect(completeText).not.toHaveBeenCalled();
  });

  it("maps REFINE / SKIP / EXPLORE verdicts", async () => {
    completeText.mockResolvedValueOnce("REFINE");
    expect(
      await classifyConceptPhase({ prompt: "make it look sleeker", isRevision: true })
    ).toBe("refine");
    completeText.mockResolvedValueOnce("SKIP");
    expect(
      await classifyConceptPhase({ prompt: "make the hole 5mm", isRevision: true })
    ).toBe("skip");
    completeText.mockResolvedValueOnce("EXPLORE");
    expect(
      await classifyConceptPhase({ prompt: "start over completely", isRevision: true })
    ).toBe("explore");
  });

  it("doubt or failure means skip (friction beats a missed card)", async () => {
    completeText.mockResolvedValueOnce("hmm, unclear");
    expect(await classifyConceptPhase({ prompt: "x", isRevision: true })).toBe(
      "skip"
    );
    completeText.mockRejectedValueOnce(new Error("down"));
    expect(await classifyConceptPhase({ prompt: "x", isRevision: true })).toBe(
      "skip"
    );
  });
});
