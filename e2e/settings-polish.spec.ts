import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  deleteAppUserRow,
  setClerkUsername,
  type ClerkTestUserFixture,
} from "./fixtures";

/**
 * CON-18: Settings tab fold-in, icon theme toggle, saved-card copy.
 */
test.describe("Owner profile settings polish", () => {
  let user: ClerkTestUserFixture;
  let username: string;

  test.beforeAll(async () => {
    user = await createClerkTestUser();
    const seed = await seedAppUserForClerkId(user.userId, {
      displayName: "Ada Lovelace",
    });
    username = seed.username;
    await setClerkUsername(user.userId, username);
  });

  test.afterAll(async () => {
    if (user) {
      await deleteAppUserRow(user.userId);
      await deleteClerkTestUser(user);
    }
  });

  test("Settings folds notifications, icon theme, saved-card copy", async ({
    page,
  }, testInfo) => {
    const settingsTab = page.getByRole("tab", {
      name: "Settings",
      exact: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: user.email,
      },
    });

    await page.goto(`/${username}`);
    await expect(settingsTab).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "Agents" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Notifications" })).toHaveCount(
      0
    );
    await expect(
      page.getByRole("tab", { name: "General", exact: true })
    ).toHaveCount(0);

    await expect(page.getByText("Email notifications")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "System" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Light" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Dark" })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("settings_tab_icon_theme.png"),
      fullPage: true,
    });

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await page.screenshot({
      path: testInfo.outputPath("settings_theme_dark.png"),
      fullPage: true,
    });

    await page.getByRole("tab", { name: "Payments" }).click();
    await expect(page.getByText("Saved card")).toBeVisible();
    await expect(
      page.getByText("Card on file for print checkout and agent orders")
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("payments_saved_card_copy.png"),
      fullPage: true,
    });

    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", { name: "Notifications" })
    ).toBeVisible({ timeout: 15_000 });
    const gear = page.getByRole("button", { name: "Notification settings" });
    await expect(gear).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("notifications_gear_headline.png"),
      fullPage: true,
    });
    await gear.click();
    const sheet = page.getByRole("dialog", { name: "Notification settings" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Email notifications")).toBeVisible();
    // Let the spring settle before snapshotting the sheet.
    await page.waitForTimeout(450);
    await page.screenshot({
      path: testInfo.outputPath("notifications_settings_sheet.png"),
    });
  });
});
