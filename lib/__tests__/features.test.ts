import { describe, it, expect, afterEach } from "vitest";
import {
  isTextToCadEnabled,
  emailHasTextToCadAccess,
  canUseTextToCad,
} from "@/lib/features";

// These functions read process.env at call time, so each test sets the
// env it needs and we restore afterwards. No module mocking required.
const ORIGINAL = {
  enabled: process.env.TEXT_TO_CAD_ENABLED,
  emails: process.env.TEXT_TO_CAD_ALLOWED_EMAILS,
};

afterEach(() => {
  process.env.TEXT_TO_CAD_ENABLED = ORIGINAL.enabled;
  process.env.TEXT_TO_CAD_ALLOWED_EMAILS = ORIGINAL.emails;
});

describe("isTextToCadEnabled", () => {
  it("is OFF by default / when unset", () => {
    delete process.env.TEXT_TO_CAD_ENABLED;
    expect(isTextToCadEnabled()).toBe(false);
  });

  it("only the exact string 'true' enables it", () => {
    process.env.TEXT_TO_CAD_ENABLED = "TRUE";
    expect(isTextToCadEnabled()).toBe(false);
    process.env.TEXT_TO_CAD_ENABLED = "1";
    expect(isTextToCadEnabled()).toBe(false);
    process.env.TEXT_TO_CAD_ENABLED = "true";
    expect(isTextToCadEnabled()).toBe(true);
  });
});

describe("emailHasTextToCadAccess", () => {
  it("rejects null/empty email", () => {
    process.env.TEXT_TO_CAD_ALLOWED_EMAILS = "a@x.com";
    expect(emailHasTextToCadAccess(null)).toBe(false);
    expect(emailHasTextToCadAccess(undefined)).toBe(false);
    expect(emailHasTextToCadAccess("")).toBe(false);
  });

  it("is case-insensitive and tolerates whitespace in the list", () => {
    process.env.TEXT_TO_CAD_ALLOWED_EMAILS = " A@X.com , b@y.com ";
    expect(emailHasTextToCadAccess("a@x.com")).toBe(true);
    expect(emailHasTextToCadAccess("B@Y.COM")).toBe(true);
    expect(emailHasTextToCadAccess("c@z.com")).toBe(false);
  });

  it("denies everyone when the list is empty/unset", () => {
    delete process.env.TEXT_TO_CAD_ALLOWED_EMAILS;
    expect(emailHasTextToCadAccess("a@x.com")).toBe(false);
  });
});

describe("canUseTextToCad (both gates AND-ed)", () => {
  const cases: Array<[string | undefined, string, string | null, boolean]> = [
    // [enabled, allowList, email, expected]
    ["true", "a@x.com", "a@x.com", true],
    ["true", "a@x.com", "b@y.com", false], // flag on, not allowed
    [undefined, "a@x.com", "a@x.com", false], // allowed, flag off
    ["false", "a@x.com", "a@x.com", false], // explicit off
    ["true", "", "a@x.com", false], // flag on, empty list
    ["true", "a@x.com", null, false], // flag on, anon
  ];

  it.each(cases)(
    "enabled=%s list=%s email=%s -> %s",
    (enabled, list, email, expected) => {
      if (enabled === undefined) delete process.env.TEXT_TO_CAD_ENABLED;
      else process.env.TEXT_TO_CAD_ENABLED = enabled;
      process.env.TEXT_TO_CAD_ALLOWED_EMAILS = list;
      expect(canUseTextToCad(email)).toBe(expected);
    }
  );
});
