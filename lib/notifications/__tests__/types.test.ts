import { describe, it, expect } from "vitest";
import { makeSnippet } from "../types";

describe("makeSnippet", () => {
  it("returns empty string for null/undefined", () => {
    expect(makeSnippet(null)).toBe("");
  });

  it("trims whitespace", () => {
    expect(makeSnippet("  hello  ")).toBe("hello");
  });

  it("collapses internal whitespace and newlines", () => {
    expect(makeSnippet("hello\n\n  world\t\there")).toBe("hello world here");
  });

  it("returns short bodies unchanged", () => {
    expect(makeSnippet("looks great!")).toBe("looks great!");
  });

  it("truncates long bodies with an ellipsis", () => {
    const long = "a".repeat(200);
    const out = makeSnippet(long);
    expect(out.length).toBe(140);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects a custom maxLen", () => {
    const out = makeSnippet("a".repeat(50), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("doesn't truncate when exactly at the limit", () => {
    const exact = "a".repeat(140);
    expect(makeSnippet(exact)).toBe(exact);
  });
});
