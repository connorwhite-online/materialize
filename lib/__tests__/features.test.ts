import { describe, it, expect, afterEach, vi } from "vitest";
import { currentUser } from "@clerk/nextjs/server";
import {
  isTextToCadEnabled,
  emailHasTextToCadAccess,
  canUseTextToCad,
  resolveTextToCadAccess,
} from "@/lib/features";

type CurrentUserResult = Awaited<ReturnType<typeof currentUser>>;

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

/**
 * Regression: the unguarded `currentUser()` in app/(app)/layout.tsx
 * threw the Clerk "can't detect usage of clerkMiddleware()" error
 * (Sentry 7488668107) and 500'd every authed page once
 * TEXT_TO_CAD_ENABLED was flipped on in production. The sibling
 * `getMyUnreadNotificationCount` already guards `auth()`; this gate
 * must fail closed the same way.
 */
describe("resolveTextToCadAccess", () => {
  it("never calls currentUser() when the kill switch is off", async () => {
    delete process.env.TEXT_TO_CAD_ENABLED;
    process.env.TEXT_TO_CAD_ALLOWED_EMAILS = "a@x.com";
    vi.mocked(currentUser).mockClear();

    await expect(resolveTextToCadAccess()).resolves.toBe(false);
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("returns false (does not throw) when currentUser() throws the Clerk middleware-context error", async () => {
    process.env.TEXT_TO_CAD_ENABLED = "true";
    process.env.TEXT_TO_CAD_ALLOWED_EMAILS = "a@x.com";
    vi.mocked(currentUser).mockRejectedValueOnce(
      new Error(
        "Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware()."
      )
    );

    await expect(resolveTextToCadAccess()).resolves.toBe(false);
  });

  it("grants access when the flag is on and the email is allow-listed", async () => {
    process.env.TEXT_TO_CAD_ENABLED = "true";
    process.env.TEXT_TO_CAD_ALLOWED_EMAILS = "owner@x.com";
    vi.mocked(currentUser).mockResolvedValueOnce({
      primaryEmailAddressId: "e1",
      emailAddresses: [{ id: "e1", emailAddress: "owner@x.com" }],
    } as unknown as CurrentUserResult);

    await expect(resolveTextToCadAccess()).resolves.toBe(true);
  });

  it("denies a signed-in user whose email is not allow-listed", async () => {
    process.env.TEXT_TO_CAD_ENABLED = "true";
    process.env.TEXT_TO_CAD_ALLOWED_EMAILS = "owner@x.com";
    vi.mocked(currentUser).mockResolvedValueOnce({
      primaryEmailAddressId: "e1",
      emailAddresses: [{ id: "e1", emailAddress: "stranger@y.com" }],
    } as unknown as CurrentUserResult);

    await expect(resolveTextToCadAccess()).resolves.toBe(false);
  });
});
