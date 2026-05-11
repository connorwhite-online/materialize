import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { purchases, files, projects, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logError } from "@/lib/logger";
import { notifyRefundOnListing } from "@/lib/notifications/notify";

/**
 * Flip a `purchases` row to `refunded` in response to a Stripe
 * `charge.refunded` event. Looks up the purchase by the
 * PaymentIntent id stored at checkout time. Once flipped, the
 * entitlement helpers (`userOwnsFile` / `userOwnsProject`) start
 * returning false for the buyer because they filter on
 * `status='completed'` only, so download access drops automatically.
 *
 * Notification fires to the creator so they see the refund in the
 * inbox alongside the original sale. Best-effort — never bubbles up.
 *
 * Idempotent: a duplicate `charge.refunded` delivery (or one that
 * arrives after we already flipped the row) is a no-op. We rely on
 * the status check inside `where()` to skip rows we've already
 * marked refunded.
 */
export async function handleListingRefund(
  charge: Stripe.Charge
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) {
    // Charge with no PaymentIntent isn't a listing purchase (those
    // always flow through PaymentIntents via Checkout). Bail quietly.
    return;
  }

  // `charge.refunded` fires for partial refunds too — only flip the
  // row when the entire amount has been refunded. Partial refunds
  // could be modeled with a separate refunds table later; for v1 the
  // buyer keeps access if any portion of the charge remains.
  const fullyRefunded =
    charge.refunded === true && charge.amount_refunded === charge.amount;
  if (!fullyRefunded) return;

  const [purchase] = await db
    .select({
      id: purchases.id,
      buyerId: purchases.buyerId,
      fileId: purchases.fileId,
      projectId: purchases.projectId,
      amount: purchases.amount,
      status: purchases.status,
    })
    .from(purchases)
    .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
    .limit(1);

  if (!purchase) {
    // Refund for a charge we didn't record as a listing purchase —
    // likely a print order, which has its own refund handling path.
    // No-op.
    return;
  }
  if (purchase.status === "refunded") {
    // Already handled — duplicate delivery.
    return;
  }

  await db
    .update(purchases)
    .set({ status: "refunded" })
    .where(eq(purchases.id, purchase.id));

  // Notify the creator. The actor on the notification is the buyer
  // (consistent with the purchase notification) — the headline copy
  // is what reframes it as a refund.
  try {
    const isFile = !!purchase.fileId;
    const listingId = (purchase.fileId ?? purchase.projectId)!;
    const target = isFile
      ? await db
          .select({
            name: files.name,
            slug: files.slug,
            ownerId: files.userId,
          })
          .from(files)
          .where(eq(files.id, listingId))
          .then((rows) => rows[0])
      : await db
          .select({
            name: projects.name,
            slug: projects.slug,
            ownerId: projects.userId,
          })
          .from(projects)
          .where(eq(projects.id, listingId))
          .then((rows) => rows[0]);

    if (!target) return;

    const [buyer] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, purchase.buyerId));
    if (!buyer) return;

    await notifyRefundOnListing(target.ownerId, {
      actor: buyer,
      listing: {
        kind: isFile ? "file" : "project",
        name: target.name,
        slug: target.slug,
      },
      snippet: { amountCents: purchase.amount, currency: "USD" },
    });
  } catch (error) {
    logError("handleListingRefund:notify", error);
  }
}
