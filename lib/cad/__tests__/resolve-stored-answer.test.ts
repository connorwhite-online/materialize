import { describe, it, expect } from "vitest";

import {
  CUSTOM_ANSWER_PREFIX,
  encodeCustomAnswer,
  resolveStoredAnswer,
  type CadQuestionOption,
} from "@/lib/cad/types";

/**
 * MTR-216 — a mid-cycle answer stored in `cadJobs.answers` is either a preset
 * option id (bare) or a free-text custom answer (sentinel-encoded). Both the
 * executor (jobs.ts) and the agentic consumer (agentic.ts) decode it through
 * this one function, so its branch table is the contract worth pinning.
 */
const OPTIONS: CadQuestionOption[] = [
  { id: "opt-1", label: "Pi 4B" },
  { id: "opt-2", label: "Pi 5" },
];

describe("resolveStoredAnswer", () => {
  it("resolves a bare value matching an offered option to that option", () => {
    expect(resolveStoredAnswer("opt-2", OPTIONS)).toEqual({
      kind: "option",
      option: OPTIONS[1],
    });
  });

  it("decodes a sentinel-encoded free-text answer to trimmed text", () => {
    expect(
      resolveStoredAnswer(encodeCustomAnswer("a Pi 5 with the PoE HAT"), OPTIONS)
    ).toEqual({ kind: "text", text: "a Pi 5 with the PoE HAT" });
  });

  it("returns null for a stale option id that matches nothing (no sentinel)", () => {
    // A preset id from a changed question — not text, must fall back to default.
    expect(resolveStoredAnswer("opt-9", OPTIONS)).toBeNull();
    expect(resolveStoredAnswer("not-an-option", OPTIONS)).toBeNull();
  });

  it("returns null for an empty custom answer", () => {
    expect(resolveStoredAnswer(`${CUSTOM_ANSWER_PREFIX}   `, OPTIONS)).toBeNull();
  });

  it("prefers an option match over sentinel decoding (ids can't collide)", () => {
    // Defensive: even if an option id somehow equalled the raw sentinel string,
    // the option match wins.
    const opts: CadQuestionOption[] = [
      { id: `${CUSTOM_ANSWER_PREFIX}x`, label: "weird" },
    ];
    expect(resolveStoredAnswer(`${CUSTOM_ANSWER_PREFIX}x`, opts)).toEqual({
      kind: "option",
      option: opts[0],
    });
  });
});
