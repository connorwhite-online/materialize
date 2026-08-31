import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  setClerkUsername,
  createOwnedFileFixture,
  attachOwnedFileAsset,
  deleteOwnedFileFixture,
  deleteAppUserRow,
  type ClerkTestUserFixture,
  type OwnedFileFixture,
} from "./fixtures";

/**
 * Library-tab regression guard. The authed home at `/` now hosts the
 * owner's library below the upload area. High blast radius for any
 * regression in the parallelized queries on LibraryTab.
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
    await setClerkUsername(user.userId, username);
    file = await createOwnedFileFixture(user.userId);
    // Recent files is loadLibraryTiles, which skips files with no asset.
    await attachOwnedFileAsset(file.fileId);
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

    // Authed `/` is the library home. Sign-in from `/` already lands
    // there; reload so we don't race Clerk finishing the session.
    await page.goto("/");

    // Authed home no longer shows a visible Library heading, item
    // tally, or + Add — those live in the create cluster above.
    // The heading stays in the a11y tree as sr-only.
    await expect(page.getByText("Add a File")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("heading", { name: "Library", exact: true })
    ).toHaveClass(/sr-only/);
    await expect(page.getByRole("button", { name: /^add$/i })).toHaveCount(0);
    await expect(page.getByText(/^\d+ items?$/)).toHaveCount(0);

    // The seeded file should appear in the library by its name.
    // We don't pin to a specific card component selector — copy
    // is the user-visible contract.
    await expect(page.getByText(file.name)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("recent and library cards open the listing, not print (CON-32)", async ({
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
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Recent files" })
    ).toBeVisible({ timeout: 10_000 });

    const listingHref = `/files/${file.slug}`;
    const cards = page.getByRole("link").filter({ hasText: file.name });
    await expect(cards.first()).toBeVisible();
    const hrefs = await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute("href"))
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(1);
    for (const href of hrefs) {
      expect(href).toBe(listingHref);
      expect(href).not.toMatch(/^\/print\//);
    }

    await cards.first().click();
    await expect(page).toHaveURL(new RegExp(`${listingHref}(?:\\?.*)?$`));
    expect(page.url()).not.toContain("/print/");
  });
});

test.describe("library tab — empty authed home", () => {
  let user: ClerkTestUserFixture;

  test.beforeAll(async () => {
    user = await createClerkTestUser();
    const seed = await seedAppUserForClerkId(user.userId);
    await setClerkUsername(user.userId, seed.username);
  });

  test.afterAll(async () => {
    if (user) {
      await deleteAppUserRow(user.userId);
      await deleteClerkTestUser(user);
    }
  });

  test("does not render the library empty explainer", async ({ page }) => {
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: user.email,
      },
    });
    await page.goto("/");

    await expect(page.getByText("Add a File")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: /new project/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /new collection/i })
    ).toBeVisible();

    // Compact empty library returns null. The File / Project / Collection
    // cards under “Your library is empty” are redundant with the create
    // cluster and will come back in a dedicated empty-state pass.
    await expect(page.getByText("Your library is empty")).toHaveCount(0);
    await expect(
      page.getByText("Everything starts with a file.")
    ).toHaveCount(0);
    await expect(page.getByText("Nothing to show.")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Library", exact: true })
    ).toHaveCount(0);
  });
});
