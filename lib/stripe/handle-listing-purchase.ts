import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { purchases, files, projects, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logError } from "@/lib/logger";
import {
  notifyPurchaseOnListing,
  type PurchaseSnippet,
} from "@/lib/notifications/notify";

/**
 * Inserts a `purchases` row when a paid file / project Checkout
 * Session completes. The session's metadata carries everything we
 * need — buyerId, listingType, listingId, the amount + service fee
 * we calculated when we created the session — so the handler is a
 * fairly mechanical decode-and-insert.
 *
 * Idempotency: the stripePaymentIntentId is unique per Stripe
 * payment, so a duplicate webhook delivery for the same session
 * finds an existing row and no-ops. Failing fast in that case keeps
 * us from double-firing the purchase notification.
 *
 * On success, fires `purchase_on_listing` to the creator so the bell
 * surfaces real sales activity. Notification failures are swallowed
 * (Stripe shouldn't retry the webhook because we couldn't push a
 * notification — the money already moved).
 */
export async function handleListingPurchase(
  session: Stripe.Checkout.Session
): Promise<void> {
  const md = session.metadata ?? {};
  const buyerId = md.buyerId;
  const listingType = md.listingType;
  const listingId = md.listingId;
  const amount = Number(md.amount);
  const serviceFee = Number(md.serviceFee);

  if (!buyerId || !listingId) {
    throw new Error("Missing buyer/listing metadata on listing_purchase");
  }
  if (listingType !== "file" && listingType !== "project") {
    throw new Error(`Unknown listingType: ${listingType}`);
  }
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(serviceFee) ||
    amount <= 0
  ) {
    throw new Error("Bad amount/serviceFee on listing_purchase");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) {
    throw new Error("Listing checkout session missing payment_intent id");
  }

  // Dedup — if we've already recorded this PaymentIntent, return
  // without re-inserting (and without re-notifying).
  const [existing] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  if (existing) return;

  // Reconcile against what Stripe ACTUALLY charged rather than trusting
  // the metadata alone — metadata is written at session-create time and
  // could drift from the charged total (a future coupon/tax/price change).
  // Record the real charged amount and derive the payout from it; loudly
  // flag any divergence so it surfaces in Sentry. (CON-47)
  const chargedTotal = session.amount_total;
  if (chargedTotal != null && chargedTotal !== amount) {
    logError(
      "handleListingPurchase:amountMismatch",
      new Error(
        `metadata amount ${amount} != charged ${chargedTotal} (pi ${paymentIntentId})`
      )
    );
  }
  const effectiveAmount = chargedTotal ?? amount;
  const creatorPayout = effectiveAmount - serviceFee;

  // Load the listing to surface name/slug to the notification + to
  // discover the creator id for the purchase_on_listing payload.
  const target =
    listingType === "file"
      ? await db
          .select({
            id: files.id,
            name: files.name,
            slug: files.slug,
            ownerId: files.userId,
          })
          .from(files)
          .where(eq(files.id, listingId))
          .then((rows) => rows[0])
      : await db
          .select({
            id: projects.id,
            name: projects.name,
            slug: projects.slug,
            ownerId: projects.userId,
          })
          .from(projects)
          .where(eq(projects.id, listingId))
          .then((rows) => rows[0]);
  if (!target) {
    throw new Error(`Listing not found for purchase: ${listingId}`);
  }

  await db.insert(purchases).values({
    buyerId,
    fileId: listingType === "file" ? listingId : null,
    projectId: listingType === "project" ? listingId : null,
    amount: effectiveAmount,
    serviceFee,
    creatorPayout,
    stripePaymentIntentId: paymentIntentId,
    status: "completed",
  });

  // Notify the creator. Best-effort — never bubbles up because the
  // money already moved and the buyer's entitlement is already
  // recorded above.
  try {
    const [buyer] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, buyerId));
    if (buyer) {
      const snippet: PurchaseSnippet = {
        amountCents: effectiveAmount,
        currency: "USD",
      };
      await notifyPurchaseOnListing(target.ownerId, {
        actor: buyer,
        listing: {
          kind: listingType,
          name: target.name,
          slug: target.slug,
        },
        snippet,
      });
    }
  } catch (error) {
    logError("handleListingPurchase:notify", error);
  }
}

