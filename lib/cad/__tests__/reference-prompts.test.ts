import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadRunResult, PromptImage } from "@/lib/cad/types";
import { labelUserReferences, formatThreadHistory } from "@/lib/cad/types";

// Same mocking shape as harness.test.ts: deterministic model + runner.
const hasModelCredentials = vi.fn(() => true);
const completeText = vi.fn(
  async (..._args: unknown[]) => "```python\nresult = 1\n```"
);

vi.mock("@/lib/cad/model-client", () => ({
  hasModelCredentials: () => hasModelCredentials(),
  completeText: (...args: unknown[]) =>
    completeText(...(args as Parameters<typeof completeText>)),
}));

const runCadCode = vi.fn<
  (code: string, formats?: string[], signal?: AbortSignal) => Promise<CadRunResult>
>();

vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...args: Parameters<typeof runCadCode>) => runCadCode(...args),
}));

const conceptImage = vi.fn(async (): Promise<PromptImage | null> => null);
vi.mock("@/lib/cad/concept", () => ({
  conceptImage: (...args: unknown[]) =>
    conceptImage(...(args as Parameters<typeof conceptImage>)),
  CONCEPT_IMAGE_NOTE: "CONCEPT_NOTE_SENTINEL",
}));

import { runHarness } from "@/lib/cad/harness";

function solid(): CadRunResult {
  return {
    ok: true,
    files: { stl: "AA==" },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
  };
}

const REF: PromptImage = { data: "QUJD", mediaType: "image/png" };

describe("reference images in harness prompts", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(solid());
    conceptImage.mockReset().mockResolvedValue(null);
    process.env.CAD_PLAN_STEP = "false";
    process.env.CAD_BRIEF_STEP = "false";
    process.env.CAD_CRITIQUE = "false";
  });

  it("captions user references and states the reference note in the generate prompt", async () => {
    const result = await runHarness({
      prompt: "a phone stand",
      images: [REF],
      maxAttempts: 1,
    });
    expect(result.ok).toBe(true);

    const call = completeText.mock.calls[0][0] as unknown as {
      prompt: string;
      images?: PromptImage[];
    };
    expect(call.prompt).toContain("User reference image");
    expect(call.images).toHaveLength(1);
    expect(call.images?.[0].label).toContain("User reference image 1 of 1");
  });

  it("skips the concept render when user references exist (refs are the taste target)", async () => {
    await runHarness({ prompt: "a phone stand", images: [REF], maxAttempts: 1 });
    expect(conceptImage).not.toHaveBeenCalled();

    conceptImage.mockClear();
    await runHarness({ prompt: "a phone stand", maxAttempts: 1 });
    expect(conceptImage).toHaveBeenCalledTimes(1);
  });

  it("labels the prior-attempt render on a repair turn so it can't be mistaken for a reference", async () => {
    runCadCode
      .mockReset()
      .mockResolvedValueOnce({
        ...solid(),
        ok: false,
        renderPng: "UkVOREVS",
        validation: {
          compiled: true,
          isSolid: false,
          isWatertight: false,
          isManifold: false,
        },
        error: "not a solid",
      })
      .mockResolvedValueOnce(solid());

    const result = await runHarness({
      prompt: "a phone stand",
      images: [REF],
      maxAttempts: 2,
    });
    expect(result.ok).toBe(true);

    const repairCall = completeText.mock.calls[1][0] as unknown as {
      images?: PromptImage[];
    };
    const labels = (repairCall.images ?? []).map((i) => i.label ?? "");
    expect(labels.some((l) => l.includes("User reference image"))).toBe(true);
    expect(labels.some((l) => l.includes("previous attempt"))).toBe(true);
  });

  it("threads the conversation graph into a revision prompt", async () => {
    await runHarness({
      prompt: "make the base wider",
      priorSourceCode: "result = 1",
      threadHistory: [
        { prompt: "a phone stand" },
        { prompt: "add a cable slot", rating: "bad", note: "slot too small" },
      ],
      maxAttempts: 1,
    });

    const call = completeText.mock.calls[0][0] as unknown as { prompt: string };
    expect(call.prompt).toContain("How this build has unfolded");
    expect(call.prompt).toContain('"a phone stand"');
    expect(call.prompt).toContain('"add a cable slot"');
    expect(call.prompt).toContain("slot too small");
  });

  it("fresh builds carry no history block", async () => {
    await runHarness({ prompt: "a phone stand", maxAttempts: 1 });
    const call = completeText.mock.calls[0][0] as unknown as { prompt: string };
    expect(call.prompt).not.toContain("How this build has unfolded");
  });
});

describe("labelUserReferences", () => {
  it("captions each image with its position and keeps existing labels", () => {
    const out = labelUserReferences([
      REF,
      { ...REF, label: "already labeled" },
    ]);
    expect(out[0].label).toContain("User reference image 1 of 2");
    expect(out[1].label).toBe("already labeled");
  });

  it("returns [] for null/undefined", () => {
    expect(labelUserReferences(null)).toEqual([]);
    expect(labelUserReferences(undefined)).toEqual([]);
  });
});

describe("formatThreadHistory", () => {
  it("renders oldest-first numbered turns with ratings and notes", () => {
    const block = formatThreadHistory([
      { prompt: "a phone stand" },
      { prompt: "add a slot", rating: "bad", note: "too small" },
    ]);
    expect(block).toContain('1. "a phone stand"');
    expect(block).toContain('2. "add a slot" (user rated the result bad)');
    expect(block).toContain('user note: "too small"');
  });

  it("is empty for an empty history", () => {
    expect(formatThreadHistory([])).toBe("");
  });
});
