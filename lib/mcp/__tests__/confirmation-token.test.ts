import { describe, it, expect } from "vitest";
import { confirmationTokenMatches } from "../confirmation-token";

describe("confirmationTokenMatches", () => {
  it("matches an identical token", () => {
    expect(confirmationTokenMatches("tok_abc", "tok_abc")).toBe(true);
  });

  it("rejects a different token, including one of another length", () => {
    expect(confirmationTokenMatches("tok_abc", "tok_abd")).toBe(false);
    expect(confirmationTokenMatches("tok_abc", "tok_abcdef")).toBe(false);
  });

  it("never matches when either side is missing", () => {
    expect(confirmationTokenMatches(null, "tok_abc")).toBe(false);
    expect(confirmationTokenMatches("tok_abc", undefined)).toBe(false);
    expect(confirmationTokenMatches("", "")).toBe(false);
  });
});
