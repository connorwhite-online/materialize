import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

describe("constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("Bearer secret123", "Bearer secret123")).toBe(
      true
    );
  });

  it("returns false for differing strings of the same length", () => {
    expect(constantTimeEqual("Bearer secret123", "Bearer secret124")).toBe(
      false
    );
  });

  it("returns false for strings of different lengths", () => {
    expect(constantTimeEqual("Bearer short", "Bearer much-longer-value")).toBe(
      false
    );
  });

  it("returns false when one string is empty and the other is not", () => {
    expect(constantTimeEqual("", "Bearer secret123")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
