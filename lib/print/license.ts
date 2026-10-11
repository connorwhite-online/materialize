import "server-only";

import { and, eq, gt, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  fileAssets,
  files,
  printOrderItems,
  printOrders,
  purchases,
  users,
} from "@/lib/db/schema";
import { ownsLoadedFile } from "@/lib/entitlement";
import { calcServiceFee } from "@/lib/fees";
import { logError } from "@/lib/logger";
import { notifyPurchaseOnListing } from "@/lib/notifications/notify";
import { getStripe } from "@/lib/stripe";

/**
 * Printing a paid listing you don't own buys it.
 *
 * Before this, anyone could order a print of a paid listing without
 * paying its creator anything. Now the print checkout carries the
 * listing's price as its own line (once per file, never per unit), and
 * once the order is actually placed the buyer gets a normal `purchases`
 * row — so they own the file afterwards, exactly as if they'd bought it
 * — and the creator is paid the price minus the same 3% a direct sale
 * keeps.
 *
 * Money shape. A direct sale is a destination charge; a print order is
 * a platform charge (most of it goes to CraftCloud), so the creator's
 * share moves as a separate transfer, sourced from the order's charge
 * so it can't run ahead of the funds. The purchase row records the
 * print order instead of a PaymentIntent: the listing-refund webhook
 * looks purchases up by PaymentIntent and must never flip one because
 * a print was refunded — print refunds reverse it explicitly via
 * `revokePrintLicenses`.
 *
 * Timing. The license is granted and paid out when the order is placed
 * (or, under two_step, when the fee hold is captured), not when the
 * buyer pays: every path that unwinds an unplaced order (orphan refund,
 * stale sweep, agent cancel, abandoned two_step hold) then has nothing
 * to claw back.
 */

/** Order states where a license is paid for but not yet granted. */
const LICENSE_IN_FLIGHT_STATUSES = [
  "auto_approved",
  "awaiting_production_payment",
] as const;

export interface PrintLicense {
  fileId: string;
  fileName: string;
  licenseCents: number;
}

export type LicenseResolution =
  | { ok: true; license: PrintLicense | null }
  | { ok: false; error: string };

export const LICENSE_PAYOUTS_DISABLED_ERROR =
  "This creator hasn't set up payouts yet, so their paid files can't be printed right now.";

/**
 * What this buyer owes the creator to print this asset: null when the
 * file is free, theirs, already owned, or already being paid for by an
 * order still in flight. Refuses when the creator can't be paid.
 */
export async function resolvePrintLicense(
  /** Null for a signed-out visitor seeing what a print would cost. */
  buyerId: string | null,
  fileAssetId: string
): Promise<LicenseResolution> {
  const [row] = await db
    .select({
      fileId: files.id,
      fileName: files.name,
      price: files.price,
      ownerId: files.userId,
      organizationId: files.organizationId,
      stripeAccountId: users.stripeAccountId,
      stripeOnboardingComplete: users.stripeOnboardingComplete,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(fileAssets.id, fileAssetId))
    .limit(1);

  if (!row || row.price <= 0) return { ok: true, license: null };

  const owned = await ownsLoadedFile(buyerId, {
    id: row.fileId,
    price: row.price,
    userId: row.ownerId,
    organizationId: row.organizationId,
  });
  if (owned) return { ok: true, license: null };

  if (buyerId && (await hasLicenseInFlight(buyerId, row.fileId))) {
    return { ok: true, license: null };
  }

  if (!row.stripeAccountId || !row.stripeOnboardingComplete) {
    return { ok: false, error: LICENSE_PAYOUTS_DISABLED_ERROR };
  }

  return {
    ok: true,
    license: {
      fileId: row.fileId,
      fileName: row.fileName,
      licenseCents: row.price,
    },
  };
}

/**
 * Whether one of this buyer's orders has already been charged for this
 * file's license but not yet placed (auto-approved agent orders wait out
 * a cancellation window; two_step orders wait on CraftCloud payment).
 * Without this, a second print in that window would charge it again.
 */
async function hasLicenseInFlight(
  buyerId: string,
  fileId: string
): Promise<boolean> {
  const assetIds = db
    .select({ id: fileAssets.id })
    .from(fileAssets)
    .where(eq(fileAssets.fileId, fileId));

  const [single] = await db
    .select({ id: printOrders.id })
    .from(printOrders)
    .leftJoin(printOrderItems, eq(printOrderItems.printOrderId, printOrders.id))
    .where(
      and(
        eq(printOrders.userId, buyerId),
        inArray(printOrders.status, [...LICENSE_IN_FLIGHT_STATUSES]),
        gt(printOrders.licenseFee, 0),
        or(
          inArray(printOrders.fileAssetId, assetIds),
          and(
            gt(printOrderItems.licenseFee, 0),
            inArray(printOrderItems.fileAssetId, assetIds)
          )
        )
      )
    )
    .limit(1);
  return Boolean(single);
}

export type LicenseLineItem = {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; description?: string };
  };
  quantity: number;
};

