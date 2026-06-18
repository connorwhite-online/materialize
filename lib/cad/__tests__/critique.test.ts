import { describe, it, expect } from "vitest";
import {
  parseJudgement,
  judgeAesthetics,
  aestheticJudgeEnabled,
  PASS_THRESHOLD,
} from "@/lib/cad/critique";

function judgeJson(scores: Record<string, number>): string {
  const dims = [
    "recognizability",
    "geometric_coherence",
    "proportion",
    "edge_surface",
    "intentional",
  ];
  const obj: Record<string, unknown> = {};
  for (const d of dims) obj[d] = { score: scores[d], reason: "r", fix: `fix ${d}` };
  return JSON.stringify(obj);
}

describe("parseJudgement", () => {
  it("computes a weighted 0-100 aggregate and passes a strong part", () => {
    const r = parseJudgement(
      judgeJson({
        recognizability: 5,
        geometric_coherence: 5,
        proportion: 4,
        edge_surface: 4,
        intentional: 4,
      })
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBe(91); // (5*2+5*2+4+4+4)/7/5*100
    expect(r!.pass).toBe(true);
  });

  it("fails on the per-dimension floor even when the mean is high", () => {
    const r = parseJudgement(
      judgeJson({
        recognizability: 1, // <= floor
        geometric_coherence: 5,
        proportion: 5,
        edge_surface: 5,
        intentional: 5,
      })
    );
    expect(r!.pass).toBe(false);
  });

  it("builds repair feedback from weak (<=3) dimensions", () => {
    const r = parseJudgement(
      judgeJson({
        recognizability: 5,
        geometric_coherence: 5,
        proportion: 2,
        edge_surface: 3,
        intentional: 5,
      })
    );
    expect(r!.feedback).toMatch(/proportion: fix proportion/);
    expect(r!.feedback).toMatch(/edge_surface: fix edge_surface/);
    expect(r!.feedback).not.toMatch(/recognizability/);
  });

  it("extracts JSON embedded in prose and clamps out-of-range scores", () => {
    const r = parseJudgement(
      `Here is my assessment:\n${judgeJson({
        recognizability: 9,
        geometric_coherence: 5,
        proportion: 5,
        edge_surface: 5,
        intentional: 5,
      })}\nThanks!`
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBe(100); // 9 clamped to 5 → all 5s
  });

  it("returns null on malformed or incomplete responses", () => {
    expect(parseJudgement("no json here")).toBeNull();
    expect(parseJudgement('{"recognizability":{"score":5}}')).toBeNull(); // missing dims
  });
});

describe("gating", () => {
  it("is disabled by default (no flag / no creds) and judge is a no-op", async () => {
    expect(aestheticJudgeEnabled()).toBe(false);
    const res = await judgeAesthetics({ renderPng: "abc", prompt: "a box" });
    expect(res).toEqual({ available: false });
  });

  it("exposes a sane pass threshold", () => {
    expect(PASS_THRESHOLD).toBeGreaterThan(0);
    expect(PASS_THRESHOLD).toBeLessThanOrEqual(100);
  });
});
