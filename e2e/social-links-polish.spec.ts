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
import { neon } from "@neondatabase/serverless";

/**
 * CON-28: social links left-aligned with brand icons (not text names).
 */
test.describe("Profile social links polish", () => {
  let user: ClerkTestUserFixture;
  let username: string;

  test.beforeAll(async () => {
    user = await createClerkTestUser();
    const seed = await seedAppUserForClerkId(user.userId, {
      displayName: "",
    });
    username = seed.username;
    await setClerkUsername(user.userId, username);

    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      UPDATE users
      SET bio = 'having fun',
          social_links = ${JSON.stringify([])}::jsonb
      WHERE id = ${user.userId}
    `;
  });

  test.afterAll(async () => {
    if (user) {
      await deleteAppUserRow(user.userId);
      await deleteClerkTestUser(user);
    }
  });

  test("owner editor: icons left-aligned, no text labels", async ({
    page,
  }) => {
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
    await expect(
      page.getByRole("button", { name: "Settings", exact: true })
    ).toBeVisible({ timeout: 15_000 });

    const website = page.getByLabel("Website");
    const twitter = page.getByLabel("X / Twitter");
    const github = page.getByLabel("GitHub");
    await expect(website).toBeVisible();
    await expect(twitter).toBeVisible();
    await expect(github).toBeVisible();

    // Visible text labels are gone — names live only in aria-label.
    await expect(page.getByText("Website", { exact: true })).toHaveCount(0);
    await expect(page.getByText("X / Twitter", { exact: true })).toHaveCount(0);
    await expect(page.getByText("GitHub", { exact: true })).toHaveCount(0);

    // Social row flushes with the avatar, not indented under the name column.
    const avatar = page.getByRole("button", { name: "Change photo" });
    const avatarBox = await avatar.boundingBox();
    const websiteBox = await website.boundingBox();
    expect(avatarBox).toBeTruthy();
    expect(websiteBox).toBeTruthy();
    // Icon (32) + gap (8) sits before the input; row left ≈ input.x - 40.
    const rowLeft = websiteBox!.x - 40;
    expect(Math.abs(rowLeft - avatarBox!.x)).toBeLessThanOrEqual(4);

    await page.screenshot({
      path: "/opt/cursor/artifacts/owner_social_links_mobile.png",
      fullPage: false,
    });
  });

  test("public profile: icon-only chips, left-aligned", async ({ browser }) => {
    const sql = neon(process.env.DATABASE_URL!);
    const links = [
      { platform: "website", url: "https://example.com" },
      { platform: "twitter", url: "https://x.com/demo" },
      { platform: "github", url: "https://github.com/demo" },
    ];
    await sql`
      UPDATE users
      SET social_links = ${JSON.stringify(links)}::jsonb
      WHERE id = ${user.userId}
    `;

    // Fresh anon context — viewing someone else's profile.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`/${username}`);

    // Scope to the profile headline so library "Source code" GitHub
    // cards can't steal the accessible-name match.
    const headline = page.locator("div.mx-auto.max-w-7xl > div.space-y-3");
    const website = headline.getByRole("link", { name: "Website" });
    const twitter = headline.getByRole("link", { name: "X / Twitter" });
    const github = headline.getByRole("link", { name: "GitHub" });
    await expect(website).toBeVisible({ timeout: 15_000 });
    await expect(twitter).toBeVisible();
    await expect(github).toBeVisible();

    // Icon-only chips: accessible name only, no visible platform text.
    await expect(headline.getByText("GitHub", { exact: true })).toHaveCount(0);
    await expect(headline.getByText("X / Twitter", { exact: true })).toHaveCount(
      0
    );
    await expect(headline.getByText("Website", { exact: true })).toHaveCount(0);

    const avatar = headline.locator("div.h-20.w-20").first();
    const avatarBox = await avatar.boundingBox();
    const chipBox = await website.boundingBox();
    expect(avatarBox).toBeTruthy();
    expect(chipBox).toBeTruthy();
    expect(Math.abs(chipBox!.x - avatarBox!.x)).toBeLessThanOrEqual(4);

    await page.screenshot({
      path: "/opt/cursor/artifacts/public_social_links_mobile.png",
      fullPage: false,
    });
    await context.close();
  });
});
