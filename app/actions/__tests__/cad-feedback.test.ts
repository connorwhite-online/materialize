import { describe, it, expect, vi, beforeEach } from "vitest";

let allowed = true;
let returningRows: Array<{ id: string }> = [{ id: "gen-1" }];
const setCalls: Array<Record<string, unknown>> = [];
const whereArgs: unknown[] = [];

vi.mock("@/lib/features", () => ({
  canUseTextToCad: vi.fn(() => allowed),
}));

// recordCadFeedback shares a module with generateCadModel, which imports
// these — mock them so importing the action doesn't drag in the harness /
// storage / files chains.
vi.mock("@/lib/cad/harness", () => ({ runHarness: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  putObject: vi.fn(),
  generateDownloadUrl: vi.fn(),
}));
vi.mock("@/app/actions/files", () => ({ createDraftFileForPrint: vi.fn() }));

vi.mock("@/lib/db/schema", () => ({
  cadGenerations: { __name: "cad_generations", id: "id", userId: "user_id" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        setCalls.push(vals);
        return {
          where: (...args: unknown[]) => {
            whereArgs.push(...args);
            return { returning: () => Promise.resolve(returningRows) };
          },
        };
      },
    }),
  },
}));

import { recordCadFeedback } from "@/app/actions/cad-generation";

describe("recordCadFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowed = true;
    returningRows = [{ id: "gen-1" }];
    setCalls.length = 0;
    whereArgs.length = 0;
  });

  it("404-equivalents when the caller isn't allowed (no write)", async () => {
    allowed = false;
    const res = await recordCadFeedback({
      generationId: "gen-1",
      rating: "good",
      tags: ["great"],
    });
    expect(res).toEqual({ error: "Not found" });
    expect(setCalls).toHaveLength(0);
  });

  it("persists sanitized rating/tags/note on success", async () => {
    const res = await recordCadFeedback({
      generationId: "gen-1",
      rating: "good",
      tags: ["great", "not_a_real_tag", "ugly", "great"],
      note: "  needs a flat base  ",
    });
    expect(res).toEqual({ ok: true });
    const saved = setCalls.at(-1)!;
    // Unknown tag dropped, duplicate removed, order preserved.
    expect(saved.feedbackTags).toEqual(["great", "ugly"]);
    expect(saved.rating).toBe("good");
    expect(saved.feedbackNote).toBe("needs a flat base");
    expect(saved.feedbackAt).toBeInstanceOf(Date);
  });

  it("coerces an invalid rating to null and empty note to null", async () => {
    await recordCadFeedback({
      generationId: "gen-1",
      // @ts-expect-error — exercising runtime coercion of a bad value
      rating: "meh",
      tags: [],
      note: "   ",
    });
    const saved = setCalls.at(-1)!;
    expect(saved.rating).toBeNull();
    expect(saved.feedbackNote).toBeNull();
    expect(saved.feedbackTags).toEqual([]);
  });

  it("returns Not found when the row isn't the caller's (no rows updated)", async () => {
    returningRows = [];
    const res = await recordCadFeedback({
      generationId: "someone-elses",
      rating: "bad",
      tags: [],
    });
    expect(res).toEqual({ error: "Not found" });
  });
});