/**
 * One line per paid listing the order also buys (lib/print/license.ts).
 * Shared by every session builder, including two_step's fee-only one —
 * there the license rides on our fee hold, since CraftCloud's bill only
 * covers production and shipping.
 */
export async function buildLicenseLineItems(order: {
  id: string;
  fileAssetId: string | null;
  licenseFee: number;
}): Promise<LicenseLineItem[]> {
  if (order.licenseFee <= 0) return [];
  const rows = order.fileAssetId
    ? await db
        .select({
          fileName: files.name,
          licenseFee: sql<number>`${order.licenseFee}`,
        })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(fileAssets.id, order.fileAssetId))
        .limit(1)
    : await db
        .select({ fileName: files.name, licenseFee: printOrderItems.licenseFee })
        .from(printOrderItems)
        .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(printOrderItems.printOrderId, order.id));
  return rows
    .filter((r) => r.licenseFee > 0)
    .map((r) => ({
      price_data: {
        currency: "usd",
        unit_amount: Number(r.licenseFee),
        product_data: {
          name: `File — ${r.fileName}`,
          description:
            "The creator's price for this file. You'll own it once your order is placed.",
        },
      },
      quantity: 1,
    }));
}

/** The creator's share of a license: the price minus the 3% a direct sale keeps. */
export function licenseSplit(licenseCents: number) {
  const serviceFee = calcServiceFee(licenseCents);
  return { serviceFee, creatorPayout: licenseCents - serviceFee };
}

interface LicensedLine {
  fileId: string;
  licenseCents: number;
}

/** The licensed files on an order, from the order row or its items. */
async function licensedLinesForOrder(orderId: string): Promise<{
  buyerId: string;
  lines: LicensedLine[];
} | null> {
  const [order] = await db
    .select({
      userId: printOrders.userId,
      licenseFee: printOrders.licenseFee,
      fileAssetId: printOrders.fileAssetId,
    })
    .from(printOrders)
    .where(eq(printOrders.id, orderId))
    .limit(1);
  if (!order || order.licenseFee <= 0) return null;

  const lines: LicensedLine[] = [];
  if (order.fileAssetId) {
    const [asset] = await db
      .select({ fileId: fileAssets.fileId })
      .from(fileAssets)
      .where(eq(fileAssets.id, order.fileAssetId))
      .limit(1);
    if (asset?.fileId) {
      lines.push({ fileId: asset.fileId, licenseCents: order.licenseFee });
    }
  } else {
    const items = await db
      .select({
        fileId: fileAssets.fileId,
        licenseFee: printOrderItems.licenseFee,
      })
      .from(printOrderItems)
      .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
      .where(
        and(
          eq(printOrderItems.printOrderId, orderId),
          gt(printOrderItems.licenseFee, 0)
        )
      );
    for (const item of items) {
      if (item.fileId) {
        lines.push({ fileId: item.fileId, licenseCents: item.licenseFee });
      }
    }
  }
  return { buyerId: order.userId, lines };
}

/**
 * The PaymentIntent that paid for an order, when the caller doesn't have
 * it: two_step's captured fee hold, an auto-approved agent charge (its
 * `pi_` id lives in stripeSessionId), or a Checkout session's intent.
 */
async function paymentIntentForOrder(orderId: string): Promise<string | null> {
  const [order] = await db
    .select({
      stripeSessionId: printOrders.stripeSessionId,
      feePaymentIntentId: printOrders.feePaymentIntentId,
    })
    .from(printOrders)
    .where(eq(printOrders.id, orderId))
    .limit(1);
  if (!order) return null;
  if (order.feePaymentIntentId) return order.feePaymentIntentId;
  const ref = order.stripeSessionId;
  if (ref?.startsWith("pi_")) return ref;
  if (ref?.startsWith("cs_")) {
    const session = await getStripe().checkout.sessions.retrieve(ref);
    const pi = session.payment_intent;
    return typeof pi === "string" ? pi : (pi?.id ?? null);
  }
  return null;
}

async function chargeIdFor(paymentIntentId: string): Promise<string | null> {
  const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
  const charge = pi.latest_charge;
  if (!charge) return null;
  return typeof charge === "string" ? charge : charge.id;
}

/**
 * Grant every license an order paid for: a purchase row per file, then
 * a transfer of the creator's share. Called once the order is placed.
 *
 * Safe to call again: a file that already has a purchase row for this
 * order is skipped, and the transfer carries a per-order-and-file
 * idempotency key. Never throws — the print is already placed and the
 * buyer already paid, so a failure here is logged for a manual payout
 * rather than unwinding the order.
 */
