import { describe, it, expect } from "vitest";

import { clerkErrorMessage } from "../error-message";

// The contract that matters: Clerk's user-facing explanation gets
// through, and anything that ISN'T a Clerk API error returns null so
// callers show their own copy instead of leaking internals to users.

describe("clerkErrorMessage", () => {
  it("returns longMessage — the string Clerk writes for end users", () => {
    // Shape of a real Clerk 422 on a too-short username.
    const err = Object.assign(new Error("Unprocessable Entity"), {
      status: 422,
      errors: [
        {
          code: "form_username_invalid_length",
          message: "Username is invalid",
          longMessage: "Username must be at least 4 characters long.",
        },
      ],
    });

    expect(clerkErrorMessage(err)).toBe(
      "Username must be at least 4 characters long."
    );
  });

  it("falls back to message when longMessage is absent", () => {
    const err = { errors: [{ message: "Username is taken" }] };
    expect(clerkErrorMessage(err)).toBe("Username is taken");
  });

  it("reports only the first error when Clerk returns several", () => {
    const err = {
      errors: [{ longMessage: "First problem." }, { longMessage: "Second." }],
    };
    expect(clerkErrorMessage(err)).toBe("First problem.");
  });

  it.each([
    ["a plain Error (DB blip, programmer error)", new Error("connect ETIMEDOUT")],
    ["null", null],
    ["undefined", undefined],
    ["a string", "boom"],
    ["an empty errors array", { errors: [] }],
    ["a non-array errors field", { errors: "nope" }],
    ["an errors entry with no usable text", { errors: [{ code: "x" }] }],
    ["blank message strings", { errors: [{ longMessage: "   " }] }],
  ])("returns null for %s", (_label, input) => {
    expect(clerkErrorMessage(input)).toBeNull();
  });
});
