"use server";

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";

/**
 * Server actions for the agent-billing setup flow:
 *
 *   createBillingSetupSession — mints a Stripe Checkout Session in
 *     `setup` mode so the user can save a card off-session. Stripe
 *     hosts the card form; we never touch raw card data. The session
 *     is tagged with `metadata.type: "billing_setup"` so the webhook
 *     handler knows to persist the resulting payment method onto
 *     `users.defaultPaymentMethod` rather than placing an order.
 *
 *   removePaymentMethod — detaches the current payment method from
 *     the Stripe customer and clears it on our side. Doesn't delete
 *     the customer (we'll reuse it next time they save a card).
 *
 * Why hosted Checkout instead of Stripe Elements: existing print
 * checkout already uses the hosted flow, so users get a consistent
 * Stripe-hosted UI and we don't take on `@stripe/react-stripe-js`
 * for one extra surface. The redirect flow is fine for a settings
 * page that's rarely visited.
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function createBillingSetupSession(): Promise<
  { url: string } | { error: string }
> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in required" };

  try {
    const stripe = getStripe();

    const [user] = await db
      .select({
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let customerId = user?.stripeCustomerId ?? null;
    if (!customerId) {
      const clerkUser = await currentUser();
      const email = clerkUser?.primaryEmailAddress?.emailAddress;
      const name = [clerkUser?.firstName, clerkUser?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        name: name.length > 0 ? name : undefined,
        metadata: { materialize_user_id: userId },
      });
      customerId = customer.id;
      await db
        .update(users)
        .set({ stripeCustomerId: customerId })
        .where(eq(users.id, userId));
    }

    const successUrl = `${appUrl()}/dashboard/settings/billing?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl()}/dashboard/settings/billing?status=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: "billing_setup",
        userId,
      },
    });

    if (!session.url) {
      return { error: "Stripe returned no checkout URL" };
    }
    return { url: session.url };
  } catch (error) {
    logError("createBillingSetupSession", error);
    return { error: "Failed to start billing setup. Please try again." };
  }
}

export async function removePaymentMethod(): Promise<
  { ok: true } | { error: string }
> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in required" };

  try {
    const [user] = await db
      .select({ defaultPaymentMethod: users.defaultPaymentMethod })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user?.defaultPaymentMethod) {
      const stripe = getStripe();
      try {
        await stripe.paymentMethods.detach(user.defaultPaymentMethod);
      } catch (err) {
        // Detach can fail if the PM was already removed in Stripe —
        // log and continue clearing the local pointer either way.
        logError("removePaymentMethod.detach", err);
      }
    }

    await db
      .update(users)
      .set({ defaultPaymentMethod: null })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings/billing");
    return { ok: true };
  } catch (error) {
    logError("removePaymentMethod", error);
    return { error: "Failed to remove payment method. Please try again." };
  }
}

export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/**
 * Fetch a human-readable summary of the user's saved card. Returns
 * null if no card is on file. Pulls live from Stripe so the
 * dashboard always reflects the source of truth (no risk of stale
 * brand/last4 cached locally after a card update).
 */
export async function getPaymentMethodSummary(): Promise<PaymentMethodSummary | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select({ defaultPaymentMethod: users.defaultPaymentMethod })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.defaultPaymentMethod) return null;

  try {
    const stripe = getStripe();
    const pm = await stripe.paymentMethods.retrieve(user.defaultPaymentMethod);
    if (!pm.card) return null;
    return {
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    };
  } catch (error) {
    logError("getPaymentMethodSummary", error);
    return null;
  }
}
