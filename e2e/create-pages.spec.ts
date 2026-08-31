import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  setClerkUsername,
  deleteAppUserRow,
  type ClerkTestUserFixture,
} from "./fixtures";

/**
 * Project + collection create are pages, not overlays. The home
 * create cluster (and every other entry) navigates to
 * `/projects/new` / `/collections/new`, and each page header is
 * preceded by the primitive's glyph (layers / folder).
 */
test.describe("create pages", () => {
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

  test("home create actions open pages with their icons, not dialogs", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: user.email,
      },
    });
    await page.goto("/");

    const collectionCta = page.locator('a[href="/collections/new"]');
    await expect(collectionCta).toBeVisible({ timeout: 10_000 });
    await expect(collectionCta).toHaveText(/new collection/i);

    await collectionCta.click();
    await expect(page).toHaveURL(/\/collections\/new$/, { timeout: 20_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const collectionHeading = page.getByRole("heading", {
      name: "New collection",
    });
    await expect(collectionHeading).toBeVisible();
    await expect(collectionHeading.locator("xpath=..").locator("svg")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create collection" })
    ).toBeVisible();
    await page.screenshot({
      path: `${testInfo.outputDir}/collection-create-page.png`,
      fullPage: true,
    });

    await page.goto("/");
    const projectCta = page.locator('a[href="/projects/new"]');
    await expect(projectCta).toHaveText(/new project/i);
    await projectCta.click();
    await expect(page).toHaveURL(/\/projects\/new$/, { timeout: 20_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const projectHeading = page.getByRole("heading", { name: "New project" });
    await expect(projectHeading).toBeVisible();
    await expect(projectHeading.locator("xpath=..").locator("svg")).toBeVisible();
    await page.screenshot({
      path: `${testInfo.outputDir}/project-create-page.png`,
      fullPage: true,
    });

    // CON-34 — License is a details field, not gated by List for sale.
    // Sale off: License visible, Price hidden. CardTitle is a div, not a heading.
    const licenseTrigger = page.locator("#license-trigger");
    await expect(licenseTrigger).toBeVisible();
    await expect(page.getByText("List for sale", { exact: true })).toBeVisible();
    await expect(page.locator("#price")).toHaveCount(0);
    await page.screenshot({
      path: `${testInfo.outputDir}/project-license-sale-off.png`,
      fullPage: true,
    });

    // Sale on: Price appears; License stays in Project details.
    await page.getByRole("switch").click();
    await expect(page.locator("#price")).toBeVisible();
    await expect(licenseTrigger).toBeVisible();
    await page.screenshot({
      path: `${testInfo.outputDir}/project-license-sale-on.png`,
      fullPage: true,
    });
  });
});
