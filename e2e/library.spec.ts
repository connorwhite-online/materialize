import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  createOwnedFileFixture,
  deleteOwnedFileFixture,
  deleteAppUserRow,
  type ClerkTestUserFixture,
  type OwnedFileFixture,
} from "./fixtures";

/**
 * Library-tab regression guard. The authed home redirects to
 * /u/<username>, so the library tab is the first thing every
 * signed-in user sees on every session start — high blast radius
 * for any regression in the parallelized queries on
 * app/(app)/u/[username]/page.tsx or its child LibraryTab.
 *
 * What this asserts: an owned file appears in the owner's own
 * library when they sign in. Doesn't cover the purchased path
 * (separate fixture, separate spec).
 */

test.describe("library tab", () => {
  let user: ClerkTestUserFixture;
  let username: string;
  let file: OwnedFileFixture;

  test.beforeAll(async () => {
    user = await createClerkTestUser();
    const seed = await seedAppUserForClerkId(user.userId);
    username = seed.username;
    file = await createOwnedFileFixture(user.userId);
  });

  test.afterAll(async () => {
    if (file) await deleteOwnedFileFixture(file);
    if (user) {
      await deleteAppUserRow(user.userId);
      await deleteClerkTestUser(user);
    }
  });

  test("owner sees their uploaded file in their library", async ({ page }) => {
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: user.email,
      },
    });

    // Authed home redirects to /u/<username>. Navigate explicitly
    // so we don't race the redirect.
    await page.goto(`/u/${username}`);

    // The display name appears in the profile header — confirms
    // we landed on the right user's page.
    await expect(page.getByText("E2E Authed Buyer").first()).toBeVisible({
      timeout: 10_000,
    });

    // The seeded file should appear in the library by its name.
    // We don't pin to a specific card component selector — copy
    // is the user-visible contract.
    await expect(page.getByText(file.name)).toBeVisible({
      timeout: 10_000,
    });
  });
});
