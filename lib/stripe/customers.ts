import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";

/**
 * Resolve (or lazily create) the Stripe Customer for a Materialize
 * user, persisting the id on the users row.
 *
 * Extracted from createBillingSetupSession so the two_step fee
 * checkout can attach the same customer: a Checkout session with
 * `setup_future_usage` needs a Customer for the card to be saved
 * onto, and it must be the SAME customer agent billing charges
 * (users.stripeCustomerId) or the saved card would be split across
 * two Stripe customers and unusable off-session.
 *
 * Concurrency: two racing callers can both see no customer and
 * create two. The conditional write makes one id win in our DB, and
 * the loser is re-read — an orphaned Stripe customer with no card is
 * harmless. No sentinel dance needed for that cost.
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  contact?: { email?: string; name?: string }
): Promise<string> {
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: contact?.email || undefined,
    name: contact?.name || undefined,
    metadata: { materialize_user_id: userId },
  });

  const wrote = await db
    .update(users)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(users.id, userId), isNull(users.stripeCustomerId)))
    .returning({ stripeCustomerId: users.stripeCustomerId });

  if (wrote.length > 0) return customer.id;

  // A racing caller wrote first — their id is authoritative; ours
  // becomes an unused orphan on Stripe's side.
  const [refetched] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return refetched?.stripeCustomerId ?? customer.id;
}
