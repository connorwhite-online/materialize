import { test, expect } from "@playwright/test";
import {
  createPaidFileFixture,
  deletePaidFileFixture,
  type PaidFileFixture,
} from "./fixtures";

/**
 * Purchase-flow gates on the file detail page. These exercise the
 * `createListingCheckoutSession` server action's error paths via
 * the `PurchaseButton` UI — anon sees "Sign in to purchase", and
 * an unauthenticated visitor looking at a creator who hasn't
 * finished payout onboarding never reaches the Stripe redirect.
 *
 * Stripe-redirect happy path lives in a separate spec because it
 * needs a real Connect-onboarded creator + Clerk test auth, which
 * is heavier setup. The gates here catch the more common bug
 * surface (server-action logic flips, button-error rendering)
 * without that overhead.
 */

test.describe("anon purchase gate", () => {
  let fixture: PaidFileFixture;

  test.beforeAll(async () => {
    fixture = await createPaidFileFixture({ onboarded: false });
  });

  test.afterAll(async () => {
    if (fixture) await deletePaidFileFixture(fixture);
  });

  test("anon visitor clicking Purchase sees the sign-in gate", async ({
    page,
  }) => {
    await page.goto(`/files/${fixture.slug}`);

    // PurchaseButton renders its label as "Purchase · $19.99"
    const buyButton = page.getByRole("button", { name: /^Purchase · \$/i });
    await expect(buyButton).toBeVisible();

    await buyButton.click();

    // The server action returns { error: "Sign in to purchase" }
    // which the button renders inline as a destructive paragraph.
    await expect(page.getByText("Sign in to purchase")).toBeVisible({
      timeout: 5_000,
    });

    // We should NOT have left the listing page — anon click
    // doesn't redirect anywhere.
    expect(page.url()).toContain(`/files/${fixture.slug}`);
  });
});
