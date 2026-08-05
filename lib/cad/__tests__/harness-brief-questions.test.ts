/**
 * In-job brief questions (walk-away UX): the brief's open questions surface
 * through the executor's onQuestion machinery — present users pick, absent
 * users get the default via the asker's timeout — replacing the old
 * client-side quick-check card that gated the build on a live client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";

const hasModelCredentials = vi.fn(() => true);
const completeText = vi.fn(async () => "```python\nresult = 1\n```");

vi.mock("@/lib/cad/model-client", () => ({
  hasModelCredentials: () => hasModelCredentials(),
  completeText: (...args: unknown[]) =>
    completeText(...(args as Parameters<typeof completeText>)),
}));

const runCadCode = vi.fn<(code: string) => Promise<CadRunResult>>();
vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...args: Parameters<typeof runCadCode>) => runCadCode(...args),
}));

vi.mock("@/lib/cad/concept", () => ({
  conceptImage: async () => null,
  CONCEPT_IMAGE_NOTE: "",
}));

import { runHarness } from "@/lib/cad/harness";
import { CUSTOM_ANSWER_PREFIX, type CadQuestion } from "@/lib/cad/types";

const GOOD: CadRunResult = {
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

// providedBrief skips the brief-model call; questions ride it into the ask
// site directly.
const briefWithQuestion = {
  v: 1,
  part: "an enclosure",
  components: [],
  interfaces: [],
  keepOut: [],
  questions: [
    {
      id: "lid",
      question: "Lid style?",
      options: [
        { label: "Snap-fit", detail: "tool-less" },
        { label: "Screws", detail: "M3 corners" },
      ],
      default: "Screws",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  runCadCode.mockResolvedValue(GOOD);
});

describe("runHarness in-job brief questions", () => {
  it("asks via onQuestion with the brief default pre-mapped, folds the pick into decisions", async () => {
    const asked: CadQuestion[] = [];
    const onQuestion = vi.fn(async (q: CadQuestion) => {
      asked.push(q);
      return q.options[0].id; // pick "Snap-fit"
    });
    const res = await runHarness({
      prompt: "an enclosure",
      providedBrief: briefWithQuestion,
      onQuestion,
    });
    expect(res.ok).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0].text).toBe("Lid style?");
    // The brief default ("Screws", opt-2) maps to defaultOptionId.
    expect(asked[0].defaultOptionId).toBe("opt-2");
    const brief = res.brief as { decisions?: { q: string; a: string }[] };
    expect(brief.decisions).toEqual([{ q: "Lid style?", a: "Snap-fit" }]);
  });

  it("folds a free-text answer verbatim", async () => {
    const onQuestion = vi.fn(async () => `${CUSTOM_ANSWER_PREFIX}hinged lid`);
    const res = await runHarness({
      prompt: "an enclosure",
      providedBrief: briefWithQuestion,
      onQuestion,
    });
    const brief = res.brief as { decisions?: { q: string; a: string }[] };
    expect(brief.decisions).toEqual([{ q: "Lid style?", a: "hinged lid" }]);
  });

  it("no asker (legacy/best-of candidates): questions stay unanswered, defaults resolve at prompt time", async () => {
    const res = await runHarness({
      prompt: "an enclosure",
      providedBrief: briefWithQuestion,
    });
    expect(res.ok).toBe(true);
    const brief = res.brief as { decisions?: unknown };
    expect(brief.decisions).toBeUndefined();
  });

  it("an asker failure never derails the build", async () => {
    const onQuestion = vi.fn(async () => {
      throw new Error("answer poll exploded");
    });
    const res = await runHarness({
      prompt: "an enclosure",
      providedBrief: briefWithQuestion,
      onQuestion,
    });
    expect(res.ok).toBe(true);
  });
});
