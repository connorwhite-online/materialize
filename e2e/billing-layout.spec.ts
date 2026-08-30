import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  setClerkUsername,
  deleteAppUserRow,
  type ClerkTestUserFixture,
} from "./fixtures";

/**
 * CON-17 — Billing payment actions must sit on a row under the card
 * info on narrow viewports (not squeezed beside wrapped text).
 */
test.describe("billing payment method layout", () => {
  let buyer: ClerkTestUserFixture;

  test.beforeAll(async () => {
    buyer = await createClerkTestUser();
    const { username } = await seedAppUserForClerkId(buyer.userId, {
      displayName: "Billing Layout Verify",
    });
    await setClerkUsername(buyer.userId, username);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const customer = await stripe.customers.create({
      email: buyer.email,
      metadata: { materialize_user_id: buyer.userId, purpose: "con-17" },
    });
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_mastercard" },
    });
    await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

    const sql = neon(process.env.DATABASE_URL!);
    const db = drizzle(sql, { schema });
    await db
      .update(schema.users)
      .set({
        stripeCustomerId: customer.id,
        defaultPaymentMethod: pm.id,
      })
      .where(eq(schema.users.id, buyer.userId));
  });

  test.afterAll(async () => {
    if (buyer) {
      await deleteAppUserRow(buyer.userId);
      await deleteClerkTestUser(buyer);
    }
  });

  test("stacks Remove / Replace under card info at mobile width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: buyer.email,
      },
    });

    await page.goto("/dashboard/settings/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Replace card" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
    await expect(page.getByText(/ending in/i)).toBeVisible();

    await expect(page.getByText(/expires/i)).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) =>
        /^(Remove|Replace card)$/.test((b.textContent || "").trim())
      );
      const info = [...document.querySelectorAll("p")].find((p) =>
        /ending in/.test(p.textContent || "")
      );
      const card = document.querySelector(".rounded-2xl.border");
      if (!info || buttons.length < 2 || !card) {
        return { ok: false, reason: "missing nodes" as const };
      }
      const infoRect = info.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const btnRects = buttons.map((b) => b.getBoundingClientRect());
      const minBtnTop = Math.min(...btnRects.map((r) => r.top));
      const stacked = minBtnTop >= infoRect.bottom - 1;
      const sameRow = Math.abs(btnRects[0].top - btnRects[1].top) < 8;
      // Each button should take roughly half the card content width.
      const widths = btnRects.map((r) => r.width).sort((a, b) => a - b);
      const halfish =
        Math.abs(widths[0] - widths[1]) < 8 &&
        widths[0] + widths[1] > cardRect.width * 0.7;
      return {
        ok: stacked && sameRow && halfish,
        stacked,
        sameRow,
        halfish,
        widths,
        cardWidth: cardRect.width,
      };
    });

    expect(layout.ok, JSON.stringify(layout)).toBe(true);

    const artifactsDir = process.env.WALKTHROUGH_ARTIFACTS_DIR;
    if (artifactsDir) {
      await page.locator(".rounded-2xl.border").first().screenshot({
        path: `${artifactsDir}/billing_card_actions_mobile_stacked.png`,
      });
      await page.screenshot({
        path: `${artifactsDir}/billing_page_mobile_full.png`,
        fullPage: true,
      });
    }
  });
});
