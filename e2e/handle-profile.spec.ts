import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  deleteAppUserRow,
  type ClerkTestUserFixture,
} from "./fixtures";

/**
 * Regression guard for Sentry 7488668107.
 *
 * Root cause: `getMyUnreadNotificationCount()` (called from
 * `app/(app)/layout.tsx` on every `(app)` route) and
 * `UserProfileView` both call `auth()` without error handling.
 * In Next.js 16 + Clerk v7, `auth()` throws
 * "Clerk: auth() was called but Clerk can't detect usage of
 * clerkMiddleware()" when the proxy context is absent for a request.
 * The fix wraps both `auth()` calls in try/catch so they fall back to
 * anonymous (0 / null userId) instead of crashing the layout with 500.
 *
 * End-to-end reproduction note
 * ─────────────────────────────
 * The exact production failure (proxy context absent) cannot be
 * triggered in the full e2e stack because the `proxy.ts` proxy
 * always runs correctly in the test environment. The definitive
 * unit-level reproduction lives in
 * `lib/notifications/__tests__/queries.test.ts`.
 *
 * What these tests guard instead is the observable HTTP contract:
 * an authenticated user visiting a profile page must never receive
 * a 5xx response regardless of who owns the profile.
 *
 * Secondary issue (proxy.ts escalation)
 * ──────────────────────────────────────
 * `/[handle]` is not listed in `isPublicRoute` in `proxy.ts`.
 * Anonymous visitors are therefore redirected to `/sign-in` instead
 * of seeing the public profile. Fixing that requires adding
 * `/[handle]` to the `isPublicRoute` matcher in `proxy.ts`, which is
 * a protected file per the escalation rules in AGENTS.md. See the PR
 * description for details.
 */

test.describe("GET /[handle] — profile page", () => {
  let user: ClerkTestUserFixture;
  let username: string;

  test.beforeAll(async () => {
    user = await createClerkTestUser();
    const seed = await seedAppUserForClerkId(user.userId, {
      displayName: "E2E Profile Owner",
    });
    username = seed.username;
  });

  test.afterAll(async () => {
    if (user) {
      await deleteAppUserRow(user.userId);
      await deleteClerkTestUser(user);
    }
  });

  test("authenticated user visiting their own profile does not receive a 5xx (Sentry 7488668107)", async ({
    page,
  }) => {
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: user.email,
      },
    });

    // Navigate directly to the unified /[handle] route.
    const response = await page.goto(`/${username}`);
    expect(response?.status()).toBeLessThan(500);

    // The profile heading confirms the page rendered correctly and
    // did not fall through to the error boundary.
    await expect(
      page.getByRole("heading", { name: "E2E Profile Owner" })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("anonymous visitor to /[handle] is redirected (not 5xx) — secondary proxy.ts escalation issue", async ({
    request,
  }) => {
    // Without authentication the proxy calls auth.protect() which
    // redirects to /sign-in. We only assert "not a server error"
    // here because fixing the redirect-to-sign-in behaviour requires
    // adding /[handle] to isPublicRoute in proxy.ts (escalation).
    const res = await request.get(`/${username}`, { maxRedirects: 0 });
    expect(res.status()).toBeLessThan(500);
  });
});
