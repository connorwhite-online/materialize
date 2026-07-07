import { describe, it, expect, vi } from "vitest";

// The route imports Clerk + the DB client at module load; neither is touched by
// the pure helper under test, so stub them to keep the module graph light.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { parseAnswerBody } from "../route";

/**
 * MTR-209 — the answer endpoint accepts a preset `optionId` (card pick) OR a
 * free-text `text` (the always-present custom field). A preset is stored bare
 * (so it matches an offered option id); a free-text answer is sentinel-encoded
 * (`custom:`, MTR-216) so the executor honors it as a typed constraint instead
 * of discarding it. These cover the branch table without the auth/DB shell.
 */
describe("parseAnswerBody", () => {
  it("accepts a valid preset optionId (stored bare)", () => {
    expect(parseAnswerBody({ questionId: "q1", optionId: "hot" })).toEqual({
      questionId: "q1",
      answer: "hot",
    });
  });

  it("accepts a free-text answer, trims it, and sentinel-encodes it", () => {
    expect(
      parseAnswerBody({ questionId: "q1", text: "  a warm grey, matte  " })
    ).toEqual({ questionId: "q1", answer: "custom:a warm grey, matte" });
  });

  it("prefers optionId when both are present", () => {
    expect(
      parseAnswerBody({ questionId: "q1", optionId: "cold", text: "whatever" })
    ).toEqual({ questionId: "q1", answer: "cold" });
  });

  it("falls back to encoded text when optionId is empty/invalid", () => {
    expect(
      parseAnswerBody({ questionId: "q1", optionId: "", text: "custom" })
    ).toEqual({ questionId: "q1", answer: "custom:custom" });
  });

  it("rejects a missing/blank questionId", () => {
    expect(parseAnswerBody({ optionId: "hot" })).toBeNull();
    expect(parseAnswerBody({ questionId: "", optionId: "hot" })).toBeNull();
    expect(parseAnswerBody({ questionId: 42, optionId: "hot" })).toBeNull();
  });

  it("rejects when neither optionId nor a non-empty text is given", () => {
    expect(parseAnswerBody({ questionId: "q1" })).toBeNull();
    expect(parseAnswerBody({ questionId: "q1", text: "   " })).toBeNull();
    expect(parseAnswerBody({ questionId: "q1", optionId: "", text: "" })).toBeNull();
  });

  it("rejects an over-long option id or free-text answer", () => {
    expect(
      parseAnswerBody({ questionId: "q1", optionId: "x".repeat(201) })
    ).toBeNull();
    // An over-long optionId falls through; with no text it's rejected.
    expect(
      parseAnswerBody({ questionId: "q1", text: "y".repeat(2001) })
    ).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseAnswerBody(null)).toBeNull();
    expect(parseAnswerBody("nope")).toBeNull();
    expect(parseAnswerBody(undefined)).toBeNull();
  });
});
