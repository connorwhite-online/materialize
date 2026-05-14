import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createPaidFileFixture,
  deletePaidFileFixture,
  createClerkTestUser,
  deleteClerkTestUser,
  createStripeOnboardedAccount,
  type PaidFileFixture,
  type ClerkTestUserFixture,
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

test.describe("authed purchase gate — creator not onboarded", () => {
  let fixture: PaidFileFixture;
  let buyer: ClerkTestUserFixture;

  test.beforeAll(async () => {
    fixture = await createPaidFileFixture({ onboarded: false });
    buyer = await createClerkTestUser();
  });

  test.afterAll(async () => {
    if (fixture) await deletePaidFileFixture(fixture);
    if (buyer) await deleteClerkTestUser(buyer);
  });

  test("signed-in buyer sees the not-onboarded error", async ({ page }) => {
    // Sign in via Clerk's password strategy. The test user was
    // created with a known password in beforeAll.
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: buyer.email,
      },
    });

    await page.goto(`/files/${fixture.slug}`);

    const buyButton = page.getByRole("button", { name: /^Purchase · \$/i });
    await expect(buyButton).toBeVisible();
    await buyButton.click();

    // createListingCheckoutSession returns:
    //   "This creator hasn't enabled payouts yet — try again later."
    // when listing.stripeOnboardingComplete is false. The button
    // renders that string inline.
    await expect(
      page.getByText(/creator hasn.?t enabled payouts/i)
    ).toBeVisible({ timeout: 10_000 });

    // No redirect to Stripe — the gate fired before the session
    // creation call.
    expect(page.url()).toContain(`/files/${fixture.slug}`);
    expect(page.url()).not.toContain("checkout.stripe.com");
  });
});

test.describe("authed purchase happy path — redirects to Stripe", () => {
  let fixture: PaidFileFixture;
  let buyer: ClerkTestUserFixture;

  test.beforeAll(async () => {
    // Spin up a real Connect-onboarded account in the sandbox so
    // createListingCheckoutSession's destination-charge path
    // succeeds. ~3-5s; the slowest piece of the suite.
    const stripeAccountId = await createStripeOnboardedAccount();
    fixture = await createPaidFileFixture({ stripeAccountId });
    buyer = await createClerkTestUser();
  });

  test.afterAll(async () => {
    if (fixture) await deletePaidFileFixture(fixture);
    if (buyer) await deleteClerkTestUser(buyer);
    // Stripe Connect account intentionally left in the sandbox —
    // it's free, useful for inspection, and Stripe's API doesn't
    // expose a clean delete for controller-managed accounts.
  });

  test("signed-in buyer is redirected to checkout.stripe.com", async ({
    page,
  }) => {
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: buyer.email,
      },
    });

    await page.goto(`/files/${fixture.slug}`);

    const buyButton = page.getByRole("button", { name: /^Purchase · \$/i });
    await expect(buyButton).toBeVisible();

    // PurchaseButton calls `window.location.href = res.url` on
    // success. We wait for the off-domain navigation but don't
    // need the Stripe-hosted page to fully load — asserting on
    // the URL alone proves the server action minted a session
    // and the button followed it.
    const stripeNavigation = page.waitForURL(
      /^https:\/\/checkout\.stripe\.com\//,
      { timeout: 15_000 }
    );
    await buyButton.click();
    await stripeNavigation;

    expect(page.url()).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });
});