export async function grantPrintLicenses(
  orderId: string,
  paymentIntentId: string | null
): Promise<void> {
  try {
    const licensed = await licensedLinesForOrder(orderId);
    if (!licensed || licensed.lines.length === 0) return;

    const intentId = paymentIntentId ?? (await paymentIntentForOrder(orderId));
    const chargeId = intentId ? await chargeIdFor(intentId) : null;
    if (!chargeId) {
      logError(
        "printLicense.noCharge",
        new Error(`No charge to fund license payout for order ${orderId}`)
      );
    }

    for (const line of licensed.lines) {
      await grantOne(orderId, licensed.buyerId, line, chargeId);
    }
  } catch (error) {
    logError("printLicense.grant", error);
  }
}

async function grantOne(
  orderId: string,
  buyerId: string,
  line: LicensedLine,
  chargeId: string | null
) {
  const [file] = await db
    .select({
      name: files.name,
      slug: files.slug,
      ownerId: files.userId,
      stripeAccountId: users.stripeAccountId,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(files.id, line.fileId))
    .limit(1);
  if (!file) return;

  let [purchase] = await db
    .select({ id: purchases.id, stripeTransferId: purchases.stripeTransferId })
    .from(purchases)
    .where(
      and(eq(purchases.printOrderId, orderId), eq(purchases.fileId, line.fileId))
    )
    .limit(1);

  const { serviceFee, creatorPayout } = licenseSplit(line.licenseCents);
  const isNew = !purchase;
  if (!purchase) {
    [purchase] = await db
      .insert(purchases)
      .values({
        buyerId,
        fileId: line.fileId,
        amount: line.licenseCents,
        serviceFee,
        creatorPayout,
        printOrderId: orderId,
        status: "completed",
      })
      .returning({
        id: purchases.id,
        stripeTransferId: purchases.stripeTransferId,
      });
  }

  if (!purchase.stripeTransferId && chargeId && creatorPayout > 0) {
    if (!file.stripeAccountId) {
      logError(
        "printLicense.noCreatorAccount",
        new Error(`Creator ${file.ownerId} has no Connect account (order ${orderId})`)
      );
    } else {
      try {
        const transfer = await getStripe().transfers.create(
          {
            amount: creatorPayout,
            currency: "usd",
            destination: file.stripeAccountId,
            source_transaction: chargeId,
            transfer_group: `print_order_${orderId}`,
            metadata: { printOrderId: orderId, fileId: line.fileId, purchaseId: purchase.id },
          },
          { idempotencyKey: `print-license-transfer:${orderId}:${line.fileId}` }
        );
        await db
          .update(purchases)
          .set({ stripeTransferId: transfer.id })
          .where(eq(purchases.id, purchase.id));
      } catch (error) {
        // The buyer owns it either way; the creator's payout needs a
        // manual transfer. Logged with everything needed to do it.
        logError("printLicense.transfer", {
          orderId,
          fileId: line.fileId,
          purchaseId: purchase.id,
          creatorPayout,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (isNew) {
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
        await notifyPurchaseOnListing(file.ownerId, {
          actor: buyer,
          listing: { kind: "file", name: file.name, slug: file.slug },
          snippet: { amountCents: line.licenseCents, currency: "USD" },
        });
      }
    } catch (error) {
      logError("printLicense.notify", error);
    }
  }
}

/**
 * Undo the licenses an order granted, for a full refund of a placed
 * order: reverse each creator transfer and mark the purchase refunded,
 * so the buyer no longer owns what they got their money back for.
 * Never throws; a failed reversal is logged for manual follow-up.
 */
export async function revokePrintLicenses(orderId: string): Promise<void> {
  try {
    const granted = await db
      .select({
        id: purchases.id,
        stripeTransferId: purchases.stripeTransferId,
      })
      .from(purchases)
      .where(
        and(
          eq(purchases.printOrderId, orderId),
          eq(purchases.status, "completed")
        )
      );

    for (const purchase of granted) {
      if (purchase.stripeTransferId) {
        try {
          await getStripe().transfers.createReversal(
            purchase.stripeTransferId,
            {},
            { idempotencyKey: `print-license-reversal:${purchase.id}` }
          );
        } catch (error) {
          logError("printLicense.reversal", {
            orderId,
            purchaseId: purchase.id,
            transferId: purchase.stripeTransferId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await db
        .update(purchases)
        .set({ status: "refunded" })
        .where(eq(purchases.id, purchase.id));
    }
  } catch (error) {
    logError("printLicense.revoke", error);
  }
}
